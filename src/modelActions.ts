import * as vscode from 'vscode';
import { ManifestStore } from './manifestStore';
import { runDbt } from './dbtTerminal';

export type DbtAction = 'run' | 'test' | 'build';

/**
 * Resolve the active editor's file to a model name via the manifest and run
 * `dbt <action> --select <model>` in the shared terminal. Shows an error and
 * runs nothing if the active file isn't a resolvable model.
 */
export function runModelAction(action: DbtAction, manifestStore: ManifestStore): void {
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

  runDbt([action, '--select', modelName], projectRoot);
}
