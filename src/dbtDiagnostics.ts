import * as vscode from 'vscode';
import { runDbtCaptured } from './dbtProcess';
import { dbtCommand } from './dbtTerminal';
import {
  explainDbtTimings,
  formatDuration,
  formatTimingReport,
  type DbtPhaseTimings,
} from './timing';

/**
 * Measure where a dbt invocation's fixed cost goes on this project, and write
 * the breakdown to the output channel.
 *
 * Run / Test / Build carry no extension overhead worth measuring — the
 * extension writes one line into a terminal and dbt does the rest — so the
 * question worth answering is which phase of dbt's own startup dominates.
 * Four runs, each nested inside the next, answer it:
 *
 *   1. `dbt --version`                 interpreter start + dbt's imports
 *   2. `dbt parse --no-partial-parse`  + a full parse of every model
 *   3. `dbt parse`                     + a partial parse off the cached manifest
 *   4. `dbt show --inline "select 1"`  + the adapter connecting and querying
 *
 * `--no-partial-parse` is what makes run 2 cold without touching the project:
 * deleting `target/partial_parse.msgpack` would do the same, but this command
 * measures, it does not modify.
 */
export async function diagnoseDbtPerformance(
  projectRoot: string,
  log: (message: string) => void,
  showOutput: () => void,
): Promise<void> {
  showOutput();
  log('');
  log(`--- dbt performance diagnostics: ${projectRoot}`);
  log(`--- dbt command: ${dbtCommand()}`);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'dbt booster: measuring dbt…' },
    async (progress) => {
      const phases: Array<[keyof DbtPhaseTimings, string, string[]]> = [
        ['version', 'dbt --version', ['--version']],
        ['coldParse', 'full parse', ['parse', '--no-partial-parse']],
        ['warmParse', 'partial parse', ['parse']],
        [
          'inlineShow',
          'inline show',
          ['show', '--inline', 'select 1 as x', '--limit', '1', '--output', 'json'],
        ],
      ];
      const timings = {} as DbtPhaseTimings;
      for (const [key, title, args] of phases) {
        progress.report({ message: title });
        const run = await runDbtCaptured(args, projectRoot);
        if (run.launchFailed) {
          log(`  ${title}: could not launch dbt — ${run.output}`);
          log('--- diagnostics stopped: dbt could not be launched.');
          void vscode.window.showErrorMessage(
            'dbt booster: could not launch dbt — see the "dbt booster" output channel.',
          );
          return;
        }
        log(`  ${title}: ${formatDuration(run.ms)}`);
        timings[key] = run.ms;
      }

      log('');
      log('  Where the time goes:');
      for (const line of formatTimingReport(explainDbtTimings(timings))) {
        log(`    ${line}`);
      }
      log('--- end of dbt performance diagnostics');
      void vscode.window.showInformationMessage(
        'dbt booster: diagnostics done — see the "dbt booster" output channel.',
      );
    },
  );
}
