import { spawn } from 'child_process';
import { dbtCommand } from './dbtTerminal';

/** Row limit offered when the user is asked how much to preview. */
export const DEFAULT_PREVIEW_LIMIT = 20;

/**
 * Split a configured `dbtBooster.dbtPath` like `dbt`, `C:\...\dbt.exe`, or
 * `uv run dbt` into a program to launch and its leading args.
 */
function splitCommand(command: string): [program: string, leadingArgs: string[]] {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return ['dbt', []];
  }
  const [program, ...leadingArgs] = parts;
  return [program, leadingArgs];
}

/**
 * Run `dbt show --select <model> --limit <limit> --output json` as a background
 * process (not the shared terminal) so its output can be parsed.
 */
export function runDbtShow(
  modelName: string,
  cwd: string,
  limit: number = DEFAULT_PREVIEW_LIMIT,
): Promise<string> {
  return runDbtShowWith(['--select', modelName], cwd, limit);
}

/**
 * Same as {@link runDbtShow}, but for an arbitrary SQL fragment (an editor
 * selection) rather than a named model. dbt compiles the inline SQL in the
 * project's context, so `{{ ref('…') }}` inside the fragment still resolves.
 *
 * Needs dbt-core 1.5 or newer, which is where `--inline` arrived; on an older
 * dbt the usage error comes back through the returned text like any other
 * failure. The SQL travels as a single argv entry — see the shell note on
 * {@link runDbtShowWith} for why that matters.
 */
export function runDbtShowInline(
  sql: string,
  cwd: string,
  limit: number = DEFAULT_PREVIEW_LIMIT,
): Promise<string> {
  return runDbtShowWith(['--inline', sql], cwd, limit);
}

/**
 * The shared `dbt show` spawn. Resolves with the combined stdout+stderr text;
 * never rejects — a launch failure (including "command not found") is folded
 * into a readable message so callers can hand it straight to the show parser.
 *
 * Deliberately spawned without a shell: a shell wrapper (cmd.exe) swallows a
 * missing-executable failure into its own localized "not recognized" text —
 * on a non-English Windows that text is emitted in the console's OEM codepage,
 * which then comes out as mojibake once decoded as UTF-8 below, hiding the
 * real problem. Spawning the program directly gives a clean Node-level
 * `ENOENT` we can turn into an actionable message instead. It also means a
 * multi-line `--inline` payload needs no quoting or escaping at all.
 */
function runDbtShowWith(selector: string[], cwd: string, limit: number): Promise<string> {
  return new Promise((resolve) => {
    const [program, leadingArgs] = splitCommand(dbtCommand());
    const args = [
      ...leadingArgs,
      'show',
      ...selector,
      '--limit',
      String(limit),
      '--output',
      'json',
    ];
    const chunks: Buffer[] = [];
    let child;
    try {
      child = spawn(program, args, {
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
      resolve(`Error launching dbt: ${(err as Error).message}`);
      return;
    }
    // Buffer raw bytes and decode once at the end — decoding each chunk on
    // its own can split a multi-byte UTF-8 character across a chunk boundary
    // and corrupt it.
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', (err: NodeJS.ErrnoException) => {
      const hint =
        err.code === 'ENOENT'
          ? ` "${program}" was not found. Check that dbt is installed and on PATH, or set ` +
            `dbtBooster.dbtPath to its full path (e.g. the dbt.exe inside your virtualenv's ` +
            `Scripts folder).`
          : '';
      resolve(`Error launching dbt: ${err.message}${hint}`);
    });
    child.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}
