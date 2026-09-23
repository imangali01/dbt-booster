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
