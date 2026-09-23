import { describe, it, expect } from 'vitest';
import {
  INITIAL_RUN_PROGRESS,
  RUNNING_STAGE,
  advanceRunProgress,
  describeRunProgress,
  runPercent,
  stripAnsi,
  textBar,
  type RunProgress,
} from '../src/runProgress';

const fold = (lines: string[], from: RunProgress = INITIAL_RUN_PROGRESS) =>
  lines.reduce(advanceRunProgress, from);

const RUN_LOG = [
  '07:10:01  Running with dbt=1.8.8',
  '07:10:02  Registered adapter: clickhouse=1.8.9',
  '07:10:05  Found 172 models, 871 data tests, 111 sources, 474 macros',
  "07:10:05  Concurrency: 1 threads (target='test')",
  '07:10:08  1 of 3 START sql table model dm_kmg.a ........ [RUN]',
  '07:10:09  1 of 3 OK created sql table model dm_kmg.a ... [OK in 1.10s]',
  '07:10:09  2 of 3 START sql view model dm_kmg.b ......... [RUN]',
  '07:10:10  2 of 3 ERROR creating sql view model dm_kmg.b  [ERROR in 0.40s]',
  '07:10:10  3 of 3 SKIP relation dm_kmg.c ................ [SKIP]',
];

describe('stripAnsi', () => {
  it('removes colour codes and OSC sequences', () => {
    expect(stripAnsi('\u001b[32mOK\u001b[0m done\u001b]633;D;0\u0007')).toBe('OK done');
  });
});

describe('advanceRunProgress', () => {
  it('walks the startup stages', () => {
    expect(fold(RUN_LOG.slice(0, 1)).stage).toBe(1);
    expect(fold(RUN_LOG.slice(0, 2)).stage).toBe(2);
    expect(fold(RUN_LOG.slice(0, 4)).stage).toBe(3);
  });

  it('enters Running on the first START and learns the total', () => {
    const s = fold(RUN_LOG.slice(0, 5));
    expect(s.stage).toBe(RUNNING_STAGE);
    expect(s.total).toBe(3);
    expect(s.done).toBe(0);
  });

  it('counts finished nodes and failures (SKIP is done, not failed)', () => {
    expect(fold(RUN_LOG)).toMatchObject({ done: 3, total: 3, failed: 1 });
  });

  it('counts test PASS / FAIL / WARN results', () => {
    const s = fold([
      '1 of 3 PASS not_null_orders_id .... [PASS in 0.1s]',
      '2 of 3 FAIL 2 unique_orders_id .... [FAIL 2 in 0.1s]',
      '3 of 3 WARN 1 accepted_values_x ... [WARN 1 in 0.1s]',
    ]);
    expect(s).toMatchObject({ done: 3, total: 3, failed: 1 });
  });

  it('does not count the same result line twice', () => {
    const line = '1 of 2 OK created sql table model a [OK in 1s]';
    expect(fold([line, line]).done).toBe(1);
  });

  it('ignores unrelated lines and returns the same state object', () => {
    const s = fold(RUN_LOG.slice(0, 2));
    expect(advanceRunProgress(s, 'some other output')).toBe(s);
  });

  it('never moves the stage backwards', () => {
    const s = fold(RUN_LOG.slice(0, 5));
    expect(advanceRunProgress(s, 'Running with dbt=1.8.8').stage).toBe(RUNNING_STAGE);
  });
});

describe('runPercent', () => {
  it('spreads the startup stages over the first 20%', () => {
    expect(runPercent(INITIAL_RUN_PROGRESS)).toBe(0);
    expect(runPercent(fold(RUN_LOG.slice(0, 4)))).toBe(15);
  });

  it('tracks finished nodes over the remaining 80%', () => {
    expect(runPercent(fold(RUN_LOG.slice(0, 5)))).toBe(20);
    expect(runPercent(fold(RUN_LOG.slice(0, 6)))).toBeCloseTo(20 + 80 / 3);
    expect(runPercent(fold(RUN_LOG))).toBe(100);
  });
});

describe('describeRunProgress', () => {
  it('names the startup stage with its seconds', () => {
    expect(describeRunProgress(fold(RUN_LOG.slice(0, 2)), 2100, 6300)).toBe(
      '3/5 Loading project… 2.1 s · total 6.3 s',
    );
  });

  it('counts nodes while running, with failures', () => {
    expect(describeRunProgress(fold(RUN_LOG), 0, 41200)).toBe(
      '5/5 Running 3/3 · 1 failed · total 41.2 s',
    );
  });
});

describe('textBar', () => {
  it('fills blocks in proportion and shows the percent', () => {
    expect(textBar(0)).toBe('░░░░░░░░░░░░░░░░ 0%');
    expect(textBar(50)).toBe('████████░░░░░░░░ 50%');
    expect(textBar(100)).toBe('████████████████ 100%');
  });

  it('rounds the blocks, floors the percent, and clamps', () => {
    expect(textBar(37.9, 10)).toBe('████░░░░░░ 37%');
    expect(textBar(-5, 4)).toBe('░░░░ 0%');
    expect(textBar(140, 4)).toBe('████ 100%');
  });
});
