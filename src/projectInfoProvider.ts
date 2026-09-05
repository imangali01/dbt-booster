import * as vscode from 'vscode';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import type { ManifestStore } from './manifestStore';
import type { ProjectRegistry } from './projectRegistry';
import { resourceCounts } from './manifest';
import { describeDbtPath } from './pythonEnvironments';
import { InfoItem } from './treeItems';

/**
 * Activity Bar sidebar view: at-a-glance info about the active dbt project —
 * name, root, resource counts, and the configured Python environment — each
 * row a shortcut into the relevant command.
 */
export class ProjectInfoProvider
  implements vscode.TreeDataProvider<InfoItem>, vscode.Disposable
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly registry: ProjectRegistry,
    private readonly store: ManifestStore,
  ) {
    this.disposables.push(
      this.registry.onDidChangeActive(() => this.refresh()),
      this.store.onDidChange(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('dbtBooster.dbtPath')) {
          this.refresh();
        }
      }),
    );
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(item: InfoItem): vscode.TreeItem {
    return item;
  }

  async getChildren(): Promise<InfoItem[]> {
    const root = this.registry.activeRoot;
    if (!root) {
      return [new InfoItem('No dbt project detected', { icon: 'circle-slash' })];
    }

    const items: InfoItem[] = [
      new InfoItem(await this.projectName(root), { icon: 'package', description: 'project' }),
      new InfoItem(path.basename(root), {
        icon: 'folder',
        description: root,
        tooltip: root,
        command: {
          command: 'vscode.open',
          title: 'Open dbt_project.yml',
          arguments: [vscode.Uri.file(path.join(root, 'dbt_project.yml'))],
        },
      }),
    ];

    if (this.registry.allRoots.length > 1) {
      items.push(
        new InfoItem('Switch Project…', {
          icon: 'arrow-swap',
          command: { command: 'dbtBooster.selectProject', title: 'Select dbt Project' },
        }),
      );
    }

    if (!this.store.current) {
      items.push(
        new InfoItem('No manifest — click to run dbt parse', {
          icon: 'warning',
          command: { command: 'dbtBooster.refreshLineage', title: 'Refresh Lineage' },
        }),
      );
    } else {
      const counts = resourceCounts(this.store.current);
      items.push(
        new InfoItem('Models', { icon: 'symbol-method', description: String(counts.model) }),
        new InfoItem('Sources', { icon: 'database', description: String(counts.source) }),
        new InfoItem('Seeds', { icon: 'symbol-array', description: String(counts.seed) }),
        new InfoItem('Snapshots', { icon: 'history', description: String(counts.snapshot) }),
      );
    }

    const dbtPath = vscode.workspace.getConfiguration('dbtBooster').get<string>('dbtPath', 'dbt');
    items.push(
      new InfoItem('Python env', {
        icon: 'server-environment',
        description: describeDbtPath(dbtPath || 'dbt'),
        tooltip: `dbt command: ${dbtPath || 'dbt'} — click to change`,
        command: {
          command: 'dbtBooster.selectPythonEnvironment',
          title: 'Select Python Environment',
        },
      }),
    );

    return items;
  }

  private async projectName(root: string): Promise<string> {
    try {
      const bytes = await vscode.workspace.fs.readFile(
        vscode.Uri.file(path.join(root, 'dbt_project.yml')),
      );
      const parsed = parseYaml(Buffer.from(bytes).toString('utf8')) as { name?: unknown } | null;
      return typeof parsed?.name === 'string' && parsed.name ? parsed.name : path.basename(root);
    } catch {
      return path.basename(root);
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this._onDidChangeTreeData.dispose();
  }
}
