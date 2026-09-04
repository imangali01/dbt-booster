import { describe, it, expect } from 'vitest';
import { parseDbtShowOutput } from '../src/dbtShowParser';

describe('parseDbtShowOutput', () => {
  it('parses an array-of-rows shape wrapped in "show"', () => {
    const raw = JSON.stringify({ show: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] });
    expect(parseDbtShowOutput(raw)).toEqual({
      ok: true,
      columns: ['id', 'name'],
      rows: [
        [1, 'a'],
        [2, 'b'],
      ],
    });
  });

  it('parses a bare array-of-rows shape', () => {
    const raw = JSON.stringify([{ a: 1 }, { a: 2 }]);
    expect(parseDbtShowOutput(raw)).toEqual({ ok: true, columns: ['a'], rows: [[1], [2]] });
  });

  it('parses a column_names/rows shape', () => {
    const raw = JSON.stringify({ column_names: ['id', 'name'], rows: [[1, 'a']] });
    expect(parseDbtShowOutput(raw)).toEqual({
      ok: true,
      columns: ['id', 'name'],
      rows: [[1, 'a']],
    });
  });

  it('parses a nested show.column_names/rows shape', () => {
    const raw = JSON.stringify({ show: { column_names: ['x'], rows: [[1], [2]] } });
    expect(parseDbtShowOutput(raw)).toEqual({ ok: true, columns: ['x'], rows: [[1], [2]] });
  });

  it('tolerates plain-text log lines surrounding the JSON', () => {
    const raw = [
      '13:45:01  Running with dbt=1.7.0',
      '13:45:02  Found 12 models, 3 sources',
      JSON.stringify({ show: [{ id: 1 }] }),
      '13:45:03  Done.',
    ].join('\n');
    expect(parseDbtShowOutput(raw)).toEqual({ ok: true, columns: ['id'], rows: [[1]] });
  });

  it('tolerates structured JSON log lines that are not the result', () => {
    const raw = [
      JSON.stringify({ info: { msg: 'Running with dbt=1.7.0' } }),
      JSON.stringify({ info: { msg: 'Found 12 models' } }),
      JSON.stringify({ show: [{ id: 1, total: 42 }] }),
    ].join('\n');
    expect(parseDbtShowOutput(raw)).toEqual({
      ok: true,
      columns: ['id', 'total'],
      rows: [[1, 42]],
    });
  });

  it('reports an empty result', () => {
    const raw = JSON.stringify({ show: [] });
    expect(parseDbtShowOutput(raw)).toEqual({ ok: true, columns: [], rows: [] });
  });

  it('reports a readable error for a non-model / failed run with no JSON output', () => {
    const raw = [
      '13:45:01  Running with dbt=1.7.0',
      'Compilation Error in model orders (models/orders.sql)',
      "  Node type must be 'model', 'seed' or 'snapshot', got 'source' for source.jaffle.raw_orders",
    ].join('\n');
    const result = parseDbtShowOutput(raw);
    expect(result.ok).toBe(false);
    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.message).toContain('source.jaffle.raw_orders');
  });

  it('reports a fallback message for completely empty output', () => {
    expect(parseDbtShowOutput('')).toEqual({
      ok: false,
      columns: [],
      rows: [],
      message: 'dbt show produced no output.',
    });
  });
});
