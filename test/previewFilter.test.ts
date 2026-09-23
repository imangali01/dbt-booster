import { describe, it, expect } from 'vitest';
import {
  allRowsLoaded,
  distinctValues,
  nextPreviewLimit,
  passesValueFilters,
} from '../src/previewFilter';

describe('passesValueFilters', () => {
  const row = ['Транспортировка нефти', '42.5', null];

  it('passes with no filters', () => {
    expect(passesValueFilters(row, [])).toBe(true);
    expect(passesValueFilters(row, [[], undefined, []])).toBe(true);
  });

  it('drops a row whose value is excluded in its column', () => {
    expect(passesValueFilters(row, [['Транспортировка нефти']])).toBe(false);
    expect(passesValueFilters(row, [['Добыча нефти']])).toBe(true);
  });

  it('matches exactly, not by substring or case', () => {
    expect(passesValueFilters(row, [['нефти']])).toBe(true);
    expect(passesValueFilters(row, [['транспортировка нефти']])).toBe(true);
  });

  it('can exclude NULL', () => {
    expect(passesValueFilters(row, [[], [], [null]])).toBe(false);
    expect(passesValueFilters(row, [[], [], ['']])).toBe(true);
  });

  it('requires the row to survive every column', () => {
    expect(passesValueFilters(row, [['Добыча'], ['42.5']])).toBe(false);
  });

  it('still works once serialised into the webview script', () => {
    const embedded = new Function(`return (${passesValueFilters.toString()});`)() as typeof passesValueFilters;
    expect(embedded(row, [[], ['42.5']])).toBe(false);
    expect(embedded(row, [[], ['1']])).toBe(true);
  });
});

describe('distinctValues', () => {
  it('counts each distinct value, alphabetically, NULL last', () => {
    const rows = [['b'], [null], ['a'], ['b']];
    expect(distinctValues(rows, 0)).toEqual([
      { value: 'a', count: 1 },
      { value: 'b', count: 2 },
      { value: null, count: 1 },
    ]);
  });

  it('orders numerically when every non-NULL value is a number', () => {
    const rows = [['10'], ['9'], [null], ['-1.5']];
    expect(distinctValues(rows, 0).map((v) => v.value)).toEqual(['-1.5', '9', '10', null]);
  });

  it('falls back to alphabetical when any value is not a number', () => {
    const rows = [['10'], ['9'], ['x']];
    expect(distinctValues(rows, 0).map((v) => v.value)).toEqual(['10', '9', 'x']);
  });

  it('treats an empty string as a value, not a number', () => {
    const rows = [['1'], ['']];
    expect(distinctValues(rows, 0).map((v) => v.value)).toEqual(['', '1']);
  });

  it('reads the requested column', () => {
    const rows = [['a', 'x'], ['b', 'x']];
    expect(distinctValues(rows, 1)).toEqual([{ value: 'x', count: 2 }]);
  });

  it('still works once serialised into the webview script', () => {
    const embedded = new Function(`return (${distinctValues.toString()});`)() as typeof distinctValues;
    expect(embedded([['b'], ['a'], ['b']], 0)).toEqual([
      { value: 'a', count: 1 },
      { value: 'b', count: 2 },
    ]);
  });
});

describe('nextPreviewLimit', () => {
  it('adds the requested number of rows', () => {
    expect(nextPreviewLimit(20, 50, 20)).toBe(70);
  });

  it('accepts a numeric string', () => {
    expect(nextPreviewLimit(20, '5', 20)).toBe(25);
  });

  it('falls back for zero, negative, fractional or junk input', () => {
    expect(nextPreviewLimit(20, 0, 20)).toBe(40);
    expect(nextPreviewLimit(20, -3, 20)).toBe(40);
    expect(nextPreviewLimit(20, 2.5, 20)).toBe(40);
    expect(nextPreviewLimit(20, 'abc', 20)).toBe(40);
    expect(nextPreviewLimit(20, undefined, 20)).toBe(40);
  });
});

describe('allRowsLoaded', () => {
  it('is true when dbt returned fewer rows than the limit', () => {
    expect(allRowsLoaded(7, 20)).toBe(true);
  });

  it('is false when the limit was reached — there may be more', () => {
    expect(allRowsLoaded(20, 20)).toBe(false);
  });
});
