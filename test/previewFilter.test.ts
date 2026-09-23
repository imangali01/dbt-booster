import { describe, it, expect } from 'vitest';
import { allRowsLoaded, matchesFilters, nextPreviewLimit } from '../src/previewFilter';

describe('matchesFilters', () => {
  const row = ['Транспортировка нефти', '42.5', null];

  it('passes with no filters', () => {
    expect(matchesFilters(row, [])).toBe(true);
  });

  it('ignores blank and whitespace-only filters', () => {
    expect(matchesFilters(row, ['', '  ', ''])).toBe(true);
  });

  it('matches a substring, case-insensitively, including Cyrillic', () => {
    expect(matchesFilters(row, ['НЕФТИ'])).toBe(true);
    expect(matchesFilters(row, ['добыча'])).toBe(false);
  });

  it('trims the filter text', () => {
    expect(matchesFilters(row, ['  нефти '])).toBe(true);
  });

  it('requires every non-blank filter to match', () => {
    expect(matchesFilters(row, ['нефти', '42'])).toBe(true);
    expect(matchesFilters(row, ['нефти', '99'])).toBe(false);
  });

  it('reads a NULL cell as "null"', () => {
    expect(matchesFilters(row, ['', '', 'nul'])).toBe(true);
    expect(matchesFilters(row, ['', '', 'x'])).toBe(false);
  });

  it('still works once serialised into the webview script', () => {
    const embedded = new Function(`return (${matchesFilters.toString()});`)() as typeof matchesFilters;
    expect(embedded(row, ['нефти', '42'])).toBe(true);
    expect(embedded(row, ['', '', 'x'])).toBe(false);
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
