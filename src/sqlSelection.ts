/**
 * PURE: turn an editor selection into something `dbt show --inline` can run.
 *
 * The selection is handed to dbt verbatim apart from trimming and a trailing
 * `;` — jinja such as `{{ ref('…') }}` stays in place because dbt compiles the
 * inline SQL in the project's context, which is the whole point of previewing
 * a fragment of a model.
 */

export interface InlineSqlSelection {
  /** The SQL to pass to `dbt show --inline`. */
  sql: string;
  /** A short single-line label for the preview panel's title. */
  label: string;
}

/** How long a panel-title label may get before it is cut short. */
export const INLINE_LABEL_MAX = 40;

/**
 * Normalise `text` for an inline preview, or return `undefined` when there is
 * nothing runnable in it (blank, or only semicolons).
 */
export function prepareInlineSql(text: string): InlineSqlSelection | undefined {
  const sql = text.trim().replace(/[;\s]+$/, '');
  if (sql === '') {
    return undefined;
  }
  return { sql, label: labelFor(sql) };
}

/**
 * First line that reads like SQL rather than a comment, whitespace-collapsed
 * and cut to {@link INLINE_LABEL_MAX}. A selection that is all comments falls
 * back to its first line so the panel title is never empty.
 */
function labelFor(sql: string): string {
  const lines = sql
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  const line = lines.find((candidate) => !candidate.startsWith('--')) ?? lines[0] ?? '';
  return line.length > INLINE_LABEL_MAX ? `${line.slice(0, INLINE_LABEL_MAX)}…` : line;
}
