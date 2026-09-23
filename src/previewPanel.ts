import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import * as path from 'path';
import { DEFAULT_PREVIEW_LIMIT, runDbtShow, runDbtShowInline } from './dbtShow';
import { numericColumns, parseDbtShowOutput } from './dbtShowParser';
import { allRowsLoaded, matchesFilters, nextPreviewLimit } from './previewFilter';

let panel: vscode.WebviewPanel | undefined;

/** The SQL shown above the rows, and which kind of text it is. */
interface ShownSql {
  text: string;
  kind: 'compiled' | 'source' | 'selection';
}

/** What a preview panel runs, re-run with a bigger limit on every "load more". */
interface PreviewSource {
  title: string;
  run(limit: number): Promise<string>;
  /** The SQL to show, looked up after a run that started at `startedAt` (epoch ms). */
  sql(startedAt: number): Promise<ShownSql | undefined>;
}

/** Messages the extension posts to the preview webview. */
type PreviewUpdate =
  | { type: 'loading'; limit: number }
  | {
      type: 'result';
      limit: number;
      sql?: ShownSql;
      ok: boolean;
      message?: string;
      columns: string[];
      numeric: boolean[];
      rows: (string | null)[][];
      complete: boolean;
    };

/**
 * Preview model `modelName`, starting at {@link DEFAULT_PREVIEW_LIMIT} rows,
 * in a webview panel in the editor area. `sqlFiles` locates the model's SQL so
 * the panel can show what ran: the compiled file when this run refreshed it,
 * the model's source otherwise.
 */
export function showPreview(
  modelName: string,
  projectRoot: string,
  sqlFiles?: { source: string; compiled?: string },
): Promise<void> {
  return showIn({
    title: modelName,
    run: (limit) => runDbtShow(modelName, projectRoot, limit),
    sql: (startedAt) => readModelSql(sqlFiles, startedAt),
  });
}

/**
 * The same panel, for an editor selection rather than a whole model: `sql` is
 * run through `dbt show --inline` and `label` (a short one-line summary of the
 * selection) titles the panel. The SQL shown is dbt's compiled version of the
 * selection, falling back to the selection itself if dbt did not write one.
 */
export function showInlinePreview(sql: string, label: string, projectRoot: string): Promise<void> {
  return showIn({
    title: label,
    run: (limit) => runDbtShowInline(sql, projectRoot, limit),
    sql: async (startedAt) =>
      (await readInlineCompiledSql(projectRoot, startedAt)) ?? { text: sql, kind: 'selection' },
  });
}

/**
 * Where dbt (1.8) writes a compiled `--inline` query, under
 * `target/compiled/<root project>/`: the inline node's "file" is the pseudo
 * path `from remote system.sql`, and its name is `inline_query`.
 */
const INLINE_COMPILED_PARTS = ['from remote system.sql', 'sql', 'inline_query'];

/**
 * The compiled SQL of the inline query that just ran, with `ref()` / `source()`
 * already resolved to relation names. Every package dir under
 * `target/compiled` is tried; only a file written by this run counts.
 */
async function readInlineCompiledSql(
  projectRoot: string,
  startedAt: number,
): Promise<ShownSql | undefined> {
  const compiledRoot = path.join(projectRoot, 'target', 'compiled');
  let packages: string[];
  try {
    packages = await fs.readdir(compiledRoot);
  } catch {
    return undefined;
  }
  for (const pkg of packages) {
    const text = await readIfFresh(path.join(compiledRoot, pkg, ...INLINE_COMPILED_PARTS), startedAt);
    if (text !== undefined) {
      return { text, kind: 'compiled' };
    }
  }
  return undefined;
}

/** `file`'s text if dbt wrote it during a run that started at `startedAt`, else undefined. */
async function readIfFresh(file: string, startedAt: number): Promise<string | undefined> {
  try {
    const stat = await fs.stat(file);
    // A little slack for filesystem timestamp granularity.
    return stat.mtimeMs >= startedAt - 2000 ? await fs.readFile(file, 'utf8') : undefined;
  } catch {
    return undefined;
  }
}

/**
 * dbt rewrites `target/compiled/…` whenever it compiles the model, which
 * `dbt show` does — so a compiled file at least as new as the run is the SQL
 * that just ran. An older one is stale; fall back to the source file.
 */
async function readModelSql(
  files: { source: string; compiled?: string } | undefined,
  startedAt: number,
): Promise<ShownSql | undefined> {
  if (!files) {
    return undefined;
  }
  const compiled = files.compiled ? await readIfFresh(files.compiled, startedAt) : undefined;
  if (compiled !== undefined) {
    return { text: compiled, kind: 'compiled' };
  }
  try {
    return { text: await fs.readFile(files.source, 'utf8'), kind: 'source' };
  } catch {
    return undefined;
  }
}

/** Open the single preview panel on `source`, run it, and serve "load more" requests. */
async function showIn(source: PreviewSource): Promise<void> {
  panel?.dispose();
  const current = vscode.window.createWebviewPanel(
    'dbtBooster.preview',
    `Preview: ${source.title}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel = current;
  current.onDidDispose(() => {
    if (panel === current) {
      panel = undefined;
    }
  });
  current.webview.html = render(source.title);

  let limit = DEFAULT_PREVIEW_LIMIT;
  let running = false;
  const post = (update: PreviewUpdate) => void current.webview.postMessage(update);

  const load = async () => {
    running = true;
    post({ type: 'loading', limit });
    const startedAt = Date.now();
    const raw = await source.run(limit);
    const sql = await source.sql(startedAt);
    running = false;
    if (panel !== current) {
      return; // superseded by a newer preview or closed while dbt was running
    }
    const result = parseDbtShowOutput(raw);
    post({
      type: 'result',
      limit,
      sql,
      ok: result.ok,
      message: result.message,
      columns: result.columns,
      numeric: numericColumns(result),
      rows: result.rows.map((row) => row.map(formatCell)),
      complete: allRowsLoaded(result.rows.length, limit),
    });
  };

  current.webview.onDidReceiveMessage((msg: { type?: string; count?: unknown }) => {
    if (msg?.type === 'more' && !running) {
      limit = nextPreviewLimit(limit, msg.count, DEFAULT_PREVIEW_LIMIT);
      void load();
    }
  });

  await load();
}

function formatCell(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * The panel's static shell. Everything data-dependent arrives later as
 * {@link PreviewUpdate} messages, so sort order and filter text survive a
 * "load more" re-run.
 */
function render(title: string): string {
  const nonce = getNonce();
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
  .badge { font-size: 11px; font-weight: 400; opacity: 0.6; }
  .message { opacity: 0.75; padding: 8px 0; }
  .error { color: var(--vscode-errorForeground, #f14c4c); white-space: pre-wrap; opacity: 1; }
  details.sql { margin: 0 0 10px; border: 1px solid var(--vscode-panel-border, #454545); border-radius: 3px; }
  details.sql summary { cursor: pointer; padding: 4px 8px; font-size: 12px; user-select: none; background: var(--vscode-editorWidget-background, #252526); }
  details.sql pre { margin: 0; padding: 8px; max-height: 240px; overflow: auto; font-family: var(--vscode-editor-font-family, monospace); font-size: var(--vscode-editor-font-size, 12px); white-space: pre; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid var(--vscode-panel-border, #454545); padding: 4px 8px; text-align: left; font-size: 12px; white-space: nowrap; }
  th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
  thead th { background: var(--vscode-editorWidget-background, #252526); position: sticky; z-index: 1; }
  thead tr.names th { top: 0; cursor: pointer; user-select: none; }
  thead tr.names th:hover { background: var(--vscode-list-hoverBackground, #2a2d2e); }
  thead tr.filters th { top: var(--names-height, 25px); padding: 2px 4px; }
  th .arrow { opacity: 0.6; margin-left: 4px; }
  tr.filters input { width: 100%; min-width: 60px; box-sizing: border-box; font: inherit; font-size: 11px; padding: 2px 4px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); }
  tr.filters input:focus { outline: 1px solid var(--vscode-focusBorder); }
  td.null { opacity: 0.45; font-style: italic; }
  tbody tr:nth-child(even) { background: rgba(128, 128, 128, 0.08); }
  tbody tr:hover { background: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.16)); }
  .table-wrap { overflow: auto; max-height: calc(100vh - 140px); }
  .footer { display: flex; align-items: center; gap: 8px; padding: 8px 0; font-size: 12px; }
  .footer .status { opacity: 0.7; }
  .footer button { font: inherit; padding: 2px 10px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: none; border-radius: 2px; cursor: pointer; }
  .footer button:hover { background: var(--vscode-button-hoverBackground); }
  .footer button:disabled { opacity: 0.5; cursor: default; }
  .footer input { width: 64px; font: inherit; padding: 2px 4px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); }
</style>
</head>
<body>
<h1>Preview: ${escapeHtml(title)} <span class="badge" id="badge"></span></h1>
<details class="sql" id="sql" hidden><summary id="sql-summary"></summary><pre id="sql-text"></pre></details>
<div id="content"><div class="message">Running preview…</div></div>
<div class="footer" id="footer" hidden>
  <span class="status" id="status"></span>
  <span id="more-controls">
    <button id="more" title="Load more rows">+</button>
    <input id="more-count" type="number" min="1" step="1" value="${DEFAULT_PREVIEW_LIMIT}" title="How many more rows" />
    <span class="status">more rows</span>
  </span>
</div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const matchesFilters = ${matchesFilters.toString()};
  const $ = (id) => document.getElementById(id);
  const SQL_KIND = { compiled: 'SQL — compiled (as run by dbt)', source: 'SQL — model source', selection: 'SQL — selection' };

  let data = null;           // last 'result' message
  let loading = false;
  let sortCol = -1;          // index into data.columns
  let ascending = true;
  let sortName = null;       // column name, so sort survives a re-run
  const filterByName = {};   // column name -> filter text

  $('more').addEventListener('click', requestMore);
  $('more-count').addEventListener('keydown', (e) => { if (e.key === 'Enter') requestMore(); });

  function requestMore() {
    if (loading) return;
    vscode.postMessage({ type: 'more', count: Number($('more-count').value) });
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'loading') {
      loading = true;
      $('badge').textContent = 'limit ' + msg.limit + ' · running…';
      if (!data) { $('content').innerHTML = '<div class="message">Running preview…</div>'; }
      updateFooter();
    } else if (msg.type === 'result') {
      loading = false;
      data = msg;
      $('badge').textContent = 'limit ' + msg.limit;
      renderSql(msg.sql);
      renderResult();
    }
  });

  function renderSql(sql) {
    const box = $('sql');
    if (!sql) { box.hidden = true; return; }
    box.hidden = false;
    $('sql-summary').textContent = SQL_KIND[sql.kind] || 'SQL';
    $('sql-text').textContent = sql.text;
  }

  function renderResult() {
    const content = $('content');
    content.textContent = '';
    if (!data.ok) {
      const div = document.createElement('div');
      div.className = 'message error';
      div.textContent = data.message || 'dbt show failed.';
      content.appendChild(div);
      $('footer').hidden = true;
      return;
    }
    if (data.rows.length === 0) {
      content.innerHTML = '<div class="message">Query returned 0 rows.</div>';
      $('footer').hidden = true;
      return;
    }
    sortCol = sortName === null ? -1 : data.columns.indexOf(sortName);

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const names = document.createElement('tr');
    names.className = 'names';
    const filters = document.createElement('tr');
    filters.className = 'filters';
    data.columns.forEach((col, i) => {
      const th = document.createElement('th');
      if (data.numeric[i]) th.className = 'num';
      th.textContent = col;
      if (i === sortCol) appendArrow(th);
      th.addEventListener('click', () => {
        ascending = sortCol === i ? !ascending : true;
        sortCol = i;
        sortName = col;
        names.querySelectorAll('.arrow').forEach((a) => a.remove());
        appendArrow(th);
        renderBody();
      });
      names.appendChild(th);

      const fth = document.createElement('th');
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'filter';
      input.value = filterByName[col] || '';
      input.addEventListener('input', () => { filterByName[col] = input.value; renderBody(); });
      fth.appendChild(input);
      filters.appendChild(fth);
    });
    thead.appendChild(names);
    thead.appendChild(filters);
    table.appendChild(thead);
    table.appendChild(document.createElement('tbody'));
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.appendChild(table);
    content.appendChild(wrap);
    document.documentElement.style.setProperty('--names-height', names.getBoundingClientRect().height + 'px');
    renderBody();
  }

  function appendArrow(th) {
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = ascending ? '▲' : '▼';
    th.appendChild(arrow);
  }

  function renderBody() {
    const tbody = document.querySelector('tbody');
    if (!tbody) return;
    const active = data.columns.map((col) => filterByName[col] || '');
    let rows = data.rows.filter((row) => matchesFilters(row, active));
    if (sortCol >= 0) {
      const i = sortCol;
      rows = rows.slice().sort((a, b) => {
        const av = a[i] === null ? '' : a[i];
        const bv = b[i] === null ? '' : b[i];
        const an = Number(av);
        const bn = Number(bv);
        const cmp = av !== '' && bv !== '' && !Number.isNaN(an) && !Number.isNaN(bn)
          ? an - bn
          : av.localeCompare(bv);
        return ascending ? cmp : -cmp;
      });
    }
    const fragment = document.createDocumentFragment();
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      row.forEach((value, i) => {
        const td = document.createElement('td');
        const classes = [];
        if (data.numeric[i]) classes.push('num');
        if (value === null) classes.push('null');
        if (classes.length) td.className = classes.join(' ');
        td.textContent = value === null ? 'NULL' : value;
        tr.appendChild(td);
      });
      fragment.appendChild(tr);
    });
    tbody.textContent = '';
    tbody.appendChild(fragment);
    updateFooter(rows.length);
  }

  function updateFooter(shown) {
    if (!data || !data.ok || data.rows.length === 0) return;
    $('footer').hidden = false;
    const total = data.rows.length;
    const visible = shown === undefined ? document.querySelectorAll('tbody tr').length : shown;
    let text = visible === total ? total + ' rows' : visible + ' of ' + total + ' rows (filtered)';
    if (data.complete) text += ' · all rows loaded';
    if (loading) text += ' · loading more…';
    $('status').textContent = text;
    $('more-controls').hidden = data.complete;
    $('more').disabled = loading;
  }
})();
</script>
</body>
</html>`;
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
