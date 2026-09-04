/**
 * PURE: parse the stdout of `dbt show --select <model> --limit 500 --output json`
 * into a column list and row values. Tolerant of surrounding log lines (plain text
 * or structured JSON log lines) — it scans the whole text for embedded JSON
 * values and picks the last one that matches a known `dbt show` shape.
 */

export interface DbtShowResult {
  ok: boolean;
  columns: string[];
  rows: unknown[][];
  /** Set when `ok` is false: a readable message to show the user. */
  message?: string;
}

export function parseDbtShowOutput(raw: string): DbtShowResult {
  const candidates = extractJsonValues(raw);
  for (let i = candidates.length - 1; i >= 0; i--) {
    const interpreted = interpretShowJson(candidates[i]);
    if (interpreted) {
      return interpreted;
    }
  }
  return { ok: false, columns: [], rows: [], message: fallbackMessage(raw) };
}

function interpretShowJson(value: unknown): DbtShowResult | undefined {
  if (Array.isArray(value)) {
    return rowsFromObjects(value);
  }
  if (!isRecord(value)) {
    return undefined;
  }
  if (Array.isArray(value.show)) {
    return rowsFromObjects(value.show);
  }
  if (isRecord(value.show)) {
    const fromNested = columnsAndRows(value.show);
    if (fromNested) {
      return fromNested;
    }
  }
  return columnsAndRows(value);
}

function columnsAndRows(value: Record<string, unknown>): DbtShowResult | undefined {
  if (Array.isArray(value.column_names) && Array.isArray(value.rows)) {
    return {
      ok: true,
      columns: value.column_names.map(String),
      rows: value.rows as unknown[][],
    };
  }
  return undefined;
}

function rowsFromObjects(items: unknown[]): DbtShowResult | undefined {
  if (items.length === 0) {
    return { ok: true, columns: [], rows: [] };
  }
  if (!items.every(isRecord)) {
    return undefined;
  }
  const columns = Object.keys(items[0] as Record<string, unknown>);
  const rows = items.map((item) => columns.map((col) => (item as Record<string, unknown>)[col]));
  return { ok: true, columns, rows };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fallbackMessage(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? 'dbt show produced no output.';
}

/** Scan `text` for every top-level `{...}` / `[...]` value that parses as JSON. */
function extractJsonValues(text: string): unknown[] {
  const values: unknown[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{' || ch === '[') {
      const end = matchingBracket(text, i);
      if (end !== undefined) {
        try {
          values.push(JSON.parse(text.slice(i, end + 1)));
        } catch {
          // Not valid JSON at this position — keep scanning past it.
        }
        i = end + 1;
        continue;
      }
    }
    i++;
  }
  return values;
}

/** Index of the bracket matching the opener at `start`, honouring string literals. */
function matchingBracket(text: string, start: number): number | undefined {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return undefined;
}
