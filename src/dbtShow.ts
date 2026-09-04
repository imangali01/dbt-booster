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
    const chunks: Buffer[] = [];
    let child;
    try {
      child = spawn(dbtCommand(), args, {
        cwd,
        shell: true,
        env: {
          ...process.env,
          // dbt is a Python process. When its stdout is piped (not a real
          // console) rather than UTF-8, Python falls back to the system's
          // ANSI/OEM codepage on Windows — garbling any non-ASCII output
          // (Cyrillic, etc.) once we decode the bytes as UTF-8 below. Force
          // UTF-8 on the Python side so the two ends agree.
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
        },
      });
    } catch (err) {
      resolve(`Error launching dbt: ${(err as Error).message}`);
      return;
    }
    // Buffer raw bytes and decode once at the end — decoding each chunk on
    // its own can split a multi-byte UTF-8 character across a chunk boundary
    // and corrupt it.
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', (err) => resolve(`Error launching dbt: ${err.message}`));
    child.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}
