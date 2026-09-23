import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectRegistry } from './projectRegistry';
import { ManifestStore } from './manifestStore';
import { LineagePanelProvider } from './lineagePanelProvider';
import { DocsPanelProvider } from './docsPanelProvider';
import { ProjectInfoProvider } from './projectInfoProvider';
import {
  ChildrenModelsProvider,
  DocumentationProvider,
  ModelTestsProvider,
  ParentModelsProvider,
} from './activeModelProviders';
import { disposeDbtTerminal, runDbt } from './dbtTerminal';
import {
  previewActiveSelection,
  runActiveModelAction,
  runActiveModelWithScope,
} from './modelActions';
import { pickPythonEnvironment } from './pythonEnvironmentPicker';
import { describeDbtPath } from './pythonEnvironments';

let output: vscode.OutputChannel | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel('dbt booster');
  const log = (message: string): void => output?.appendLine(`[dbt booster] ${message}`);
  context.subscriptions.push(output);
  log(`activated at ${new Date().toISOString()}`);

  const registry = new ProjectRegistry(log);
  const manifestStore = new ManifestStore(log);
  const lineagePanel = new LineagePanelProvider(
    context.extensionUri,
    manifestStore,
    () => registry.activeRoot,
  );
  const docsPanel = new DocsPanelProvider(context.extensionUri, manifestStore);
  const projectInfo = new ProjectInfoProvider(registry, manifestStore);
  const modelTests = new ModelTestsProvider(manifestStore);
  const parentModels = new ParentModelsProvider(manifestStore);
  const childrenModels = new ChildrenModelsProvider(manifestStore);
  const documentation = new DocumentationProvider(manifestStore);
  context.subscriptions.push(
    registry,
    manifestStore,
    lineagePanel,
    docsPanel,
    projectInfo,
    modelTests,
    parentModels,
    childrenModels,
    documentation,
    { dispose: disposeDbtTerminal },
    vscode.window.registerWebviewViewProvider(LineagePanelProvider.viewId, lineagePanel, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider(DocsPanelProvider.viewId, docsPanel, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerTreeDataProvider('dbtBooster.projectInfo', projectInfo),
    vscode.window.registerTreeDataProvider('dbtBooster.modelTests', modelTests),
    vscode.window.registerTreeDataProvider('dbtBooster.parentModels', parentModels),
    vscode.window.registerTreeDataProvider('dbtBooster.childrenModels', childrenModels),
    vscode.window.registerTreeDataProvider('dbtBooster.documentation', documentation),
  );

  registry.onDidChangeActive((root) => void manifestStore.setProject(root));

  const pythonEnvStatusBar = vscode.window.createStatusBarItem(
    'dbtBooster.pythonEnv',
    vscode.StatusBarAlignment.Right,
    100,
  );
  pythonEnvStatusBar.name = 'dbt booster: Python Environment';
  pythonEnvStatusBar.command = 'dbtBooster.selectPythonEnvironment';
  const updatePythonEnvStatusBar = (): void => {
    const dbtPath = vscode.workspace.getConfiguration('dbtBooster').get<string>('dbtPath', 'dbt');
    const label = describeDbtPath(dbtPath || 'dbt');
    pythonEnvStatusBar.text = `$(server-environment) dbt: ${label}`;
    pythonEnvStatusBar.tooltip = `dbt booster — dbt command: ${dbtPath || 'dbt'}\nClick to select a Python environment`;
  };
  updatePythonEnvStatusBar();
  pythonEnvStatusBar.show();
  context.subscriptions.push(
    pythonEnvStatusBar,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('dbtBooster.dbtPath')) {
        updatePythonEnvStatusBar();
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('dbtBooster.showActiveProject', () => {
      const root = registry.activeRoot;
      void vscode.window.showInformationMessage(
        root ? `Active dbt project: ${root}` : 'No dbt project detected in this workspace.',
      );
    }),
    vscode.commands.registerCommand('dbtBooster.selectProject', async () => {
      const roots = registry.allRoots;
      if (roots.length === 0) {
        void vscode.window.showInformationMessage('No dbt project detected in this workspace.');
        return;
      }
      if (roots.length === 1) {
        void vscode.window.showInformationMessage(`Only one dbt project: ${roots[0]}`);
        return;
      }
      const pick = await vscode.window.showQuickPick(
        roots.map((root) => ({ label: path.basename(root), description: root, root })),
        { placeHolder: 'Pin the active dbt project' },
      );
      if (pick) {
        registry.pin(pick.root);
      }
    }),
    vscode.commands.registerCommand('dbtBooster.showModelCount', () => {
      void vscode.window.showInformationMessage(
        manifestStore.current
          ? `dbt booster: ${manifestStore.modelCount} model(s) in the active project.`
          : 'dbt booster: no manifest loaded. Run `dbt parse` first.',
      );
    }),
    vscode.commands.registerCommand('dbtBooster.refreshLineage', () => lineagePanel.refresh()),
    vscode.commands.registerCommand('dbtBooster.runModel', () =>
      runActiveModelAction('run', manifestStore),
    ),
    vscode.commands.registerCommand('dbtBooster.runModelWithUpstream', () =>
      runActiveModelWithScope('run', 'upstream', manifestStore),
    ),
    vscode.commands.registerCommand('dbtBooster.runModelWithDownstream', () =>
      runActiveModelWithScope('run', 'downstream', manifestStore),
    ),
    vscode.commands.registerCommand('dbtBooster.runModelWithBoth', () =>
      runActiveModelWithScope('run', 'both', manifestStore),
    ),
    vscode.commands.registerCommand('dbtBooster.testModel', () =>
      runActiveModelAction('test', manifestStore),
    ),
    vscode.commands.registerCommand('dbtBooster.buildModel', () =>
      runActiveModelAction('build', manifestStore),
    ),
    vscode.commands.registerCommand('dbtBooster.buildModelWithUpstream', () =>
      runActiveModelWithScope('build', 'upstream', manifestStore),
    ),
    vscode.commands.registerCommand('dbtBooster.buildModelWithDownstream', () =>
      runActiveModelWithScope('build', 'downstream', manifestStore),
    ),
    vscode.commands.registerCommand('dbtBooster.buildModelWithBoth', () =>
      runActiveModelWithScope('build', 'both', manifestStore),
    ),
    vscode.commands.registerCommand('dbtBooster.previewData', () =>
      runActiveModelAction('preview', manifestStore),
    ),
    vscode.commands.registerCommand('dbtBooster.previewSelectedSql', () =>
      previewActiveSelection(manifestStore),
    ),
    vscode.commands.registerCommand('dbtBooster.selectPythonEnvironment', () =>
      pickPythonEnvironment(registry.allRoots),
    ),
    vscode.commands.registerCommand('dbtBooster.runTestNode', (testName: string, root: string) =>
      runDbt(['test', '--select', testName], root),
    ),
  );

  await registry.refresh();
}

export function deactivate(): void {
  output?.appendLine('[dbt booster] deactivated');
}
