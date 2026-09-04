import * as vscode from 'vscode';
import * as path from 'path';
import { resolveActiveProjectRoot } from './projectResolution';

const DBT_PROJECT_GLOB = '**/dbt_project.yml';
const EXCLUDE_GLOB =
  '{**/node_modules/**,**/dbt_packages/**,**/dbt_modules/**,**/.venv/**,**/venv/**,**/site-packages/**}';

const CASE_INSENSITIVE = process.platform === 'win32';

/**
 * Discovers every `dbt_project.yml` in the workspace and tracks which project is
 * "active" — resolved from the active editor, with a pinned-then-first fallback.
 * Exposes that as the `dbtBooster.projectDetected` context key plus an event.
 */
export class ProjectRegistry implements vscode.Disposable {
  private roots: string[] = [];
  private pinned: string | undefined;
  private active: string | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly _onDidChangeActive = new vscode.EventEmitter<string | undefined>();

  /** Fires whenever the resolved active project root changes (including to/from undefined). */
  readonly onDidChangeActive = this._onDidChangeActive.event;

  constructor(private readonly log: (message: string) => void) {
    const watcher = vscode.workspace.createFileSystemWatcher(DBT_PROJECT_GLOB);
    watcher.onDidCreate(() => void this.refresh(), undefined, this.disposables);
    watcher.onDidDelete(() => void this.refresh(), undefined, this.disposables);
    this.disposables.push(
      watcher,
      this._onDidChangeActive,
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh()),
      vscode.window.onDidChangeActiveTextEditor(() => this.recomputeActive()),
    );
  }

  get allRoots(): readonly string[] {
    return this.roots;
  }

  get activeRoot(): string | undefined {
    return this.active;
  }

  /** Re-scan the workspace for dbt projects and refresh context keys + active root. */
  async refresh(): Promise<void> {
    const files = await vscode.workspace.findFiles(DBT_PROJECT_GLOB, EXCLUDE_GLOB);
    const roots = [...new Set(files.map((uri) => path.dirname(uri.fsPath)))].sort();
    this.roots = roots;
    if (this.pinned && !roots.includes(this.pinned)) {
      this.pinned = undefined;
    }
    void vscode.commands.executeCommand(
      'setContext',
      'dbtBooster.projectDetected',
      roots.length > 0,
    );
    void vscode.commands.executeCommand(
      'setContext',
      'dbtBooster.multipleProjects',
      roots.length > 1,
    );
    this.log(`discovered ${roots.length} dbt project(s): ${roots.join(', ') || '(none)'}`);
    this.recomputeActive();
  }

  /** Pin an explicit project as active (from the Select command). */
  pin(root: string): void {
    if (!this.roots.includes(root)) {
      return;
    }
    this.pinned = root;
    this.recomputeActive();
  }

  private recomputeActive(): void {
    const editor = vscode.window.activeTextEditor;
    const activeFile =
      editor && editor.document.uri.scheme === 'file' ? editor.document.uri.fsPath : undefined;
    const next = resolveActiveProjectRoot(this.roots, activeFile, this.pinned, CASE_INSENSITIVE);
    if (next !== this.active) {
      this.active = next;
      this.log(`active dbt project: ${next ?? '(none)'}`);
      this._onDidChangeActive.fire(next);
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
