/**
 * PURE: rendering measured durations, and decomposing the four timed dbt runs
 * of the "Diagnose dbt Performance" command into the phases they are made of.
 *
 * The point of the breakdown is that the phases nest: `dbt parse` pays for the
 * Python interpreter start before it parses anything, and `dbt show` pays for a
 * parse before it talks to the warehouse. Subtracting the inner run out of the
 * outer one leaves the cost each phase actually adds.
 */

/** One line of a timing report. */
export interface TimingRow {
  label: string;
  ms: number;
  /** Optional trailing hint, e.g. the dbt command the row was measured with. */
  note?: string;
}

/** Wall-clock times of the four runs the diagnostics command makes. */
export interface DbtPhaseTimings {
  /** `dbt --version` — the interpreter start and dbt's own imports, nothing else. */
  version: number;
  /** `dbt parse --no-partial-parse` — a full parse of every model. */
  coldParse: number;
  /** `dbt parse` — a partial parse off the cached manifest. */
  warmParse: number;
  /** `dbt show --inline "select 1 as x"` — a parse plus the warehouse round trip. */
  inlineShow: number;
}

/**
 * Human-readable duration: whole milliseconds below a second, one decimal of
 * seconds below a minute, minutes and seconds above that. A negative duration
 * reads as zero and an unmeasured one as an em dash.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) {
    return '—';
  }
  const value = Math.max(0, ms);
  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }
  if (value < 60_000) {
    return `${(value / 1000).toFixed(1)} s`;
  }
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes} m ${seconds} s`;
}

/**
 * Lay `rows` out as fixed-width lines — labels padded to a common width,
 * durations right-aligned so they line up, notes trailing.
 */
export function formatTimingReport(rows: TimingRow[]): string[] {
  const durations = rows.map((row) => formatDuration(row.ms));
  const labelWidth = Math.max(0, ...rows.map((row) => row.label.length));
  const durationWidth = Math.max(0, ...durations.map((text) => text.length));
  return rows.map((row, i) => {
    const line = `${row.label.padEnd(labelWidth)}  ${durations[i].padStart(durationWidth)}`;
    return row.note ? `${line}  ${row.note}` : line;
  });
}

/**
 * Turn the four measured runs into the phases they decompose into. Differences
 * are clamped at zero: the runs are measured once each, so a warm run beating a
 * cold one is noise, not a negative cost.
 */
export function explainDbtTimings(timings: DbtPhaseTimings): TimingRow[] {
  const { version, coldParse, warmParse, inlineShow } = timings;
  const since = (outer: number, inner: number): number => Math.max(0, outer - inner);
  return [
    { label: 'Python start + dbt import', ms: version, note: 'dbt --version' },
    {
      label: 'Full project parse',
      ms: since(coldParse, version),
      note: 'dbt parse --no-partial-parse, minus the interpreter start',
    },
    {
      label: 'Partial (warm) parse',
      ms: since(warmParse, version),
      note: 'dbt parse, minus the interpreter start',
    },
    {
      label: 'Warehouse connect + query',
      ms: since(inlineShow, warmParse),
      note: 'dbt show --inline, minus a warm parse',
    },
    {
      label: 'A warm Preview, end to end',
      ms: inlineShow,
      note: 'dbt show --inline "select 1 as x"',
    },
  ];
}
