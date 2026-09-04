import dagre from 'dagre';
import type { Edge, Node } from '@xyflow/react';
import type { LineageGraph } from '../manifest';

export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 52;

export interface LineageNodeData extends Record<string, unknown> {
  nodeId: string;
  label: string;
  resourceType: string;
  materialized?: string;
  isCentre: boolean;
  hasHiddenUpstream: boolean;
  hasHiddenDownstream: boolean;
}

/** Lay the lineage graph out left-to-right with dagre; upstream ends up on the left. */
export function layoutLineage(graph: LineageGraph): {
  nodes: Node<LineageNodeData>[];
  edges: Edge[];
} {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 22, ranksep: 64, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of graph.nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of graph.edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const nodes: Node<LineageNodeData>[] = graph.nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      id: node.id,
      type: 'lineage',
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: {
        nodeId: node.id,
        label: node.name,
        resourceType: node.resourceType,
        materialized: node.materialized,
        isCentre: node.relation === 'centre',
        hasHiddenUpstream: node.hasHiddenUpstream,
        hasHiddenDownstream: node.hasHiddenDownstream,
      },
    };
  });

  const edges: Edge[] = graph.edges.map((edge) => ({
    id: `${edge.source}=>${edge.target}`,
    source: edge.source,
    target: edge.target,
  }));

  return { nodes, edges };
}
