import { describe, it, expect } from 'vitest';
import {
  buildLineageSubgraph,
  countModels,
  directChildren,
  directParents,
  docsTargetForModel,
  normaliseManifest,
  resolveNodeIdForFile,
  resourceCounts,
  testsForModel,
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

  it('carries dbt_project.yml\'s +docs.node_color through, when set', () => {
    const withColor = manifestOf(
      model('a', [], { config: { materialized: 'view', docs: { node_color: '#eda405' } } }),
      model('b', ['a']),
    );
    const g = buildLineageSubgraph(withColor, 'model.p.a', 1, 1);
    expect(g.nodes.find((n) => n.id === 'model.p.a')?.nodeColor).toBe('#eda405');
    expect(g.nodes.find((n) => n.id === 'model.p.b')?.nodeColor).toBeUndefined();
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

  it('expands one extra upstream level from a frontier node', () => {
    // base depth 1/1 around c -> {b, c, d}; b still has hidden upstream (a)
    const base = buildLineageSubgraph(chain, 'model.p.c', 1, 1);
    expect(base.nodes.find((n) => n.id === 'model.p.b')?.hasHiddenUpstream).toBe(true);

    const expanded = buildLineageSubgraph(chain, 'model.p.c', 1, 1, {
      expandUpstream: ['model.p.b'],
    });
    expect(expanded.nodes.map((n) => n.id).sort()).toEqual([
      'model.p.a',
      'model.p.b',
      'model.p.c',
      'model.p.d',
    ]);
    expect(expanded.nodes.find((n) => n.id === 'model.p.a')?.relation).toBe('upstream');
    expect(expanded.nodes.find((n) => n.id === 'model.p.b')?.hasHiddenUpstream).toBe(false);
    // the centre did not move
    expect(expanded.nodes.find((n) => n.id === 'model.p.c')?.relation).toBe('centre');
  });

  it('applies chained expansions in order', () => {
    const five = manifestOf(
      model('a'),
      model('b', ['a']),
      model('c', ['b']),
      model('d', ['c']),
      model('e', ['d']),
    );
    // centre e, base 1/1 -> {d, e}; expand d then c
    const g = buildLineageSubgraph(five, 'model.p.e', 1, 1, {
      expandUpstream: ['model.p.d', 'model.p.c'],
    });
    expect(g.nodes.map((n) => n.id).sort()).toEqual([
      'model.p.b',
      'model.p.c',
      'model.p.d',
      'model.p.e',
    ]);
  });

  it('ignores expansion of a node that is not visible', () => {
    const g = buildLineageSubgraph(chain, 'model.p.c', 1, 1, {
      expandUpstream: ['model.p.e'],
    });
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['model.p.b', 'model.p.c', 'model.p.d']);
  });

  it('expands one extra downstream level from a frontier node', () => {
    const g = buildLineageSubgraph(chain, 'model.p.c', 1, 1, {
      expandDownstream: ['model.p.d'],
    });
    expect(g.nodes.map((n) => n.id)).toContain('model.p.e');
    expect(g.nodes.find((n) => n.id === 'model.p.e')?.relation).toBe('downstream');
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

describe('docsTargetForModel', () => {
  it('uses patch_path when the model already has a doc entry, wherever it lives', () => {
    const m = manifestOf(
      model('orders', [], { patch_path: 'jaffle_sample://models/docs/orders.yml' }),
    );
    expect(docsTargetForModel(m, 'model.p.orders')).toEqual({
      yamlRelPath: 'models/docs/orders.yml',
      modelName: 'orders',
    });
  });

  it('defaults to schema.yml next to the model when undocumented', () => {
    const m = manifestOf(model('orders'));
    expect(docsTargetForModel(m, 'model.p.orders')).toEqual({
      yamlRelPath: 'models/schema.yml',
      modelName: 'orders',
    });
  });

  it('returns undefined for a non-model node', () => {
    const m = manifestOf({
      unique_id: 'seed.p.s',
      name: 's',
      resource_type: 'seed',
      original_file_path: 'seeds/s.csv',
    });
    expect(docsTargetForModel(m, 'seed.p.s')).toBeUndefined();
  });

  it('returns undefined for an unknown id', () => {
    expect(docsTargetForModel(manifestOf(model('orders')), 'model.p.ghost')).toBeUndefined();
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

describe('resourceCounts', () => {
  it('counts each resource type across nodes and sources', () => {
    const m: DbtManifest = {
      nodes: {
        'model.p.a': model('a'),
        'model.p.b': model('b'),
        'seed.p.s': { unique_id: 'seed.p.s', name: 's', resource_type: 'seed' },
        'snapshot.p.sn': { unique_id: 'snapshot.p.sn', name: 'sn', resource_type: 'snapshot' },
        'test.p.t': { unique_id: 'test.p.t', name: 't', resource_type: 'test' },
      },
      sources: {
        'source.p.raw.orders': {
          unique_id: 'source.p.raw.orders',
          name: 'orders',
          resource_type: 'source',
        },
      },
    };
    expect(resourceCounts(m)).toEqual({ model: 2, source: 1, seed: 1, snapshot: 1 });
  });

  it('handles a manifest with no sources/nodes at all', () => {
    expect(resourceCounts({})).toEqual({ model: 0, source: 0, seed: 0, snapshot: 0 });
  });
});

describe('testsForModel', () => {
  it('finds test nodes that depend on the model, sorted by name', () => {
    const m = manifestOf(model('orders'), {
      unique_id: 'test.p.unique_orders_id',
      name: 'unique_orders_id',
      resource_type: 'test',
      depends_on: { nodes: ['model.p.orders'] },
    }, {
      unique_id: 'test.p.not_null_orders_id',
      name: 'not_null_orders_id',
      resource_type: 'test',
      depends_on: { nodes: ['model.p.orders'] },
    });
    expect(testsForModel(m, 'model.p.orders').map((t) => t.name)).toEqual([
      'not_null_orders_id',
      'unique_orders_id',
    ]);
  });

  it('excludes tests on other models', () => {
    const m = manifestOf(model('orders'), model('customers'), {
      unique_id: 'test.p.unique_customers_id',
      name: 'unique_customers_id',
      resource_type: 'test',
      depends_on: { nodes: ['model.p.customers'] },
    });
    expect(testsForModel(m, 'model.p.orders')).toEqual([]);
  });
});

describe('directParents / directChildren', () => {
  // customers <- orders <- order_items
  const m = manifestOf(
    model('customers'),
    model('orders', ['customers']),
    model('order_items', ['orders']),
  );

  it('directParents returns only the immediate upstream nodes', () => {
    expect(directParents(m, 'model.p.orders').map((n) => n.name)).toEqual(['customers']);
    expect(directParents(m, 'model.p.customers')).toEqual([]);
  });

  it('directChildren returns only the immediate downstream nodes', () => {
    expect(directChildren(m, 'model.p.orders').map((n) => n.name)).toEqual(['order_items']);
    expect(directChildren(m, 'model.p.order_items')).toEqual([]);
  });

  it('excludes non-graph dependents/dependencies such as tests', () => {
    const withTest = manifestOf(model('orders'), {
      unique_id: 'test.p.unique_orders_id',
      name: 'unique_orders_id',
      resource_type: 'test',
      depends_on: { nodes: ['model.p.orders'] },
    });
    expect(directChildren(withTest, 'model.p.orders')).toEqual([]);
  });
});
