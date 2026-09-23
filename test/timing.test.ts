import { describe, it, expect } from 'vitest';
import { explainDbtTimings, formatDuration, formatTimingReport } from '../src/timing';

describe('formatDuration', () => {
  it('shows sub-second times in whole milliseconds', () => {
    expect(formatDuration(0)).toBe('0 ms');
    expect(formatDuration(842)).toBe('842 ms');
    expect(formatDuration(999)).toBe('999 ms');
  });

  it('rounds milliseconds to whole numbers', () => {
    expect(formatDuration(41.6)).toBe('42 ms');
  });

  it('shows seconds with one decimal below a minute', () => {
    expect(formatDuration(1000)).toBe('1.0 s');
    expect(formatDuration(3449)).toBe('3.4 s');
    expect(formatDuration(59_000)).toBe('59.0 s');
  });

  it('shows minutes and seconds from a minute up', () => {
    expect(formatDuration(60_000)).toBe('1 m 0 s');
    expect(formatDuration(83_000)).toBe('1 m 23 s');
    expect(formatDuration(600_000)).toBe('10 m 0 s');
  });

  it('clamps a negative duration to zero', () => {
    expect(formatDuration(-5)).toBe('0 ms');
  });

  it('marks a duration that was never measured', () => {
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatTimingReport', () => {
  it('returns nothing for no rows', () => {
    expect(formatTimingReport([])).toEqual([]);
  });

  it('pads labels to a common width and right-aligns durations', () => {
    expect(
      formatTimingReport([
        { label: 'short', ms: 1200 },
        { label: 'a much longer label', ms: 900 },
      ]),
    ).toEqual([
      'short                 1.2 s',
      'a much longer label  900 ms',
    ]);
  });

  it('appends a note when a row carries one', () => {
    expect(formatTimingReport([{ label: 'parse', ms: 2000, note: 'dbt parse' }])).toEqual([
      'parse  2.0 s  dbt parse',
    ]);
  });
});

describe('explainDbtTimings', () => {
  const timings = { version: 2000, coldParse: 42_000, warmParse: 9000, inlineShow: 21_000 };

  it('reports the phases in cost order of the pipeline', () => {
    expect(explainDbtTimings(timings).map((row) => row.label)).toEqual([
      'Python start + dbt import',
      'Full project parse',
      'Partial (warm) parse',
      'Warehouse connect + query',
      'A warm Preview, end to end',
    ]);
  });

  it('subtracts the interpreter cost out of each parse', () => {
    const rows = explainDbtTimings(timings);
    expect(rows[0].ms).toBe(2000);
    expect(rows[1].ms).toBe(40_000);
    expect(rows[2].ms).toBe(7000);
  });

  it('subtracts a warm parse out of the inline show to isolate the warehouse', () => {
    expect(explainDbtTimings(timings)[3].ms).toBe(12_000);
  });

  it('reports the inline show total unmodified', () => {
    expect(explainDbtTimings(timings)[4].ms).toBe(21_000);
  });

  it('clamps a negative difference to zero when a later run came out faster', () => {
    const noisy = { version: 5000, coldParse: 4000, warmParse: 4000, inlineShow: 3000 };
    expect(explainDbtTimings(noisy).map((row) => row.ms)).toEqual([5000, 0, 0, 0, 3000]);
  });

  it('names the dbt command behind every phase', () => {
    expect(explainDbtTimings(timings).every((row) => Boolean(row.note))).toBe(true);
  });
});
