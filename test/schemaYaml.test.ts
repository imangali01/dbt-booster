import { describe, it, expect } from 'vitest';
import { applyModelDoc, hasModelDoc, readModelDoc, type ModelDoc } from '../src/schemaYaml';

describe('readModelDoc', () => {
  it('returns an empty doc for blank text', () => {
    expect(readModelDoc('', 'orders')).toEqual({ description: '', tags: [], columns: [] });
  });

  it('returns an empty doc when the model is not documented yet', () => {
    const yaml = 'version: 2\nmodels:\n  - name: customers\n    description: people\n';
    expect(readModelDoc(yaml, 'orders')).toEqual({ description: '', tags: [], columns: [] });
  });

  it('reads description and columns', () => {
    const yaml = [
      'version: 2',
      'models:',
      '  - name: orders',
      '    description: One row per order',
      '    columns:',
      '      - name: id',
      '        description: Primary key',
      '        data_tests:',
      '          - not_null',
      '          - unique',
      '',
    ].join('\n');
    expect(readModelDoc(yaml, 'orders')).toEqual({
      description: 'One row per order',
      tags: [],
      columns: [
        {
          name: 'id',
          description: 'Primary key',
          tests: [{ kind: 'not_null' }, { kind: 'unique' }],
        },
      ],
    });
  });

  it('reads tags from config.tags — the key dbt actually applies', () => {
    const yaml = [
      'models:',
      '  - name: orders',
      '    config:',
      '      tags: [finance, core]',
      '',
    ].join('\n');
    expect(readModelDoc(yaml, 'orders').tags).toEqual(['finance', 'core']);
  });

  it('falls back to a legacy top-level tags: for reading', () => {
    const yaml = ['models:', '  - name: orders', '    tags: [finance, core]', ''].join('\n');
    expect(readModelDoc(yaml, 'orders').tags).toEqual(['finance', 'core']);
  });

  it('defaults to no tags when none are set', () => {
    const yaml = ['models:', '  - name: orders', '    description: x', ''].join('\n');
    expect(readModelDoc(yaml, 'orders').tags).toEqual([]);
  });

  it('reads the legacy tests: key too', () => {
    const yaml = [
      'models:',
      '  - name: orders',
      '    columns:',
      '      - name: id',
      '        tests:',
      '          - unique',
      '',
    ].join('\n');
    expect(readModelDoc(yaml, 'orders').columns[0].tests).toEqual([{ kind: 'unique' }]);
  });

  it('reads relationships and accepted_values tests', () => {
    const yaml = [
      'models:',
      '  - name: orders',
      '    columns:',
      '      - name: customer_id',
      '        data_tests:',
      "          - relationships: {to: \"ref('customers')\", field: id}",
      '      - name: status',
      '        data_tests:',
      '          - accepted_values:',
      '              values: [placed, shipped]',
      '',
    ].join('\n');
    const doc = readModelDoc(yaml, 'orders');
    expect(doc.columns[0].tests).toEqual([
      { kind: 'relationships', to: "ref('customers')", field: 'id' },
    ]);
    expect(doc.columns[1].tests).toEqual([
      { kind: 'accepted_values', values: ['placed', 'shipped'] },
    ]);
  });

  it('keeps an unrecognised test as a custom raw fragment', () => {
    const yaml = [
      'models:',
      '  - name: orders',
      '    columns:',
      '      - name: amount',
      '        data_tests:',
      '          - dbt_utils.accepted_range:',
      '              min_value: 0',
      '',
    ].join('\n');
    const test = readModelDoc(yaml, 'orders').columns[0].tests[0];
    expect(test.kind).toBe('custom');
    if (test.kind === 'custom') {
      expect(test.raw).toContain('dbt_utils.accepted_range');
      expect(test.raw).toContain('min_value: 0');
    }
  });
});

describe('hasModelDoc', () => {
  it('is false for blank text and for an undocumented model', () => {
    expect(hasModelDoc('', 'orders')).toBe(false);
    expect(hasModelDoc('models:\n  - name: customers\n', 'orders')).toBe(false);
  });

  it('is true once the model is documented', () => {
    expect(hasModelDoc('models:\n  - name: orders\n', 'orders')).toBe(true);
  });
});

describe('applyModelDoc', () => {
  it('creates a brand new file from blank text', () => {
    const doc: ModelDoc = {
      description: 'One row per order',
      tags: [],
      columns: [{ name: 'id', description: 'PK', tests: [{ kind: 'not_null' }] }],
    };
    const out = applyModelDoc('', 'orders', doc);
    expect(readModelDoc(out, 'orders')).toEqual(doc);
    expect(out).toContain('version: 2');
  });

  it('adds a new model entry to an existing file without disturbing others', () => {
    const original = [
      '# hand-written comment',
      'version: 2',
      'models:',
      '  - name: customers',
      '    description: people who buy things',
      '',
    ].join('\n');
    const out = applyModelDoc(original, 'orders', {
      description: 'One row per order',
      tags: [],
      columns: [],
    });
    expect(out).toContain('# hand-written comment');
    expect(readModelDoc(out, 'customers').description).toBe('people who buy things');
    expect(readModelDoc(out, 'orders').description).toBe('One row per order');
  });

  it('updates an existing model entry in place', () => {
    const original = [
      'models:',
      '  - name: orders',
      '    description: old description',
      '    columns:',
      '      - name: id',
      '        data_tests:',
      '          - unique',
      '  - name: customers',
      '    description: untouched',
      '',
    ].join('\n');
    const out = applyModelDoc(original, 'orders', {
      description: 'new description',
      tags: [],
      columns: [{ name: 'id', description: 'the key', tests: [{ kind: 'not_null' }] }],
    });
    expect(readModelDoc(out, 'orders')).toEqual({
      description: 'new description',
      tags: [],
      columns: [{ name: 'id', description: 'the key', tests: [{ kind: 'not_null' }] }],
    });
    expect(readModelDoc(out, 'customers').description).toBe('untouched');
  });

  it('preserves an existing data_tests vs legacy tests key choice', () => {
    const original = 'models:\n  - name: orders\n    columns:\n      - name: id\n        tests:\n          - unique\n';
    const out = applyModelDoc(original, 'orders', {
      description: '',
      tags: [],
      columns: [{ name: 'id', description: '', tests: [{ kind: 'not_null' }] }],
    });
    expect(out).toContain('tests:');
    expect(out).not.toContain('data_tests:');
  });

  it('defaults new model entries to data_tests', () => {
    const out = applyModelDoc('', 'orders', {
      description: '',
      tags: [],
      columns: [{ name: 'id', description: '', tests: [{ kind: 'unique' }] }],
    });
    expect(out).toContain('data_tests:');
  });

  it('round-trips relationships and accepted_values tests', () => {
    const doc: ModelDoc = {
      description: '',
      tags: [],
      columns: [
        {
          name: 'customer_id',
          description: '',
          tests: [{ kind: 'relationships', to: "ref('customers')", field: 'id' }],
        },
        {
          name: 'status',
          description: '',
          tests: [{ kind: 'accepted_values', values: ['placed', 'shipped'] }],
        },
      ],
    };
    const out = applyModelDoc('', 'orders', doc);
    expect(readModelDoc(out, 'orders')).toEqual(doc);
  });

  it('omits empty description and empty columns rather than writing blanks', () => {
    const out = applyModelDoc('', 'orders', { description: '', tags: [], columns: [] });
    expect(out).not.toContain('description');
    expect(out).not.toContain('columns');
  });

  it('round-trips tags under config.tags and omits config when empty', () => {
    const doc: ModelDoc = { description: '', tags: ['finance', 'core'], columns: [] };
    const out = applyModelDoc('', 'orders', doc);
    expect(readModelDoc(out, 'orders')).toEqual(doc);
    expect(out).toContain('config:');
    expect(out).toContain('tags:');

    const withoutTags = applyModelDoc(out, 'orders', { description: '', tags: [], columns: [] });
    expect(withoutTags).not.toContain('config:');
    expect(withoutTags).not.toContain('tags:');
  });

  it('updates tags on an existing model entry without disturbing others', () => {
    const original = [
      'models:',
      '  - name: orders',
      '    config:',
      '      tags: [finance]',
      '  - name: customers',
      '    config:',
      '      tags: [core]',
      '',
    ].join('\n');
    const out = applyModelDoc(original, 'orders', { description: '', tags: ['finance', 'billing'], columns: [] });
    expect(readModelDoc(out, 'orders').tags).toEqual(['finance', 'billing']);
    expect(readModelDoc(out, 'customers').tags).toEqual(['core']);
  });

  it('preserves other config keys (e.g. materialized) when updating tags', () => {
    const original = [
      'models:',
      '  - name: orders',
      '    config:',
      '      materialized: table',
      '      tags: [finance]',
      '',
    ].join('\n');
    const out = applyModelDoc(original, 'orders', { description: '', tags: ['billing'], columns: [] });
    expect(out).toContain('materialized: table');
    expect(readModelDoc(out, 'orders').tags).toEqual(['billing']);
  });

  it('writes tags in flow style — tags: [a, b] — not one per line', () => {
    const out = applyModelDoc('', 'orders', {
      description: '',
      tags: ['finance', 'daily'],
      columns: [],
    });
    expect(out).toContain('tags: [finance, daily]');
  });

  it('migrates a legacy top-level tags: to config.tags on save', () => {
    const original = 'models:\n  - name: orders\n    tags: [finance]\n';
    const out = applyModelDoc(original, 'orders', { description: '', tags: ['finance'], columns: [] });
    expect(out).toContain('config:');
    expect(readModelDoc(out, 'orders').tags).toEqual(['finance']);
  });
});
