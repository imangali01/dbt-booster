/** Message contract between the extension host and the Docs webview. Types only. */

import type { ModelDoc } from './schemaYaml';

export type DocsExtensionToWebview =
  /** `yamlPath` is a display path — project-folder-relative, not absolute. */
  | { type: 'doc'; modelName: string; yamlPath: string; doc: ModelDoc }
  | { type: 'empty'; reason: string }
  | { type: 'saved' }
  | { type: 'saveError'; message: string };

export type DocsWebviewToExtension =
  | { type: 'ready' }
  | { type: 'save'; doc: ModelDoc }
  /** Open the current model's yml doc file in the editor. */
  | { type: 'openYaml' };
