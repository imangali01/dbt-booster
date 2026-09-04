import { spawn } from 'child_process';
import { dbtCommand } from './dbtTerminal';

const PREVIEW_LIMIT = 500;

/**
 * Run `dbt show --select <model> --limit 500 --output json` as a background
 * process (not the shared terminal) so its output can be parsed. Resolves with
 * the combined stdout+stderr text; never rejects — a launch failure is folded
 * into the returned text so callers can hand it straight to the show parser.
 */
export function runDbtShow(modelName: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const args = [
      'show',
      '--select',
      modelName,
      '--limit',
      String(PREVIEW_LIMIT),
      '--output',
      'json',
    ];
    let out = '';
    let child;
    try {
      child = spawn(dbtCommand(), args, { cwd, shell: true });
    } catch (err) {
      resolve(`Error launching dbt: ${(err as Error).message}`);
      return;
    }
    child.stdout?.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.on('error', (err) => resolve(`Error launching dbt: ${err.message}`));
    child.on('close', () => resolve(out));
  });
}
