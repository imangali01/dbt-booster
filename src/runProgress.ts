/**
 * PURE: progress of a Run / Test / Build / parse in the `dbt-booster`
 * terminal, read line by line off dbt's own output (ticket 26).
 *
 * The startup stages are the same as Preview's (see previewProgress.ts), plus
 * dbt's per-node lines once it starts executing:
 *
 *   "1 of 12 START sql table model dm.x ........ [RUN]"
 *   "1 of 12 OK created sql table model dm.x ... [OK in 2.10s]"
 *   "3 of 12 FAIL 2 not_null_x_id .............. [FAIL 2 in 0.20s]"
 */

export const RUN_STAGES: readonly { label: string; marker?: RegExp }[] = [
  { label: 'Starting dbt (Python + imports)' },
  { label: 'Loading profile and adapter', marker: /Running with dbt=/ },
  { label: 'Loading project', marker: /Registered adapter:/ },
  { label: 'Preparing (connecting, caching relations)', marker: /Found \d+ models?/ },
  { label: 'Running', marker: /\b\d+ of \d+ START\b/ },
];

/** The stage index where dbt executes nodes. */
export const RUNNING_STAGE = RUN_STAGES.length - 1;

export interface RunProgress {
  /** Furthest stage reached (index into {@link RUN_STAGES}). */
  stage: number;
  /** Nodes dbt reported a result for. */
  done: number;
  /** Nodes dbt said it will run (the N in "k of N"); 0 until it says. */
  total: number;
  /** Nodes that ended in ERROR or FAIL. */
  failed: number;
  /** Result numbers already counted, so a repeated line is not counted twice. */
  seen: number[];
}

export const INITIAL_RUN_PROGRESS: RunProgress = { stage: 0, done: 0, total: 0, failed: 0, seen: [] };

// CSI sequences (colours, cursor moves) and OSC sequences (shell-integration marks, titles).
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

/** Drop terminal colour codes and OSC sequences from terminal output. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

const NODE_LINE = /\b(\d+) of (\d+) (START|OK|PASS|WARN|FAIL|ERROR|SKIP)\b/;

/** Fold one line of (colour-stripped) dbt output into `state`. */
export function advanceRunProgress(state: RunProgress, line: string): RunProgress {
  let { stage, done, total, failed, seen } = state;
  for (let i = stage + 1; i < RUN_STAGES.length; i++) {
    const marker = RUN_STAGES[i].marker;
    if (marker && marker.test(line)) {
      stage = i;
    }
  }
  const node = NODE_LINE.exec(line);
  if (node) {
    const index = Number(node[1]);
    total = Math.max(total, Number(node[2]));
    const status = node[3];
    if (status !== 'START' && !seen.includes(index)) {
      seen = [...seen, index];
      done += 1;
      if (status === 'FAIL' || status === 'ERROR') {
        failed += 1;
      }
    }
  }
  if (stage === state.stage && done === state.done && total === state.total) {
    return state;
  }
  return { stage, done, total, failed, seen };
}

/**
 * How full the bar is, 0–100. Startup stages share the first 20% (dbt's
 * startup is roughly constant); the rest tracks finished nodes out of total.
 */
export function runPercent(state: RunProgress): number {
  const STARTUP = 20;
  if (state.stage < RUNNING_STAGE || state.total === 0) {
    return (state.stage / RUNNING_STAGE) * STARTUP;
  }
  return STARTUP + ((100 - STARTUP) * Math.min(state.done, state.total)) / state.total;
}

/**
 * A text progress bar, e.g. "██████░░░░░░░░░░ 38%". VS Code's own notification
 * bar is a thin line an extension cannot restyle, so the message carries a
 * visible one too.
 */
export function textBar(percent: number, width = 16): string {
  const pct = Math.max(0, Math.min(100, percent));
  const filled = Math.round((pct / 100) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${Math.floor(pct)}%`;
}

/** One line for the progress notification, e.g. "5/5 Running 3/12 · 1 failed · total 4.2 s". */
export function describeRunProgress(state: RunProgress, stageMs: number, totalMs: number): string {
  const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const step = `${state.stage + 1}/${RUN_STAGES.length}`;
  if (state.stage === RUNNING_STAGE && state.total > 0) {
    const failed = state.failed > 0 ? ` · ${state.failed} failed` : '';
    return `${step} Running ${state.done}/${state.total}${failed} · total ${secs(totalMs)}`;
  }
  return `${step} ${RUN_STAGES[state.stage].label}… ${secs(stageMs)} · total ${secs(totalMs)}`;
}
