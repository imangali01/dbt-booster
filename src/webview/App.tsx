import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useNodesState,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type OnNodeDrag,
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

interface ContextMenuState {
  nodeId: string;
  label: string;
  x: number;
  y: number;
}

const NODE_ACTIONS: { action: 'run' | 'test' | 'build' | 'preview'; label: string }[] = [
  { action: 'run', label: 'Run' },
  { action: 'test', label: 'Test' },
  { action: 'build', label: 'Build' },
  { action: 'preview', label: 'Preview' },
];

function NodeContextMenu({
  menu,
  onSelect,
  onClose,
}: {
  menu: ContextMenuState;
  onSelect: (action: 'run' | 'test' | 'build' | 'preview') => void;
  onClose: () => void;
}): JSX.Element {
  useEffect(() => {
    const close = (): void => onClose();
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);

  return (
    <div className="ln-ctx-menu" style={{ left: menu.x, top: menu.y }} title={menu.label}>
      {NODE_ACTIONS.map(({ action, label }) => (
        <button
          key={action}
          type="button"
          className="ln-ctx-item"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(action);
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function App(): JSX.Element {
  const [state, setState] = useState<ViewState>({ kind: 'initial' });
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<LineageNodeData>>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  // Positions the user has dragged (or that dagre already settled on) survive later
  // "graph" messages — expand clicks, Refresh, panel visibility — as long as the
  // centre model hasn't changed. A genuine re-centre starts the layout fresh.
  const draggedPositions = useRef(new Map<string, { x: number; y: number }>());
  const lastCentreId = useRef<string | undefined>(undefined);

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

  useEffect(() => {
    if (state.kind !== 'graph') {
      return;
    }
    if (lastCentreId.current !== state.centreId) {
      draggedPositions.current.clear();
      lastCentreId.current = state.centreId;
    }

    const laidOut = layoutLineage(state.graph);
    const liveIds = new Set(laidOut.nodes.map((n) => n.id));
    for (const id of [...draggedPositions.current.keys()]) {
      if (!liveIds.has(id)) {
        draggedPositions.current.delete(id);
      }
    }

    setNodes(
      laidOut.nodes.map((node) => {
        const kept = draggedPositions.current.get(node.id);
        if (kept) {
          return { ...node, position: kept };
        }
        draggedPositions.current.set(node.id, node.position);
        return node;
      }),
    );
    setEdges(laidOut.edges);
  }, [state, setNodes]);

  const onNodeDragStop = useCallback<OnNodeDrag<Node<LineageNodeData>>>((_event, node) => {
    draggedPositions.current.set(node.id, node.position);
  }, []);

  const onNodeClick = useCallback<NodeMouseHandler>((event, node) => {
    if (event.shiftKey) {
      vscode.postMessage({ type: 'recentre', nodeId: node.id });
    } else {
      vscode.postMessage({ type: 'openFile', nodeId: node.id });
    }
  }, []);

  const onNodeContextMenu = useCallback<NodeMouseHandler>((event, node) => {
    const data = node.data as LineageNodeData;
    if (data.resourceType !== 'model') {
      return; // Run/Test/Build/Preview only apply to models.
    }
    event.preventDefault();
    setMenu({ nodeId: node.id, label: data.label, x: event.clientX, y: event.clientY });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const onSelectAction = useCallback(
    (action: 'run' | 'test' | 'build' | 'preview') => {
      if (menu) {
        vscode.postMessage({ type: 'nodeAction', nodeId: menu.nodeId, action });
      }
      setMenu(null);
    },
    [menu],
  );

  if (state.kind !== 'graph') {
    return (
      <div className="ln-empty">
        {state.kind === 'initial' ? 'Loading lineage…' : state.reason}
      </div>
    );
  }

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onNodeDragStop={onNodeDragStop}
        nodesDraggable
        nodesConnectable={false}
        edgesFocusable={false}
        fitView
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {menu ? <NodeContextMenu menu={menu} onSelect={onSelectAction} onClose={closeMenu} /> : null}
    </>
  );
}
