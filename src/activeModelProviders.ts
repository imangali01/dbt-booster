import * as vscode from 'vscode';
import type { ManifestStore } from './manifestStore';
import { directChildren, directParents, testsForModel, type ManifestNode } from './manifest';
import { readModelDoc } from './schemaYaml';
import { InfoItem } from './treeItems';

function iconForResourceType(type: string): string {
  switch (type) {
    case 'model':
      return 'symbol-method';
    case 'source':
      return 'database';
    case 'seed':
      return 'symbol-array';
    case 'snapshot':
      return 'history';
    default:
      return 'circle-outline';
  }
}

/**
 * Shared base for the Activity Bar's per-model sections (Model Tests, Parent
 * Models, Children Models, Documentation): all of them react to the active
 * editor and the manifest reloading the same way, and only differ in what
 * they list for the resolved model.
 */
abstract class ActiveModelTreeProvider
  implements vscode.TreeDataProvider<InfoItem>, vscode.Disposable
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(protected readonly store: ManifestStore) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
      this.store.onDidChange(() => this.refresh()),
    );
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(item: InfoItem): vscode.TreeItem {
    return item;
  }

  abstract getChildren(element?: InfoItem): vscode.ProviderResult<InfoItem[]>;

  protected activeModelId(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
      return undefined;
    }
    if (!editor.document.fileName.toLowerCase().endsWith('.sql')) {
      return undefined;
    }
    return this.store.resolveModelId(editor.document.uri.fsPath);
  }

  protected nodeItem(node: ManifestNode): InfoItem {
    const abs = this.store.absolutePathForNode(node.unique_id);
    return new InfoItem(node.name, {
      icon: iconForResourceType(node.resource_type),
      description: node.resource_type,
      command: abs
        ? { command: 'vscode.open', title: 'Open File', arguments: [vscode.Uri.file(abs)] }
        : undefined,
    });
  }

  protected emptyState(message: string): InfoItem[] {
    return [new InfoItem(message, { icon: 'info' })];
  }

  protected noManifestOrModel(): InfoItem[] | undefined {
    if (!this.store.current) {
      return this.emptyState('No dbt manifest loaded. Run `dbt parse` in your project.');
    }
    if (!this.activeModelId()) {
      return this.emptyState('Open a dbt model (.sql) to see this.');
    }
    return undefined;
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this._onDidChangeTreeData.dispose();
  }
}

export class ModelTestsProvider extends ActiveModelTreeProvider {
  getChildren(): InfoItem[] {
    const blocked = this.noManifestOrModel();
    if (blocked) {
      return blocked;
    }
    const id = this.activeModelId()!;
    const tests = testsForModel(this.store.current!, id);
    if (tests.length === 0) {
      return this.emptyState('No tests on this model.');
    }
    const root = this.store.activeProjectRoot;
    return tests.map(
      (t) =>
        new InfoItem(t.name, {
          icon: 'beaker',
          command: root
            ? {
                command: 'dbtBooster.runTestNode',
                title: 'Run Test',
                arguments: [t.name, root],
              }
            : undefined,
        }),
    );
  }
}

export class ParentModelsProvider extends ActiveModelTreeProvider {
  getChildren(): InfoItem[] {
    const blocked = this.noManifestOrModel();
    if (blocked) {
      return blocked;
    }
    const id = this.activeModelId()!;
    const parents = directParents(this.store.current!, id);
    return parents.length > 0
      ? parents.map((n) => this.nodeItem(n))
      : this.emptyState('No parent models.');
  }
}

export class ChildrenModelsProvider extends ActiveModelTreeProvider {
  getChildren(): InfoItem[] {
    const blocked = this.noManifestOrModel();
    if (blocked) {
      return blocked;
    }
    const id = this.activeModelId()!;
    const children = directChildren(this.store.current!, id);
    return children.length > 0
      ? children.map((n) => this.nodeItem(n))
      : this.emptyState('No child models.');
  }
}

/** A model row that carries its already-resolved column rows as children. */
class DocItem extends InfoItem {
  children: InfoItem[] = [];
}

export class DocumentationProvider extends ActiveModelTreeProvider {
  getTreeItem(item: InfoItem): vscode.TreeItem {
    if (item instanceof DocItem) {
      item.collapsibleState =
        item.children.length > 0
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.None;
    }
    return item;
  }

  async getChildren(element?: InfoItem): Promise<InfoItem[]> {
    if (element instanceof DocItem) {
      return element.children;
    }
    if (element) {
      return [];
    }
    const blocked = this.noManifestOrModel();
    if (blocked) {
      return blocked;
    }
    const id = this.activeModelId()!;
    const manifest = this.store.current!;
    const node = manifest.nodes[id];
    if (!node) {
      return this.emptyState('This model is not in the manifest yet.');
    }

    const target = this.store.docsTarget(id);
    let columns: InfoItem[] = [];
    if (target) {
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(target.yamlPath));
        const doc = readModelDoc(Buffer.from(bytes).toString('utf8'), target.modelName);
        columns = doc.columns.map(
          (c) =>
            new InfoItem(c.name, {
              icon: 'symbol-field',
              tooltip: c.description || c.name,
            }),
        );
      } catch {
        // no schema.yml yet — fall through with no columns
      }
    }

    const materialized = node.config?.materialized ?? node.resource_type;
    const root = new DocItem(node.name, {
      icon: 'book',
      description: node.schema ? `[${materialized}] - schema: ${node.schema}` : `[${materialized}]`,
      command: { command: 'dbtBooster.docs.focus', title: 'Open Docs' },
    });
    root.children =
      columns.length > 0 ? columns : [new InfoItem('No documented columns', { icon: 'circle-slash' })];
    return [root];
  }
}
