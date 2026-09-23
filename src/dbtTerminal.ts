import * as vscode from 'vscode';
import { dbtLog } from './dbtLog';
import { terminalArgs } from './dbtArgs';
import {
  INITIAL_RUN_PROGRESS,
  RUN_STAGES,
  advanceRunProgress,
  describeRunProgress,
  runPercent,
  stripAnsi,
  textBar,
} from './runProgress';

const TERMINAL_NAME = 'dbt-booster';

/** How long a fresh terminal gets to report shell integration before we give up on progress. */
const SHELL_INTEGRATION_WAIT_MS = 4000;

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
 *
 * When the terminal's shell supports VS Code shell integration (PowerShell,
 * bash, zsh, fish — not cmd.exe), the command is run through it so its output
 * can be read: a progress notification then follows dbt's stages and node
 * count (ticket 26). Without it, the line is just typed into the terminal.
 */
export function runDbt(args: string[], cwd: string): void {
  if (!terminal || terminal.exitStatus !== undefined || terminalCwd !== cwd) {
    terminal?.dispose();
    terminal = vscode.window.createTerminal({ name: TERMINAL_NAME, cwd });
    terminalCwd = cwd;
  }
  terminal.show(true);
  const line = [dbtCommand(), ...terminalArgs(args)].join(' ');
  dbtLog(`${line} (terminal)`);
  void runWithProgress(terminal, line, `dbt ${args.join(' ')}`);
}

async function runWithProgress(term: vscode.Terminal, line: string, title: string): Promise<void> {
  const integration = term.shellIntegration ?? (await waitForShellIntegration(term));
  if (!integration) {
    term.sendText(line);
    dbtLog('  (no shell integration in this terminal — running without a progress bar)');
    return;
  }
  const execution = integration.executeCommand(line);
  const ended = new Promise<number | undefined>((resolve) => {
    const sub = vscode.window.onDidEndTerminalShellExecution((event) => {
      if (event.execution === execution) {
        sub.dispose();
        resolve(event.exitCode);
      }
    });
  });

  const started = Date.now();
  let state = INITIAL_RUN_PROGRESS;
  let stageStarted = started;
  const stageMs: number[] = [];

  const exitCode = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title },
    async (progress) => {
      let reported = 0;
      const update = () => {
        const now = Date.now();
        const pct = runPercent(state);
        progress.report({
          message: `${textBar(pct)}  ${describeRunProgress(state, now - stageStarted, now - started)}`,
          increment: pct > reported ? pct - reported : undefined,
        });
        reported = Math.max(reported, pct);
      };
      const timer = setInterval(update, 250);
      update();

      const reading = (async () => {
        let tail = '';
        for await (const data of execution.read()) {
          const lines = (tail + stripAnsi(data)).split(/\r?\n|\r/);
          tail = lines.pop() ?? '';
          for (const text of lines) {
            const next = advanceRunProgress(state, text);
            if (next.stage !== state.stage) {
              const now = Date.now();
              stageMs[state.stage] = now - stageStarted;
              stageStarted = now;
            }
            state = next;
          }
        }
        state = advanceRunProgress(state, tail);
      })();

      const code = await ended;
      // The output stream ends with the execution; don't hang if it doesn't.
      await Promise.race([reading, new Promise((r) => setTimeout(r, 1000))]);
      clearInterval(timer);
      return code;
    },
  );

  const totalMs = Date.now() - started;
  stageMs[state.stage] = Date.now() - stageStarted;
  const nodes = state.total > 0 ? `, ${state.done}/${state.total} nodes, ${state.failed} failed` : '';
  const ok = exitCode === 0;
  const verdict = exitCode === undefined ? 'finished' : ok ? 'succeeded' : `failed (exit ${exitCode})`;
  const summary = `${title} ${verdict} in ${(totalMs / 1000).toFixed(1)} s${nodes}`;
  dbtLog(
    `  ${verdict} in ${(totalMs / 1000).toFixed(1)} s${nodes} — ` +
      RUN_STAGES.map((s, i) => `${s.label} ${((stageMs[i] ?? 0) / 1000).toFixed(1)} s`).join(' · '),
  );
  if (ok || exitCode === undefined) {
    vscode.window.setStatusBarMessage(`$(check) ${summary}`, 10000);
  } else {
    void vscode.window.showWarningMessage(`dbt booster: ${summary}. See the dbt-booster terminal.`);
  }
}

/** Resolve with `term`'s shell integration once it activates, or undefined after a timeout. */
function waitForShellIntegration(
  term: vscode.Terminal,
): Promise<vscode.TerminalShellIntegration | undefined> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      sub.dispose();
      resolve(undefined);
    }, SHELL_INTEGRATION_WAIT_MS);
    const sub = vscode.window.onDidChangeTerminalShellIntegration((event) => {
      if (event.terminal === term) {
        clearTimeout(timeout);
        sub.dispose();
        resolve(event.shellIntegration);
      }
    });
  });
}

export function disposeDbtTerminal(): void {
  terminal?.dispose();
  terminal = undefined;
  terminalCwd = undefined;
}
