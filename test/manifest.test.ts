import { describe, it, expect } from 'vitest';
import {
  buildLineageSubgraph,
  countModels,
  normaliseManifest,
  resolveNodeIdForFile,
  type DbtManifest,
  type ManifestNode,
} from '../src/manifest';

function model(id: string, deps: string[] = [], extra: Partial<ManifestNode> = {}): ManifestNode {
  return {
    unique_id: `model.p.${id}`,
    name: id,
    resource_type: 'model',
    original_file_path: `models/${id}.sql`,
    config: { materialized: 'view' },
    depends_on: { nodes: deps.map((d) => `model.p.${d}`) },
    ...extra,
  };
}

function manifestOf(...nodes: ManifestNode[]): DbtManifest {
  return {
    nodes: Object.fromEntries(nodes.map((n) => [n.unique_id, n])),
    sources: {},
  };
}

describe('normaliseManifest', () => {
  it('fills missing collections', () => {
    expect(normaliseManifest(undefined)).toEqual({ nodes: {}, sources: {} });
    expect(normaliseManifest({ nodes: { a: model('a') } }).sources).toEqual({});
  });
});

describe('buildLineageSubgraph', () => {
  // a <- b <- c <- d <- e   (e depends on d, ... b depends on a)
  const chain = manifestOf(
    model('a'),
    model('b', ['a']),
    model('c', ['b']),
    model('d', ['c']),
    model('e', ['d']),
  );

  it('limits depth in both directions', () => {
    const g = buildLineageSubgraph(chain, 'model.p.c', 1, 1);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['model.p.b', 'model.p.c', 'model.p.d']);
    expect(g.edges).toEqual([
      { source: 'model.p.b', target: 'model.p.c' },
      { source: 'model.p.c', target: 'model.p.d' },
    ]);
  });

  it('marks the centre and flags hidden neighbours at the frontier', () => {
    const g = buildLineageSubgraph(chain, 'model.p.c', 1, 1);
    const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
    expect(byId['model.p.c'].relation).toBe('centre');
    expect(byId['model.p.b'].hasHiddenUpstream).toBe(true);
    expect(byId['model.p.d'].hasHiddenDownstream).toBe(true);
    expect(byId['model.p.c'].hasHiddenUpstream).toBe(false);
  });

  it('returns an empty graph for an unknown centre', () => {
    expect(buildLineageSubgraph(chain, 'model.p.ghost', 2, 2)).toEqual({ nodes: [], edges: [] });
  });

  it('ignores dependencies that are not in the manifest', () => {
    const m = manifestOf(model('a', ['missing']));
    const g = buildLineageSubgraph(m, 'model.p.a', 2, 2);
    expect(g.nodes.map((n) => n.id)).toEqual(['model.p.a']);
    expect(g.nodes[0].hasHiddenUpstream).toBe(false);
  });

  it('terminates on cycles', () => {
    const cyclic = manifestOf(model('a', ['b']), model('b', ['a']));
    const g = buildLineageSubgraph(cyclic, 'model.p.a', 5, 5);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['model.p.a', 'model.p.b']);
    expect(g.edges).toHaveLength(2);
  });

  it('excludes non-graph resource types such as tests', () => {
    const m = manifestOf(model('a'), {
      unique_id: 'test.p.not_null_a',
      name: 'not_null_a',
      resource_type: 'test',
      depends_on: { nodes: ['model.p.a'] },
    });
    const g = buildLineageSubgraph(m, 'model.p.a', 2, 2);
    expect(g.nodes.map((n) => n.id)).toEqual(['model.p.a']);
  });

  it('includes sources as upstream nodes', () => {
    const m: DbtManifest = {
      nodes: { 'model.p.a': model('a', []) },
      sources: {
        'source.p.raw.orders': {
          unique_id: 'source.p.raw.orders',
          name: 'orders',
          resource_type: 'source',
        },
      },
    };
    m.nodes['model.p.a'].depends_on = { nodes: ['source.p.raw.orders'] };
    const g = buildLineageSubgraph(m, 'model.p.a', 1, 1);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['model.p.a', 'source.p.raw.orders']);
    expect(g.edges).toEqual([{ source: 'source.p.raw.orders', target: 'model.p.a' }]);
  });
});

describe('resolveNodeIdForFile', () => {
  const m = manifestOf(model('customers'), model('orders'));

  it('matches on original_file_path', () => {
    expect(resolveNodeIdForFile(m, 'models/orders.sql')).toBe('model.p.orders');
  });

  it('falls back to the filename stem when the path differs', () => {
    expect(resolveNodeIdForFile(m, 'some/other/orders.sql')).toBe('model.p.orders');
  });

  it('is case-insensitive when asked', () => {
    expect(resolveNodeIdForFile(m, 'MODELS/Orders.SQL', true)).toBe('model.p.orders');
  });

  it('prefers a model over a seed of the same name', () => {
    const mixed = manifestOf(model('orders'), {
      unique_id: 'seed.p.orders',
      name: 'orders',
      resource_type: 'seed',
      original_file_path: 'seeds/orders.csv',
    });
    expect(resolveNodeIdForFile(mixed, 'x/orders.sql')).toBe('model.p.orders');
  });

  it('returns undefined when nothing matches', () => {
    expect(resolveNodeIdForFile(m, 'models/unknown.sql')).toBeUndefined();
  });
});

describe('countModels', () => {
  it('counts only model nodes', () => {
    const m = manifestOf(model('a'), model('b'), {
      unique_id: 'seed.p.s',
      name: 's',
      resource_type: 'seed',
    });
    expect(countModels(m)).toBe(2);
  });
});
