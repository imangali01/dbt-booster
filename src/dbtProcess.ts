import { spawn } from 'child_process';
import { describeArgs, splitCommand } from './dbtArgs';
import { dbtLog } from './dbtLog';
import { dbtCommand } from './dbtTerminal';
import { formatDuration } from './timing';

/** What one background dbt invocation produced, and how long it took. */
export interface CapturedRun {
  /** Combined stdout+stderr, decoded as UTF-8. */
  output: string;
  /** Wall-clock milliseconds from spawn to exit. */
  ms: number;
  /**
   * Milliseconds until dbt's first byte of output, or `undefined` when it
   * produced none. dbt is quiet while it starts up and parses, so this is a
   * usable split between "dbt was busy before it said anything" and the rest.
   */
  firstByteMs?: number;
  /** True when the process could not be launched at all (e.g. dbt not found). */
  launchFailed: boolean;
}

/**
 * Run `dbt <args>` in `cwd` as a background process (not the shared terminal),
 * capturing its output and timing it. Resolves rather than rejects: a launch
 * failure (including "command not found") is folded into `output` as a readable
 * message, so callers can hand it straight to a parser or show it as-is.
 *
 * Deliberately spawned without a shell: a shell wrapper (cmd.exe) swallows a
 * missing-executable failure into its own localized "not recognized" text —
 * on a non-English Windows that text is emitted in the console's OEM codepage,
 * which then comes out as mojibake once decoded as UTF-8 below, hiding the
 * real problem. Spawning the program directly gives a clean Node-level
 * `ENOENT` we can turn into an actionable message instead. It also means a
 * multi-line `--inline` payload needs no quoting or escaping at all.
 */
export function runDbtCaptured(args: string[], cwd: string): Promise<CapturedRun> {
  return new Promise((resolve) => {
    const [program, leadingArgs] = splitCommand(dbtCommand());
    const fullArgs = [...leadingArgs, ...args];
    const started = Date.now();
    let firstByteMs: number | undefined;

    // A failed launch fires both 'error' and 'close'; log and resolve once.
    let settled = false;
    const finish = (output: string, launchFailed: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      const ms = Date.now() - started;
      const firstOutput =
        firstByteMs === undefined ? '' : `, first output after ${formatDuration(firstByteMs)}`;
      dbtLog(`${program} ${describeArgs(fullArgs)} → ${formatDuration(ms)}${firstOutput}`);
      resolve({ output, ms, firstByteMs, launchFailed });
    };

    let child;
    try {
      child = spawn(program, fullArgs, {
        cwd,
        env: {
          ...process.env,
          // dbt is a Python process. When its stdout is piped (not a real
          // console), Python can fall back to the system's ANSI/OEM codepage
          // on Windows instead of UTF-8 — garbling any non-ASCII output
          // (Cyrillic, etc.) once we decode the bytes as UTF-8 below. Force
          // UTF-8 on the Python side so the two ends agree.
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
        },
      });
    } catch (err) {
      finish(`Error launching dbt: ${(err as Error).message}`, true);
      return;
    }

    // Buffer raw bytes and decode once at the end — decoding each chunk on
    // its own can split a multi-byte UTF-8 character across a chunk boundary
    // and corrupt it.
    const chunks: Buffer[] = [];
    const collect = (chunk: Buffer): void => {
      firstByteMs ??= Date.now() - started;
      chunks.push(chunk);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', (err: NodeJS.ErrnoException) => {
      const hint =
        err.code === 'ENOENT'
          ? ` "${program}" was not found. Check that dbt is installed and on PATH, or set ` +
            `dbtBooster.dbtPath to its full path (e.g. the dbt.exe inside your virtualenv's ` +
            `Scripts folder).`
          : '';
      finish(`Error launching dbt: ${err.message}${hint}`, true);
    });
    child.on('close', () => finish(Buffer.concat(chunks).toString('utf8'), false));
  });
}
