import * as vscode from 'vscode';

const TERMINAL_NAME = 'dbt-booster';

let terminal: vscode.Terminal | undefined;
let terminalCwd: string | undefined;

/** The configured dbt invocation (`dbtBooster.dbtPath`), defaulting to `dbt`. */
export function dbtCommand(): string {
  return vscode.workspace.getConfiguration('dbtBooster').get<string>('dbtPath')?.trim() || 'dbt';
}

/**
 * Run `dbt <args>` in a single integrated terminal the extension reuses. The
 * terminal is recreated when it has exited or when the target project root
 * changes (its working directory is fixed at creation).
 */
export function runDbt(args: string[], cwd: string): void {
  if (!terminal || terminal.exitStatus !== undefined || terminalCwd !== cwd) {
    terminal?.dispose();
    terminal = vscode.window.createTerminal({ name: TERMINAL_NAME, cwd });
    terminalCwd = cwd;
  }
  terminal.show(true);
  terminal.sendText([dbtCommand(), ...args].join(' '));
}

export function disposeDbtTerminal(): void {
  terminal?.dispose();
  terminal = undefined;
  terminalCwd = undefined;
}
