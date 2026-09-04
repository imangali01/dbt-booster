import * as vscode from 'vscode';

let output: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('dbt booster');
  context.subscriptions.push(output);
  output.appendLine(`[dbt booster] activated at ${new Date().toISOString()}`);
}

export function deactivate(): void {
  output?.appendLine('[dbt booster] deactivated');
}
