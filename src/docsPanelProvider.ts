import * as vscode from 'vscode';
import * as path from 'path';
import type { ManifestStore } from './manifestStore';
import type { DocsExtensionToWebview, DocsWebviewToExtension } from './docsProtocol';
import { applyModelDoc, readModelDoc, type ModelDoc } from './schemaYaml';

/**
 * The "Docs" webview view (bottom Panel, next to Lineage). Lets the user edit
 * the active model's schema.yml doc block — description, column descriptions,
 * column tests — as a form, and write it back to whichever yml file the
 * manifest says documents this model (or a fresh `schema.yml` next to the
 * model if it isn't documented anywhere yet).
 */
export class DocsPanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'dbtBooster.docs';

  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: ManifestStore,
  ) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.render()),
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
      (msg: DocsWebviewToExtension) => void this.onMessage(msg),
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

  private async onMessage(msg: DocsWebviewToExtension): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.render();
        break;
      case 'save':
        await this.save(msg.doc);
        break;
      case 'openYaml':
        await this.openYaml();
        break;
    }
  }

  private render(): void {
    if (!this.view) {
      return;
    }
    const centreId = this.resolveCentreModelId();
    if (!centreId) {
      this.post({ type: 'empty', reason: this.emptyReason() });
      return;
    }
    const target = this.store.docsTarget(centreId);
    if (!target) {
      this.post({ type: 'empty', reason: 'This model is not in the manifest yet.' });
      return;
    }
    void this.readTarget(target.yamlPath).then((yamlText) => {
      this.post({
        type: 'doc',
        modelName: target.modelName,
        yamlPath: this.displayPath(target.yamlPath),
        doc: readModelDoc(yamlText, target.modelName),
      });
    });
  }

  private async openYaml(): Promise<void> {
    const centreId = this.resolveCentreModelId();
    const target = centreId ? this.store.docsTarget(centreId) : undefined;
    if (!target) {
      return;
    }
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(target.yamlPath));
  }

  /** `yamlPath` relative to the project, prefixed with the project folder's own name. */
  private displayPath(yamlPath: string): string {
    const root = this.store.activeProjectRoot;
    if (!root) {
      return yamlPath;
    }
    const rel = path.relative(root, yamlPath).split(path.sep).join('/');
    return `${path.basename(root)}/${rel}`;
  }

  private async save(doc: ModelDoc): Promise<void> {
    const centreId = this.resolveCentreModelId();
    const target = centreId ? this.store.docsTarget(centreId) : undefined;
    if (!target) {
      this.post({ type: 'saveError', message: 'No active model to save.' });
      return;
    }
    try {
      const existing = await this.readTarget(target.yamlPath);
      const next = applyModelDoc(existing, target.modelName, doc);
      await vscode.workspace.fs.writeFile(vscode.Uri.file(target.yamlPath), Buffer.from(next, 'utf8'));
      this.post({ type: 'saved' });
    } catch (err) {
      this.post({ type: 'saveError', message: (err as Error).message });
    }
  }

  private async readTarget(yamlPath: string): Promise<string> {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(yamlPath));
      return Buffer.from(bytes).toString('utf8');
    } catch {
      return '';
    }
  }

  private resolveCentreModelId(): string | undefined {
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
      return 'No dbt manifest loaded. Run `dbt parse` in your project.';
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document.fileName.toLowerCase().endsWith('.sql')) {
      return 'Open a dbt model (.sql) to edit its documentation.';
    }
    return 'This file does not match a model in the manifest.';
  }

  private post(message: DocsExtensionToWebview): void {
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
<title>Docs</title>
</head>
<body>
<div id="root" data-view="docs"></div>
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
