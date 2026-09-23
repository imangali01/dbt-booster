/**
 * PURE: the preview table's client-side logic that is worth testing — the
 * per-column value filters (Excel-style checklists) and how far a "load more"
 * click moves the row limit.
 *
 * `passesValueFilters` and `distinctValues` are also embedded verbatim (via
 * `toString()`) in the preview webview's inline script, so each must stay
 * self-contained: no imports, no helpers, no closure over module state.
 */

/** One entry of a column's filter checklist. */
export interface DistinctValue {
  /** The cell text, or `null` for SQL NULL. */
  value: string | null;
  /** How many rows hold it. */
  count: number;
}

/**
 * Does a row survive every column's value filter? `excluded[i]` lists the
 * values unticked in column `i`'s checklist (`null` = NULL); a missing or
 * empty entry filters nothing. Storing what is *excluded* rather than what is
 * kept means values that arrive with a "load more" are shown by default.
 */
export function passesValueFilters(
  cells: (string | null)[],
  excluded: ((string | null)[] | undefined)[],
): boolean {
  for (let i = 0; i < excluded.length; i++) {
    const out = excluded[i];
    if (out && out.length > 0 && out.indexOf(cells[i] === undefined ? null : cells[i]) !== -1) {
      return false;
    }
  }
  return true;
}

/**
 * Column `col`'s distinct values with their row counts, for its filter
 * checklist: numeric order when every non-NULL value is a number, otherwise
 * alphabetical; NULL last.
 */
export function distinctValues(rows: (string | null)[][], col: number): DistinctValue[] {
  const counts = new Map<string | null, number>();
  for (const row of rows) {
    const value = row[col] === undefined ? null : row[col];
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const values: DistinctValue[] = [];
  let allNumeric = true;
  counts.forEach((count, value) => {
    values.push({ value, count });
    if (value !== null && (value.trim() === '' || Number.isNaN(Number(value)))) {
      allNumeric = false;
    }
  });
  values.sort((a, b) => {
    if (a.value === null) return b.value === null ? 0 : 1;
    if (b.value === null) return -1;
    return allNumeric ? Number(a.value) - Number(b.value) : a.value.localeCompare(b.value);
  });
  return values;
}

/**
 * The row limit after asking for `more` rows on top of `current`. `dbt show`
 * has no offset, so "more" re-runs it with a bigger limit. A `more` that is not
 * a positive whole number falls back to `fallback`.
 */
export function nextPreviewLimit(current: number, more: unknown, fallback: number): number {
  const n = Number(more);
  return current + (Number.isInteger(n) && n > 0 ? n : fallback);
}

/** Every row the query has was loaded — dbt returned fewer than it was allowed to. */
export function allRowsLoaded(rowCount: number, limit: number): boolean {
  return rowCount < limit;
}
