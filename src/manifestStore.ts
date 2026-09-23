import * as vscode from 'vscode';
import * as path from 'path';
import {
  buildLineageSubgraph,
  countModels,
  docsTargetForModel,
  normaliseManifest,
  resolveNodeIdForFile,
  sqlFilesForModel,
  type DbtManifest,
  type LineageExpansion,
  type LineageGraph,
} from './manifest';
import { runDbt } from './dbtTerminal';
import { MANIFEST_RELOAD_DEBOUNCE_MS, afterFailedManifestLoad } from './manifestReload';

const CASE_INSENSITIVE = process.platform === 'win32';

/**
 * Keeps the active project's `target/manifest.json` in memory and current: reloads
 * on project switch and on any change to the file. Offers `dbt parse` when the
 * manifest is missing. Wraps the pure lineage/resolver helpers for callers.
 */
export class ManifestStore implements vscode.Disposable {
  private manifest: DbtManifest | undefined;
  private projectRoot: string | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;
  private parsePrompted = false;
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped by every load() and project switch, so stale retries give up. */
  private loadGeneration = 0;
  private readonly _onDidChange = new vscode.EventEmitter<void>();

  /** Fires after every (re)load attempt, whether or not a manifest is now present. */
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly log: (message: string) => void) {}

  get current(): DbtManifest | undefined {
    return this.manifest;
  }

  get activeProjectRoot(): string | undefined {
    return this.projectRoot;
  }

  get modelCount(): number {
    return this.manifest ? countModels(this.manifest) : 0;
  }

  /** Point the store at a new project root (or `undefined` to clear it). */
  async setProject(root: string | undefined): Promise<void> {
    this.projectRoot = root;
    this.parsePrompted = false;
    this.loadGeneration++;
    clearTimeout(this.reloadTimer);
    this.watcher?.dispose();
    this.watcher = undefined;
    this.manifest = undefined;

    if (!root) {
      this._onDidChange.fire();
      return;
    }

    const pattern = new vscode.RelativePattern(root, 'target/manifest.json');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    // dbt rewrites the file in several steps; one debounced read per burst.
    const reload = (): void => {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => void this.load(), MANIFEST_RELOAD_DEBOUNCE_MS);
    };
    this.watcher.onDidCreate(reload);
    this.watcher.onDidChange(reload);
    this.watcher.onDidDelete(reload);

    await this.load();
  }

  /**
   * Read and parse the manifest for the current project root. A failed read is
   * retried (see manifestReload.ts) with the previous manifest kept meanwhile,
   * since it is usually dbt caught mid-write; a newer load() or project switch
   * abandons the retries.
   */
  async load(): Promise<void> {
    const root = this.projectRoot;
    if (!root) {
      return;
    }
    clearTimeout(this.reloadTimer);
    const generation = ++this.loadGeneration;
    const uri = vscode.Uri.joinPath(vscode.Uri.file(root), 'target', 'manifest.json');
    for (let attempt = 0; ; attempt++) {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const manifest = normaliseManifest(JSON.parse(Buffer.from(bytes).toString('utf8')));
        if (generation !== this.loadGeneration) {
          return;
        }
        this.manifest = manifest;
        this.parsePrompted = false;
        this.log(`manifest loaded for ${root}: ${this.modelCount} model(s)`);
        break;
      } catch (err) {
        const error =
          err instanceof vscode.FileSystemError && err.code === 'FileNotFound' ? 'missing' : 'invalid';
        const decision = afterFailedManifestLoad(error, attempt, this.manifest !== undefined);
        if (decision.action === 'retry') {
          await new Promise((resolve) => setTimeout(resolve, decision.delayMs));
          if (generation !== this.loadGeneration) {
            return;
          }
          continue;
        }
        if (generation !== this.loadGeneration) {
          return;
        }
        if (!decision.keepPrevious) {
          this.manifest = undefined;
        }
        this.log(
          `manifest unavailable for ${root} after ${attempt + 1} tries: ${(err as Error).message}` +
            (decision.keepPrevious ? ' (keeping the last good one)' : ''),
        );
        if (decision.prompt) {
          this.promptParse(root);
        }
        break;
      }
    }
    this._onDidChange.fire();
  }

  /** Resolve an on-disk file to its manifest node id, if any. */
  resolveModelId(fileFsPath: string): string | undefined {
    if (!this.manifest || !this.projectRoot) {
      return undefined;
    }
    const rel = path.relative(this.projectRoot, fileFsPath).split(path.sep).join('/');
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return undefined;
    }
    return resolveNodeIdForFile(this.manifest, rel, CASE_INSENSITIVE);
  }

  /** Model name for an on-disk file (for `dbt <cmd> --select <name>`), if resolvable. */
  resolveModelName(fileFsPath: string): string | undefined {
    const id = this.resolveModelId(fileFsPath);
    return id ? this.manifest?.nodes[id]?.name : undefined;
  }

  /** Model name for a manifest node id — only for `model` nodes, not source/seed/snapshot. */
  modelNameForNode(id: string): string | undefined {
    const node = this.manifest?.nodes[id];
    return node?.resource_type === 'model' ? node.name : undefined;
  }

  /** Absolute on-disk path for a node id (model or source), if it has one. */
  absolutePathForNode(id: string): string | undefined {
    const node = this.manifest?.nodes[id] ?? this.manifest?.sources[id];
    if (!node?.original_file_path || !this.projectRoot) {
      return undefined;
    }
    return path.join(this.projectRoot, node.original_file_path);
  }

  /** Absolute paths of a model's source `.sql` and its compiled SQL, for the preview panel. */
  sqlFilesForModel(modelName: string): { source: string; compiled?: string } | undefined {
    const files = this.manifest ? sqlFilesForModel(this.manifest, modelName) : undefined;
    if (!files || !this.projectRoot) {
      return undefined;
    }
    return {
      source: path.join(this.projectRoot, files.sourceRelPath),
      compiled: files.compiledRelPath ? path.join(this.projectRoot, files.compiledRelPath) : undefined,
    };
  }

  /** Where a model's schema.yml doc block lives (or should be created), as an absolute path. */
  docsTarget(modelId: string): { yamlPath: string; modelName: string } | undefined {
    if (!this.manifest || !this.projectRoot) {
      return undefined;
    }
    const target = docsTargetForModel(this.manifest, modelId);
    if (!target) {
      return undefined;
    }
    return { yamlPath: path.join(this.projectRoot, target.yamlRelPath), modelName: target.modelName };
  }

  /** Lineage subgraph around a node id; empty graph when no manifest is loaded. */
  lineageAround(
    centreId: string,
    upstreamDepth: number,
    downstreamDepth: number,
    expansion: LineageExpansion = {},
  ): LineageGraph {
    if (!this.manifest) {
      return { nodes: [], edges: [] };
    }
    return buildLineageSubgraph(
      this.manifest,
      centreId,
      upstreamDepth,
      downstreamDepth,
      expansion,
    );
  }

  private promptParse(root: string): void {
    if (this.parsePrompted) {
      return;
    }
    this.parsePrompted = true;
    void vscode.window
      .showWarningMessage(
        'dbt booster: target/manifest.json not found for the active project.',
        'Run dbt parse',
      )
      .then((choice) => {
        if (choice === 'Run dbt parse') {
          runDbt(['parse'], root);
        }
      });
  }

  dispose(): void {
    clearTimeout(this.reloadTimer);
    this.loadGeneration++;
    this.watcher?.dispose();
    this._onDidChange.dispose();
  }
}
