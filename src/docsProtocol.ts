/** Message contract between the extension host and the Docs webview. Types only. */

import type { ModelDoc } from './schemaYaml';

export type DocsExtensionToWebview =
  | { type: 'doc'; modelName: string; yamlPath: string; doc: ModelDoc }
  | { type: 'empty'; reason: string }
  | { type: 'saved' }
  | { type: 'saveError'; message: string };

export type DocsWebviewToExtension =
  | { type: 'ready' }
  | { type: 'save'; doc: ModelDoc };
