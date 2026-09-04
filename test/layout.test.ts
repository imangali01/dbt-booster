import { describe, it, expect } from 'vitest';
import { layoutLineage } from '../src/webview/layout';
import type { LineageGraph } from '../src/manifest';

const graph: LineageGraph = {
  nodes: [
    { id: 'up', name: 'up', resourceType: 'model', relation: 'upstream', depth: -1, hasHiddenUpstream: false, hasHiddenDownstream: false },
    { id: 'mid', name: 'mid', resourceType: 'model', relation: 'centre', depth: 0, hasHiddenUpstream: false, hasHiddenDownstream: false },
    { id: 'down', name: 'down', resourceType: 'model', relation: 'downstream', depth: 1, hasHiddenUpstream: false, hasHiddenDownstream: false },
  ],
  edges: [
    { source: 'up', target: 'mid' },
    { source: 'mid', target: 'down' },
  ],
};

describe('layoutLineage', () => {
  it('places upstream left of the centre and downstream right (LR)', () => {
    const { nodes } = layoutLineage(graph);
    const x = Object.fromEntries(nodes.map((n) => [n.id, n.position.x]));
    expect(x.up).toBeLessThan(x.mid);
    expect(x.mid).toBeLessThan(x.down);
  });

  it('carries the centre flag and materialization into node data', () => {
    const withMat: LineageGraph = {
      nodes: [
        {
          id: 'mid',
          name: 'mid',
          resourceType: 'model',
          materialized: 'table',
          relation: 'centre',
          depth: 0,
          hasHiddenUpstream: false,
          hasHiddenDownstream: false,
        },
      ],
      edges: [],
    };
    const { nodes } = layoutLineage(withMat);
    expect(nodes[0].data.isCentre).toBe(true);
    expect(nodes[0].data.materialized).toBe('table');
  });
});
