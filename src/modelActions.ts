import * as vscode from 'vscode';
import { ManifestStore } from './manifestStore';
import { runDbt } from './dbtTerminal';
import { showPreview } from './previewPanel';

export type DbtAction = 'run' | 'test' | 'build' | 'preview';

/**
 * Run `dbt <action> --select <name>` in the shared terminal, or open the
 * preview panel for `name`. The single entry point shared by the editor
 * title-bar buttons (active file) and the lineage graph's node context menu
 * (right-clicked node) — both resolve a model name + project root, then call
 * this the same way.
 */
export function performModelAction(action: DbtAction, name: string, projectRoot: string): void {
  if (action === 'preview') {
    void showPreview(name, projectRoot);
  } else {
    runDbt([action, '--select', name], projectRoot);
  }
}

/**
 * Resolve the active editor's file to a model name via the manifest and run
 * the action. Shows an error and runs nothing if the active file isn't a
 * resolvable model.
 */
export function runActiveModelAction(action: DbtAction, manifestStore: ManifestStore): void {
  const editor = vscode.window.activeTextEditor;
  const fsPath =
    editor?.document.uri.scheme === 'file' ? editor.document.uri.fsPath : undefined;
  const projectRoot = manifestStore.activeProjectRoot;
  const modelName = fsPath ? manifestStore.resolveModelName(fsPath) : undefined;

  if (!projectRoot || !modelName) {
    void vscode.window.showErrorMessage(
      'dbt booster: the active file is not a resolvable dbt model. Open a model file in a project with an up-to-date manifest.',
    );
    return;
  }

  performModelAction(action, modelName, projectRoot);
}
