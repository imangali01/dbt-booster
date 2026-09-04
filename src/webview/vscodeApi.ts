// Exactly one module-level call, shared by every webview entry point (App,
// DocsApp, ...) bundled into this page. VS Code throws if acquireVsCodeApi()
// is called more than once per webview.
const vscode = acquireVsCodeApi();

export default vscode;
