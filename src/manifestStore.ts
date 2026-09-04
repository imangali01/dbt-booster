import * as vscode from 'vscode';
import * as path from 'path';
import {
  buildLineageSubgraph,
  countModels,
  normaliseManifest,
  resolveNodeIdForFile,
  type DbtManifest,
  type LineageGraph,
} from './manifest';
import { runDbt } from './dbtTerminal';

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
    this.watcher?.dispose();
    this.watcher = undefined;
    this.manifest = undefined;

    if (!root) {
      this._onDidChange.fire();
      return;
    }

    const pattern = new vscode.RelativePattern(root, 'target/manifest.json');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const reload = (): void => void this.load();
    this.watcher.onDidCreate(reload);
    this.watcher.onDidChange(reload);
    this.watcher.onDidDelete(reload);

    await this.load();
  }

  /** Read and parse the manifest for the current project root. */
  async load(): Promise<void> {
    const root = this.projectRoot;
    if (!root) {
      return;
    }
    const uri = vscode.Uri.joinPath(vscode.Uri.file(root), 'target', 'manifest.json');
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      this.manifest = normaliseManifest(JSON.parse(Buffer.from(bytes).toString('utf8')));
      this.parsePrompted = false;
      this.log(`manifest loaded for ${root}: ${this.modelCount} model(s)`);
    } catch (err) {
      this.manifest = undefined;
      this.log(`manifest unavailable for ${root}: ${(err as Error).message}`);
      this.promptParse(root);
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

  /** Absolute on-disk path for a node id (model or source), if it has one. */
  absolutePathForNode(id: string): string | undefined {
    const node = this.manifest?.nodes[id] ?? this.manifest?.sources[id];
    if (!node?.original_file_path || !this.projectRoot) {
      return undefined;
    }
    return path.join(this.projectRoot, node.original_file_path);
  }

  /** Lineage subgraph around a node id; empty graph when no manifest is loaded. */
  lineageAround(centreId: string, upstreamDepth: number, downstreamDepth: number): LineageGraph {
    if (!this.manifest) {
      return { nodes: [], edges: [] };
    }
    return buildLineageSubgraph(this.manifest, centreId, upstreamDepth, downstreamDepth);
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
    this.watcher?.dispose();
    this._onDidChange.dispose();
  }
}
