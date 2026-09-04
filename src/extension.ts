import * as vscode from 'vscode';
import * as path from 'path';
import { ProjectRegistry } from './projectRegistry';
import { ManifestStore } from './manifestStore';
import { disposeDbtTerminal } from './dbtTerminal';

let output: vscode.OutputChannel | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel('dbt booster');
  const log = (message: string): void => output?.appendLine(`[dbt booster] ${message}`);
  context.subscriptions.push(output);
  log(`activated at ${new Date().toISOString()}`);

  const registry = new ProjectRegistry(log);
  const manifestStore = new ManifestStore(log);
  context.subscriptions.push(registry, manifestStore, { dispose: disposeDbtTerminal });

  registry.onDidChangeActive((root) => void manifestStore.setProject(root));

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
  );

  await registry.refresh();
}

export function deactivate(): void {
  output?.appendLine('[dbt booster] deactivated');
}
