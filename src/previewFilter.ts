/**
 * PURE: the preview table's client-side logic that is worth testing — the
 * column filters and how far a "load more" click moves the row limit.
 *
 * `matchesFilters` is also embedded verbatim (via `toString()`) in the preview
 * webview's inline script, so it must stay self-contained: no imports, no
 * helpers, no closure over module state.
 */

/**
 * Does a row pass every column filter? A filter is a case-insensitive
 * substring match against its column's text; a blank filter matches anything,
 * and a NULL cell reads as `null` so it can be filtered for too.
 */
export function matchesFilters(cells: (string | null)[], filters: string[]): boolean {
  for (let i = 0; i < filters.length; i++) {
    const needle = (filters[i] || '').trim().toLowerCase();
    if (needle === '') {
      continue;
    }
    const cell = cells[i];
    const text = cell === null || cell === undefined ? 'null' : String(cell).toLowerCase();
    if (text.indexOf(needle) === -1) {
      return false;
    }
  }
  return true;
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
