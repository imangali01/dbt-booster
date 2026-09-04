import * as vscode from 'vscode';
import { ManifestStore } from './manifestStore';
import { runDbt } from './dbtTerminal';
import { showPreview } from './previewPanel';
import { DEFAULT_PREVIEW_LIMIT } from './dbtShow';

export type DbtAction = 'run' | 'test' | 'build' | 'preview';

/**
 * How much of the DAG around a model to include in a `run`, via dbt's graph
 * operators: `model` selects just the model, `upstream` selects `+model` (the
 * model and all its ancestors), `downstream` selects `model+` (the model and
 * all its descendants). Only the Run title-bar button offers a choice here —
 * every other action (Test / Build / Preview / graph node actions) stays
 * scoped to the model alone.
 */
export type RunScope = 'model' | 'upstream' | 'downstream';

function selectorFor(name: string, scope: RunScope): string {
  switch (scope) {
    case 'upstream':
      return `+${name}`;
    case 'downstream':
      return `${name}+`;
    default:
      return name;
  }
}

/**
 * Run `dbt <action> --select <name>` in the shared terminal, or open the
 * preview panel for `name`. The single entry point shared by the editor
 * title-bar buttons (active file) and the lineage graph's node context menu
 * (right-clicked node) — both resolve a model name + project root, then call
 * this the same way.
 */
export function performModelAction(action: DbtAction, name: string, projectRoot: string): void {
  if (action === 'preview') {
    void previewWithLimitPrompt(name, projectRoot);
  } else {
    runDbt([action, '--select', name], projectRoot);
  }
}

/** Ask how many rows to preview (defaulting to {@link DEFAULT_PREVIEW_LIMIT}), then run it. */
async function previewWithLimitPrompt(name: string, projectRoot: string): Promise<void> {
  const entered = await vscode.window.showInputBox({
    title: `dbt booster: Preview "${name}"`,
    prompt: 'Row limit',
    value: String(DEFAULT_PREVIEW_LIMIT),
    validateInput: (value) => {
      const n = Number(value);
      return Number.isInteger(n) && n > 0 ? undefined : 'Enter a positive whole number';
    },
  });
  if (entered === undefined) {
    return; // cancelled
  }
  void showPreview(name, projectRoot, Number(entered));
}

/** Run `dbt run --select <selector>` for `name`, widened per `scope`. */
export function runModelWithScope(scope: RunScope, name: string, projectRoot: string): void {
  runDbt(['run', '--select', selectorFor(name, scope)], projectRoot);
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
  performModelAction(action, resolved.modelName, resolved.projectRoot);
}

/** Same resolution as {@link runActiveModelAction}, for the Run-variants dropdown. */
export function runActiveModelWithScope(scope: RunScope, manifestStore: ManifestStore): void {
  const resolved = resolveActiveModel(manifestStore);
  if (!resolved) {
    void vscode.window.showErrorMessage(NOT_RESOLVABLE_MESSAGE);
    return;
  }
  runModelWithScope(scope, resolved.modelName, resolved.projectRoot);
}
