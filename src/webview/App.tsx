import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type NodeMouseHandler,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import type { ExtensionToWebview } from '../protocol';
import type { LineageGraph } from '../manifest';
import { layoutLineage, type LineageNodeData } from './layout';

const vscode = acquireVsCodeApi();

type ViewState =
  | { kind: 'initial' }
  | { kind: 'empty'; reason: string }
  | { kind: 'graph'; graph: LineageGraph; centreId: string };

function LineageNode({ data }: NodeProps): JSX.Element {
  const d = data as LineageNodeData;
  const classes = ['ln-node', `ln-${d.resourceType}`, d.isCentre ? 'ln-centre' : '']
    .filter(Boolean)
    .join(' ');

  const expand = (event: React.MouseEvent, direction: 'upstream' | 'downstream'): void => {
    event.stopPropagation();
    vscode.postMessage({ type: 'expand', nodeId: d.nodeId, direction });
  };

  return (
    <div className={classes} title={d.label}>
      <Handle type="target" position={Position.Left} />
      {d.hasHiddenUpstream ? (
        <button
          type="button"
          className="ln-expand ln-expand-up"
          title="Show one more upstream level"
          onClick={(event) => expand(event, 'upstream')}
        >
          +
        </button>
      ) : null}
      <div className="ln-node-title">{d.label}</div>
      <div className="ln-node-meta">
        <span className="ln-badge ln-badge-type">{d.resourceType}</span>
        {d.materialized ? <span className="ln-badge">{d.materialized}</span> : null}
      </div>
      {d.hasHiddenDownstream ? (
        <button
          type="button"
          className="ln-expand ln-expand-down"
          title="Show one more downstream level"
          onClick={(event) => expand(event, 'downstream')}
        >
          +
        </button>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { lineage: LineageNode };

export function App(): JSX.Element {
  const [state, setState] = useState<ViewState>({ kind: 'initial' });

  useEffect(() => {
    const onMessage = (event: MessageEvent<ExtensionToWebview>): void => {
      const message = event.data;
      if (message.type === 'graph') {
        setState({ kind: 'graph', graph: message.graph, centreId: message.centreId });
      } else if (message.type === 'empty') {
        setState({ kind: 'empty', reason: message.reason });
      }
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const laidOut = useMemo(
    () => (state.kind === 'graph' ? layoutLineage(state.graph) : { nodes: [], edges: [] }),
    [state],
  );

  const onNodeClick = useCallback<NodeMouseHandler>((event, node) => {
    if (event.shiftKey) {
      vscode.postMessage({ type: 'recentre', nodeId: node.id });
    } else {
      vscode.postMessage({ type: 'openFile', nodeId: node.id });
    }
  }, []);

  if (state.kind !== 'graph') {
    return (
      <div className="ln-empty">
        {state.kind === 'initial' ? 'Loading lineage…' : state.reason}
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={laidOut.nodes}
      edges={laidOut.edges}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      fitView
      minZoom={0.2}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={16} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
