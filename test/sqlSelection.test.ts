import { describe, it, expect } from 'vitest';
import { INLINE_LABEL_MAX, prepareInlineSql } from '../src/sqlSelection';

describe('prepareInlineSql', () => {
  it('trims surrounding whitespace', () => {
    expect(prepareInlineSql('  \n select 1 as x \n  ')).toEqual({
      sql: 'select 1 as x',
      label: 'select 1 as x',
    });
  });

  it('drops a trailing semicolon', () => {
    expect(prepareInlineSql('select 1 as x;')?.sql).toBe('select 1 as x');
  });

  it('drops several trailing semicolons and the whitespace between them', () => {
    expect(prepareInlineSql('select 1 as x ; ;\n')?.sql).toBe('select 1 as x');
  });

  it('leaves semicolons inside the statement alone', () => {
    expect(prepareInlineSql("select ';' as x")?.sql).toBe("select ';' as x");
  });

  it('rejects an empty selection', () => {
    expect(prepareInlineSql('')).toBeUndefined();
  });

  it('rejects a whitespace-only selection', () => {
    expect(prepareInlineSql('  \n\t  ')).toBeUndefined();
  });

  it('rejects a selection that is nothing but semicolons', () => {
    expect(prepareInlineSql(' ; ; ')).toBeUndefined();
  });

  it('keeps the ref() jinja untouched — dbt compiles it', () => {
    const selection = "select distinct company\nfrom {{ ref('dds_kmg__dim_companies') }}";
    expect(prepareInlineSql(selection)?.sql).toBe(selection);
  });

  it('labels the selection with its first meaningful line', () => {
    const selection = 'select distinct\n    company_dim_key,\n    company\nfrom x';
    expect(prepareInlineSql(selection)?.label).toBe('select distinct');
  });

  it('skips leading -- comment lines when labelling', () => {
    const selection = '-- метрика x measure_unit\n-- ещё комментарий\nselect a from t';
    expect(prepareInlineSql(selection)?.label).toBe('select a from t');
  });

  it('falls back to the first line when the selection is all comments', () => {
    expect(prepareInlineSql('-- just a note')?.label).toBe('-- just a note');
  });

  it('collapses runs of whitespace inside the label', () => {
    expect(prepareInlineSql('select    a,\tb from t')?.label).toBe('select a, b from t');
  });

  it('truncates a long label with an ellipsis', () => {
    const line = 'select ' + 'a'.repeat(100);
    const label = prepareInlineSql(line)!.label;
    expect(label.length).toBe(INLINE_LABEL_MAX + 1);
    expect(label.endsWith('…')).toBe(true);
    expect(label.slice(0, INLINE_LABEL_MAX)).toBe(line.slice(0, INLINE_LABEL_MAX));
  });

  it('leaves a label of exactly the maximum length alone', () => {
    const line = 'a'.repeat(INLINE_LABEL_MAX);
    expect(prepareInlineSql(line)?.label).toBe(line);
  });
});
