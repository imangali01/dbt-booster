import { describe, it, expect } from 'vitest';
import { PREVIEW_STAGES, stageDurations, stageFromOutput } from '../src/previewProgress';

const LOG = [
  '06:51:28  Running with dbt=1.8.8',
  '06:51:29  Registered adapter: clickhouse=1.8.9',
  '06:51:32  Found 172 models, 871 data tests, 111 sources, 474 macros',
  '06:51:32  Concurrency: 1 threads (target=\'test\')',
].join('\n');

describe('stageFromOutput', () => {
  it('starts at the first stage before dbt prints anything', () => {
    expect(stageFromOutput('')).toBe(0);
  });

  it('follows the markers as they appear', () => {
    const lines = LOG.split('\n');
    expect(stageFromOutput(lines.slice(0, 1).join('\n'))).toBe(1);
    expect(stageFromOutput(lines.slice(0, 2).join('\n'))).toBe(2);
    expect(stageFromOutput(lines.slice(0, 3).join('\n'))).toBe(3);
  });

  it('jumps straight to the furthest stage whose marker is present', () => {
    expect(stageFromOutput(LOG)).toBe(PREVIEW_STAGES.length - 1);
  });

  it('matches a single-model project', () => {
    expect(stageFromOutput('Found 1 model, 0 tests')).toBe(3);
  });

  it('never moves backwards', () => {
    expect(stageFromOutput('Running with dbt=1.8.8', 3)).toBe(3);
  });

  it('ignores unrelated output', () => {
    expect(stageFromOutput('Encountered an error:\nCompilation Error')).toBe(0);
  });
});

describe('stageDurations', () => {
  it('measures each stage up to the next one that began, the last up to the end', () => {
    expect(stageDurations([0, 3000, 4000, 8000], 11000)).toEqual([3000, 1000, 4000, 3000]);
  });

  it('gives a skipped stage 0 and lets the previous one run to the next that began', () => {
    expect(stageDurations([0, undefined, 4000, 8000], 11000)).toEqual([4000, 0, 4000, 3000]);
  });

  it('stops at the end when the run failed early', () => {
    expect(stageDurations([0, 3000], 5000)).toEqual([3000, 2000, 0, 0]);
  });
});
