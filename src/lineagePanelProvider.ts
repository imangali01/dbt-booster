import * as vscode from 'vscode';
import type { ManifestStore } from './manifestStore';
import type { ExtensionToWebview, WebviewToExtension } from './protocol';
import { runDbt } from './dbtTerminal';
import { performModelAction } from './modelActions';

const UPSTREAM_DEPTH = 2;
const DOWNSTREAM_DEPTH = 2;

/**
 * The "Lineage" webview view (bottom Panel). Resolves the active editor's model,
 * asks the manifest store for a depth-limited subgraph, and hands it to the React
 * app. Also handles node clicks (open file) and shift-clicks (re-centre).
 */
export class LineagePanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'dbtBooster.lineage';

  private view: vscode.WebviewView | undefined;
  private centreOverride: string | undefined;
  private expandUpstream: string[] = [];
  private expandDownstream: string[] = [];
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: ManifestStore,
    private readonly getActiveRoot: () => string | undefined,
  ) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.resetView();
        this.render();
      }),
      this.store.onDidChange(() => this.render()),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'out')],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage(
      (msg: WebviewToExtension) => this.onMessage(msg),
      undefined,
      this.disposables,
    );
    view.onDidChangeVisibility(
      () => {
        if (view.visible) {
          this.render();
        }
      },
      undefined,
      this.disposables,
    );
    view.onDidDispose(
      () => {
        this.view = undefined;
      },
      undefined,
      this.disposables,
    );
  }

  /** Refresh control: regenerate the manifest, reload it, and redraw. */
  refresh(): void {
    const root = this.getActiveRoot();
    if (root) {
      runDbt(['parse'], root);
    }
    void this.store.load();
    this.render();
  }

  private onMessage(msg: WebviewToExtension): void {
    switch (msg.type) {
      case 'ready':
        this.render();
        break;
      case 'openFile':
        void this.openNodeFile(msg.nodeId);
        break;
      case 'recentre':
        this.resetView();
        this.centreOverride = msg.nodeId;
        this.render();
        break;
      case 'expand':
        this.expand(msg.nodeId, msg.direction);
        this.render();
        break;
      case 'nodeAction':
        this.runNodeAction(msg.nodeId, msg.action);
        break;
    }
  }

  private runNodeAction(nodeId: string, action: 'run' | 'test' | 'build' | 'preview'): void {
    const projectRoot = this.store.activeProjectRoot;
    const modelName = this.store.modelNameForNode(nodeId);
    if (!projectRoot || !modelName) {
      void vscode.window.showErrorMessage('dbt booster: that node is not a runnable model.');
      return;
    }
    performModelAction(action, modelName, projectRoot, this.store);
  }

  private resetView(): void {
    this.centreOverride = undefined;
    this.expandUpstream = [];
    this.expandDownstream = [];
  }

  private expand(nodeId: string, direction: 'upstream' | 'downstream'): void {
    const list = direction === 'upstream' ? this.expandUpstream : this.expandDownstream;
    if (!list.includes(nodeId)) {
      list.push(nodeId);
    }
  }

  private render(): void {
    if (!this.view) {
      return;
    }
    const centreId = this.resolveCentre();
    if (!centreId) {
      this.post({ type: 'empty', reason: this.emptyReason() });
      return;
    }
    const graph = this.store.lineageAround(centreId, UPSTREAM_DEPTH, DOWNSTREAM_DEPTH, {
      expandUpstream: this.expandUpstream,
      expandDownstream: this.expandDownstream,
    });
    if (graph.nodes.length === 0) {
      this.post({
        type: 'empty',
        reason: 'This model is not in the manifest yet — try Refresh to run dbt parse.',
      });
      return;
    }
    this.post({ type: 'graph', graph, centreId });
  }

  private resolveCentre(): string | undefined {
    if (this.centreOverride && this.store.current) {
      return this.centreOverride;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
      return undefined;
    }
    if (!editor.document.fileName.toLowerCase().endsWith('.sql')) {
      return undefined;
    }
    return this.store.resolveModelId(editor.document.uri.fsPath);
  }

  private emptyReason(): string {
    if (!this.store.current) {
      return 'No dbt manifest loaded. Run `dbt parse` in your project (or press Refresh).';
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document.fileName.toLowerCase().endsWith('.sql')) {
      return 'Open a dbt model (.sql) to see its lineage.';
    }
    return 'This file does not match a model in the manifest.';
  }

  private async openNodeFile(nodeId: string): Promise<void> {
    const fsPath = this.store.absolutePathForNode(nodeId);
    if (!fsPath) {
      void vscode.window.showInformationMessage('dbt booster: that node has no source file to open.');
      return;
    }
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath));
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch {
      void vscode.window.showWarningMessage(`dbt booster: could not open ${fsPath}`);
    }
  }

  private post(message: ExtensionToWebview): void {
    void this.view?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webview.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webview.css'),
    );
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link href="${styleUri}" rel="stylesheet" />
<title>Lineage</title>
</head>
<body>
<div id="root" data-view="lineage"></div>
<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
