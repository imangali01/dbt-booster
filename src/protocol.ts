/** Message contract between the extension host and the Lineage webview. Types only. */

import type { LineageGraph } from './manifest';

export type ExtensionToWebview =
  | { type: 'graph'; graph: LineageGraph; centreId: string }
  | { type: 'empty'; reason: string };

export type NodeDbtAction = 'run' | 'test' | 'build' | 'preview';

export type WebviewToExtension =
  | { type: 'ready' }
  | { type: 'openFile'; nodeId: string }
  | { type: 'recentre'; nodeId: string }
  | { type: 'expand'; nodeId: string; direction: 'upstream' | 'downstream' }
  | { type: 'nodeAction'; nodeId: string; action: NodeDbtAction };
