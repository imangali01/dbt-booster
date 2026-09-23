/**
 * PURE: which phase a Preview's `dbt show` is in, read off the log lines dbt
 * prints on its way to the result. Stage boundaries were taken from a timed
 * `--debug` run on a real project (ticket 25):
 *
 *   spawn ──▶ "Running with dbt=…"      Python start + dbt imports
 *         ──▶ "Registered adapter: …"   profile + adapter load
 *         ──▶ "Found N models, …"       partial-parse cache + graph build
 *         ──▶ exit                      connect, compile, run the query
 */

export interface PreviewStage {
  label: string;
  /** Output text that means this stage has begun; the first stage has none. */
  marker?: RegExp;
  /** Seconds this stage usually takes, before any run has been measured. */
  defaultSeconds: number;
}

export const PREVIEW_STAGES: readonly PreviewStage[] = [
  { label: 'Starting dbt (Python + imports)', defaultSeconds: 3.5 },
  { label: 'Loading profile and adapter', marker: /Running with dbt=/, defaultSeconds: 1 },
  { label: 'Loading project', marker: /Registered adapter:/, defaultSeconds: 4 },
  { label: 'Connecting and running query', marker: /Found \d+ models?/, defaultSeconds: 2.5 },
];

/**
 * The furthest stage `output` (everything dbt has printed so far) shows it
 * has reached. Never goes backwards past `current`, so a marker that only
 * turns up late cannot rewind the bar.
 */
export function stageFromOutput(output: string, current = 0): number {
  let reached = current;
  for (let i = reached + 1; i < PREVIEW_STAGES.length; i++) {
    const marker = PREVIEW_STAGES[i].marker;
    if (marker && marker.test(output)) {
      reached = i;
    }
  }
  return reached;
}

/**
 * Per-stage durations (ms) from the times each stage began and the time the
 * run ended. A stage dbt skipped past without printing its marker gets 0.
 */
export function stageDurations(startedAt: (number | undefined)[], endedAt: number): number[] {
  return PREVIEW_STAGES.map((_, i) => {
    const start = startedAt[i];
    if (start === undefined) {
      return 0;
    }
    let end = endedAt;
    for (let j = i + 1; j < startedAt.length; j++) {
      if (startedAt[j] !== undefined) {
        end = startedAt[j] as number;
        break;
      }
    }
    return Math.max(0, end - start);
  });
}
