import * as vscode from 'vscode';
import { ManifestStore } from './manifestStore';
import { runDbt } from './dbtTerminal';
import { showInlinePreview, showPreview } from './previewPanel';
import { prepareInlineSql } from './sqlSelection';

export type DbtAction = 'run' | 'test' | 'build' | 'preview';

/**
 * How much of the DAG around a model to include in a run/build, via dbt's
 * graph operators: `model` selects just the model, `upstream` selects
 * `+model` (the model and all its ancestors), `downstream` selects `model+`
 * (the model and all its descendants), `both` selects `+model+` (ancestors,
 * the model, and descendants). Only the Run and Build title-bar buttons'
 * "…With…" dropdowns offer a choice here — Test / Preview / graph node
 * actions stay scoped to the model alone.
 */
export type GraphScope = 'model' | 'upstream' | 'downstream' | 'both';

/** Actions whose title-bar button offers a scope dropdown. */
export type ScopedAction = 'run' | 'build';

function selectorFor(name: string, scope: GraphScope): string {
  switch (scope) {
    case 'upstream':
      return `+${name}`;
    case 'downstream':
      return `${name}+`;
    case 'both':
      return `+${name}+`;
    default:
      return name;
  }
}

/**
 * Run `dbt <action> --select <name>` in the shared terminal, or open the
 * preview panel for `name`. The single entry point shared by the editor
 * title-bar buttons (active file) and the lineage graph's node context menu
 * (right-clicked node) — both resolve a model name + project root, then call
 * this the same way. `manifestStore` only tells the preview panel where the
 * model's SQL lives, so it can show it above the rows.
 */
export function performModelAction(
  action: DbtAction,
  name: string,
  projectRoot: string,
  manifestStore: ManifestStore,
): void {
  if (action === 'preview') {
    void showPreview(name, projectRoot, manifestStore.sqlFilesForModel(name));
  } else {
    runDbt([action, '--select', name], projectRoot);
  }
}

/**
 * Preview the active editor's selection through `dbt show --inline`, with the
 * same starting row limit the Preview button uses. Unlike the model actions this
 * needs no manifest lookup — any SQL fragment runs, as long as we know which
 * project to run it in.
 */
export function previewActiveSelection(manifestStore: ManifestStore): void {
  const editor = vscode.window.activeTextEditor;
  const projectRoot = manifestStore.activeProjectRoot;
  if (!editor || !projectRoot) {
    void vscode.window.showErrorMessage(
      'dbt booster: open a SQL file inside a dbt project to preview a selection.',
    );
    return;
  }
  const selection = prepareInlineSql(editor.document.getText(editor.selection));
  if (!selection) {
    void vscode.window.showErrorMessage('dbt booster: select some SQL to preview first.');
    return;
  }
  void showInlinePreview(selection.sql, selection.label, projectRoot);
}

/** Run `dbt <action> --select <selector>` for `name`, widened per `scope`. */
export function runModelWithScope(
  action: ScopedAction,
  scope: GraphScope,
  name: string,
  projectRoot: string,
): void {
  runDbt([action, '--select', selectorFor(name, scope)], projectRoot);
}

const NOT_RESOLVABLE_MESSAGE =
  'dbt booster: the active file is not a resolvable dbt model. Open a model file in a project with an up-to-date manifest.';

function resolveActiveModel(
  manifestStore: ManifestStore,
): { modelName: string; projectRoot: string } | undefined {
  const editor = vscode.window.activeTextEditor;
  const fsPath =
    editor?.document.uri.scheme === 'file' ? editor.document.uri.fsPath : undefined;
  const projectRoot = manifestStore.activeProjectRoot;
  const modelName = fsPath ? manifestStore.resolveModelName(fsPath) : undefined;
  return projectRoot && modelName ? { modelName, projectRoot } : undefined;
}

/**
 * Resolve the active editor's file to a model name via the manifest and run
 * the action. Shows an error and runs nothing if the active file isn't a
 * resolvable model.
 */
export function runActiveModelAction(action: DbtAction, manifestStore: ManifestStore): void {
  const resolved = resolveActiveModel(manifestStore);
  if (!resolved) {
    void vscode.window.showErrorMessage(NOT_RESOLVABLE_MESSAGE);
    return;
  }
  performModelAction(action, resolved.modelName, resolved.projectRoot, manifestStore);
}

/**
 * The Preview Data button / command: with a non-blank selection in the active
 * editor, preview just that fragment (as {@link previewActiveSelection} does);
 * otherwise preview the whole active model. The graph's node context menu
 * does not come through here — it always previews the model.
 */
export function previewActive(manifestStore: ManifestStore): void {
  const editor = vscode.window.activeTextEditor;
  const hasSelection =
    editor !== undefined && prepareInlineSql(editor.document.getText(editor.selection)) !== undefined;
  if (hasSelection) {
    previewActiveSelection(manifestStore);
  } else {
    runActiveModelAction('preview', manifestStore);
  }
}

/** Same resolution as {@link runActiveModelAction}, for the Run/Build "…With…" dropdowns. */
export function runActiveModelWithScope(
  action: ScopedAction,
  scope: GraphScope,
  manifestStore: ManifestStore,
): void {
  const resolved = resolveActiveModel(manifestStore);
  if (!resolved) {
    void vscode.window.showErrorMessage(NOT_RESOLVABLE_MESSAGE);
    return;
  }
  runModelWithScope(action, scope, resolved.modelName, resolved.projectRoot);
}
