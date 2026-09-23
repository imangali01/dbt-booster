/**
 * PURE: turning the configured `dbtBooster.dbtPath` and a list of dbt args
 * into something spawnable, and into something readable in a log line.
 */

/**
 * Split a configured command like `dbt`, `C:\...\dbt.exe`, or `uv run dbt`
 * into a program to launch and its leading args. An empty command falls back
 * to a bare `dbt`.
 */
export function splitCommand(command: string): [program: string, leadingArgs: string[]] {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return ['dbt', []];
  }
  const [program, ...leadingArgs] = parts;
  return [program, leadingArgs];
}

/** Default cut-off for a single argument in {@link describeArgs}. */
export const DESCRIBE_ARG_MAX = 60;

/**
 * Render `args` as one readable line for the output channel: newlines and runs
 * of whitespace collapsed so an `--inline` SQL payload cannot break the line in
 * two, anything with a space quoted, and anything over `maxArgLength` cut short
 * with an ellipsis.
 */
export function describeArgs(args: string[], maxArgLength: number = DESCRIBE_ARG_MAX): string {
  return args
    .map((arg) => {
      const collapsed = arg.replace(/\s+/g, ' ').trim();
      const shown =
        collapsed.length > maxArgLength ? `${collapsed.slice(0, maxArgLength)}…` : collapsed;
      return collapsed.includes(' ') ? `"${shown}"` : shown;
    })
    .join(' ');
}

/**
 * Global flags for every dbt run the extension starts: dbt's anonymous usage
 * tracking costs a network round trip at the end of each command (~2 s,
 * measured), and this extension promises no telemetry anyway.
 */
export const BASE_FLAGS = ['--no-send-anonymous-usage-stats'];

/**
 * Extra global flags for Preview's `dbt show`, which only needs to run one
 * SELECT. Measured on a 172-model ClickHouse project (ticket 24): 21 s → 11 s.
 * - `--no-populate-cache` skips listing every schema up front (one query per
 *   schema, ~6 s there); a macro that asks about a relation still gets its
 *   answer, dbt just looks that one schema up on demand.
 * - `--no-write-json` skips rewriting `target/manifest.json` and
 *   `run_results.json`, which a preview has no reason to touch — and which
 *   the manifest watcher would otherwise re-read mid-write.
 */
export const SHOW_FLAGS = [...BASE_FLAGS, '--no-populate-cache', '--no-write-json'];

/**
 * The full argument list for a Preview: `selector` is `['--select', model]` or
 * `['--inline', sql]`.
 */
export function showArgs(selector: string[], limit: number): string[] {
  return [...SHOW_FLAGS, 'show', ...selector, '--limit', String(limit), '--output', 'json'];
}

/** A terminal command (run/test/build/parse) with the {@link BASE_FLAGS} in front. */
export function terminalArgs(args: string[]): string[] {
  return [...BASE_FLAGS, ...args];
}
