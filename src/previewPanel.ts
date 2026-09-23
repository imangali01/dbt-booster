import * as vscode from 'vscode';
import { runDbtShow, runDbtShowInline } from './dbtShow';
import { numericColumns, parseDbtShowOutput, type DbtShowResult } from './dbtShowParser';

let panel: vscode.WebviewPanel | undefined;

/**
 * Run a bounded preview of `modelName` (up to `limit` rows) and show the rows
 * in a webview panel in the editor area. The panel is re-created (not reused)
 * on every run.
 */
export function showPreview(
  modelName: string,
  projectRoot: string,
  limit: number,
): Promise<void> {
  return showIn(modelName, limit, () => runDbtShow(modelName, projectRoot, limit));
}

/**
 * The same panel, for an editor selection rather than a whole model: `sql` is
 * run through `dbt show --inline` and `label` (a short one-line summary of the
 * selection) titles the panel.
 */
export function showInlinePreview(
  sql: string,
  label: string,
  projectRoot: string,
  limit: number,
): Promise<void> {
  return showIn(label, limit, () => runDbtShowInline(sql, projectRoot, limit));
}

/** Open the single preview panel on `title`, then fill it with `run`'s output. */
async function showIn(title: string, limit: number, run: () => Promise<string>): Promise<void> {
  panel?.dispose();
  const current = vscode.window.createWebviewPanel(
    'dbtBooster.preview',
    `Preview: ${title}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel = current;
  current.onDidDispose(() => {
    if (panel === current) {
      panel = undefined;
    }
  });
  current.webview.html = render(title, limit, undefined, 'Running preview…');

  const raw = await run();
  if (panel !== current) {
    return; // superseded by a newer preview or closed while dbt was running
  }
  const result = parseDbtShowOutput(raw);
  current.webview.html = render(title, limit, result);
}

function render(
  title: string,
  limit: number,
  result: DbtShowResult | undefined,
  loading?: string,
): string {
  const nonce = getNonce();
  const body = loading !== undefined ? loadingBody(loading) : resultBody(result!);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Preview: ${escapeHtml(title)}</title>
<style>
  body { margin: 0; padding: 12px 16px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
  h1 { font-size: 13px; font-weight: 600; margin: 0 0 10px; display: flex; align-items: baseline; gap: 8px; }
  .limit-badge { font-size: 11px; font-weight: 400; opacity: 0.6; }
  .message { opacity: 0.75; padding: 8px 0; }
  .error { color: var(--vscode-errorForeground, #f14c4c); white-space: pre-wrap; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid var(--vscode-panel-border, #454545); padding: 4px 8px; text-align: left; font-size: 12px; white-space: nowrap; }
  th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
  th { cursor: pointer; user-select: none; background: var(--vscode-editorWidget-background, #252526); position: sticky; top: 0; }
  th:hover { background: var(--vscode-list-hoverBackground, #2a2d2e); }
  th .arrow { opacity: 0.6; margin-left: 4px; }
  tbody tr:nth-child(even) { background: rgba(128, 128, 128, 0.08); }
  tbody tr:hover { background: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.16)); }
  .table-wrap { overflow: auto; max-height: calc(100vh - 60px); }
</style>
</head>
<body>
<h1>Preview: ${escapeHtml(title)} <span class="limit-badge">limit ${limit}</span></h1>
${body}
<script nonce="${nonce}">
(function () {
  const table = document.querySelector('table');
  if (!table) return;
  const tbody = table.querySelector('tbody');
  const headers = Array.from(table.querySelectorAll('th'));
  let sortCol = -1;
  let ascending = true;
  headers.forEach((th, index) => {
    th.addEventListener('click', () => {
      ascending = sortCol === index ? !ascending : true;
      sortCol = index;
      headers.forEach((h) => { h.querySelector('.arrow')?.remove(); });
      const arrow = document.createElement('span');
      arrow.className = 'arrow';
      arrow.textContent = ascending ? '▲' : '▼';
      th.appendChild(arrow);
      const rows = Array.from(tbody.querySelectorAll('tr'));
      rows.sort((a, b) => {
        const av = a.children[index].dataset.raw ?? '';
        const bv = b.children[index].dataset.raw ?? '';
        const an = Number(av);
        const bn = Number(bv);
        let cmp;
        if (av !== '' && bv !== '' && !Number.isNaN(an) && !Number.isNaN(bn)) {
          cmp = an - bn;
        } else {
          cmp = av.localeCompare(bv);
        }
        return ascending ? cmp : -cmp;
      });
      rows.forEach((row) => tbody.appendChild(row));
    });
  });
})();
</script>
</body>
</html>`;
}

function loadingBody(message: string): string {
  return `<div class="message">${escapeHtml(message)}</div>`;
}

function resultBody(result: DbtShowResult): string {
  if (!result.ok) {
    return `<div class="message error">${escapeHtml(result.message ?? 'dbt show failed.')}</div>`;
  }
  if (result.rows.length === 0) {
    return `<div class="message">Query returned 0 rows.</div>`;
  }
  const numeric = numericColumns(result);
  const head = result.columns
    .map((col, i) => `<th${numeric[i] ? ' class="num"' : ''}>${escapeHtml(col)}</th>`)
    .join('');
  const rows = result.rows
    .map((row) => {
      const cells = row
        .map((value, i) => {
          const text = formatCell(value);
          const cls = numeric[i] ? ' class="num"' : '';
          return `<td${cls} data-raw="${escapeHtml(text)}">${escapeHtml(text)}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
