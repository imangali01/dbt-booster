import * as vscode from 'vscode';

/** A flat, non-interactive-by-default tree row shared by the Activity Bar views. */
export class InfoItem extends vscode.TreeItem {
  constructor(
    label: string,
    opts: {
      description?: string;
      icon?: string;
      command?: vscode.Command;
      tooltip?: string;
      collapsibleState?: vscode.TreeItemCollapsibleState;
    } = {},
  ) {
    super(label, opts.collapsibleState ?? vscode.TreeItemCollapsibleState.None);
    this.description = opts.description;
    this.tooltip = opts.tooltip ?? [label, opts.description].filter(Boolean).join(': ');
    if (opts.icon) {
      this.iconPath = new vscode.ThemeIcon(opts.icon);
    }
    this.command = opts.command;
  }
}
