import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import * as path from 'path';
import { DEFAULT_PREVIEW_LIMIT, runDbtShow, runDbtShowInline } from './dbtShow';
import { numericColumns, parseDbtShowOutput } from './dbtShowParser';
import {
  allRowsLoaded,
  distinctValues,
  nextPreviewLimit,
  passesValueFilters,
} from './previewFilter';
import { PREVIEW_STAGES, stageDurations, stageFromOutput } from './previewProgress';

let panel: vscode.WebviewPanel | undefined;

/**
 * How long each stage took on the last successful preview this session — the
 * progress bar's estimate for the next run. Starts from the stages' defaults.
 */
let expectedStageMs: number[] = PREVIEW_STAGES.map((stage) => stage.defaultSeconds * 1000);

/** The SQL shown above the rows, and which kind of text it is. */
interface ShownSql {
  text: string;
  kind: 'compiled' | 'source' | 'selection';
}

/** What a preview panel runs, re-run with a bigger limit on every "load more". */
interface PreviewSource {
  title: string;
  /** Run dbt; `onOutput` streams its output as it arrives. */
  run(limit: number, onOutput: (text: string) => void): Promise<string>;
  /** The SQL to show, looked up after a run that started at `startedAt` (epoch ms). */
  sql(startedAt: number): Promise<ShownSql | undefined>;
}

/** Messages the extension posts to the preview webview. */
type PreviewUpdate =
  | { type: 'loading'; limit: number; stages: string[]; expectedMs: number[] }
  | { type: 'stage'; index: number }
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
      /** How long each stage took, ms. */
      stageMs: number[];
      totalMs: number;
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
    run: (limit, onOutput) => runDbtShow(modelName, projectRoot, limit, onOutput),
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
    run: (limit, onOutput) => runDbtShowInline(sql, projectRoot, limit, onOutput),
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
    post({
      type: 'loading',
      limit,
      stages: PREVIEW_STAGES.map((stage) => stage.label),
      expectedMs: expectedStageMs,
    });
    const startedAt = Date.now();
    // When each stage began; a stage dbt skipped past stays undefined.
    const stageStartedAt: (number | undefined)[] = [startedAt];
    let stage = 0;
    let output = '';
    const raw = await source.run(limit, (text) => {
      output += text;
      const next = stageFromOutput(output, stage);
      if (next !== stage) {
        stage = next;
        stageStartedAt[next] = Date.now();
        post({ type: 'stage', index: next });
      }
    });
    const endedAt = Date.now();
    const sql = await source.sql(startedAt);
    running = false;
    if (panel !== current) {
      return; // superseded by a newer preview or closed while dbt was running
    }
    const result = parseDbtShowOutput(raw);
    const stageMs = stageDurations(stageStartedAt, endedAt);
    if (result.ok && stage === PREVIEW_STAGES.length - 1) {
      expectedStageMs = stageMs;
    }
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
      stageMs,
      totalMs: endedAt - startedAt,
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
  /* Rules like .footer { display: flex } would otherwise override the hidden attribute. */
  [hidden] { display: none !important; }
  .progress { margin: 0 0 10px; padding: 8px 10px; border: 1px solid var(--vscode-panel-border, #454545); border-radius: 3px; background: var(--vscode-editorWidget-background, #252526); font-size: 12px; }
  .progress .bar { height: 6px; border-radius: 3px; overflow: hidden; background: rgba(128, 128, 128, 0.25); }
  .progress .fill { height: 100%; width: 0; background: var(--vscode-progressBar-background, #0e70c0); transition: width 0.1s linear; }
  .progress .now { display: flex; justify-content: space-between; gap: 12px; margin: 6px 0 4px; }
  .progress .now .stage { font-weight: 600; }
  .progress .now .clock { font-variant-numeric: tabular-nums; opacity: 0.8; white-space: nowrap; }
  .progress ol { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 16px; }
  .progress li { display: flex; gap: 6px; opacity: 0.5; font-variant-numeric: tabular-nums; }
  .progress li.done { opacity: 0.8; }
  .progress li.active { opacity: 1; }
  .progress li .mark { width: 1em; text-align: center; }
  .timing { font-size: 11px; opacity: 0.6; margin: -4px 0 8px; font-variant-numeric: tabular-nums; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid var(--vscode-panel-border, #454545); padding: 4px 8px; text-align: left; font-size: 12px; white-space: nowrap; }
  th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
  thead th { background: var(--vscode-editorWidget-background, #252526); position: sticky; top: 0; z-index: 1; padding-right: 4px; }
  th .head { display: flex; align-items: center; gap: 4px; }
  th.num .head { justify-content: flex-end; }
  th .name { cursor: pointer; user-select: none; }
  th .name:hover { text-decoration: underline; }
  th .arrow { opacity: 0.6; }
  th .filter-btn { font: inherit; font-size: 10px; line-height: 1; padding: 2px 4px; margin-left: auto; color: inherit; background: transparent; border: 1px solid transparent; border-radius: 2px; cursor: pointer; opacity: 0.55; }
  th.num .filter-btn { margin-left: 4px; }
  th .filter-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.2)); }
  th .filter-btn.active { opacity: 1; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  .filter-pop { position: fixed; z-index: 10; width: 260px; display: flex; flex-direction: column; gap: 6px; padding: 8px; font-size: 12px; background: var(--vscode-editorWidget-background, #252526); color: var(--vscode-editorWidget-foreground, inherit); border: 1px solid var(--vscode-editorWidget-border, #454545); border-radius: 3px; box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0,0,0,0.36)); }
  .filter-pop .sorts { display: flex; gap: 4px; }
  .filter-pop .sorts button { flex: 1; }
  .filter-pop input[type=text] { font: inherit; padding: 3px 6px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); }
  .filter-pop input[type=text]:focus { outline: 1px solid var(--vscode-focusBorder); }
  .filter-pop .list { max-height: 260px; overflow: auto; border: 1px solid var(--vscode-panel-border, #454545); padding: 2px 0; }
  .filter-pop label { display: flex; align-items: center; gap: 6px; padding: 2px 6px; cursor: pointer; white-space: nowrap; }
  .filter-pop label:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.16)); }
  .filter-pop label .text { overflow: hidden; text-overflow: ellipsis; flex: 1; }
  .filter-pop label .text.special { opacity: 0.6; font-style: italic; }
  .filter-pop label .count { opacity: 0.5; font-variant-numeric: tabular-nums; }
  .filter-pop .all { font-weight: 600; }
  .filter-pop .actions { display: flex; gap: 4px; }
  .filter-pop .actions .spacer { flex: 1; }
  .filter-pop button { font: inherit; padding: 2px 10px; color: var(--vscode-button-secondaryForeground, inherit); background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2)); border: none; border-radius: 2px; cursor: pointer; }
  .filter-pop button:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.3)); }
  .filter-pop button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  .filter-pop button.primary:hover { background: var(--vscode-button-hoverBackground); }
  .filter-pop .empty { padding: 4px 6px; opacity: 0.6; }
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
<div class="progress" id="progress" hidden>
  <div class="bar"><div class="fill" id="progress-fill"></div></div>
  <div class="now"><span class="stage" id="progress-stage"></span><span class="clock" id="progress-clock"></span></div>
  <ol id="progress-stages"></ol>
</div>
<div class="timing" id="timing" hidden></div>
<div id="content"></div>
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
  const passesValueFilters = ${passesValueFilters.toString()};
  const distinctValues = ${distinctValues.toString()};
  const $ = (id) => document.getElementById(id);
  const SQL_KIND = { compiled: 'SQL — compiled (as run by dbt)', source: 'SQL — model source', selection: 'SQL — selection' };

  let data = null;           // last 'result' message
  let loading = false;
  let sortCol = -1;          // index into data.columns
  let ascending = true;
  let sortName = null;       // column name, so sort survives a re-run
  const excludedByName = {}; // column name -> values unticked in its filter checklist
  let popup = null;          // the open filter dropdown, if any

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
      startProgress(msg.stages, msg.expectedMs);
      updateFooter();
    } else if (msg.type === 'stage') {
      advanceStage(msg.index);
    } else if (msg.type === 'result') {
      loading = false;
      stopProgress(msg.stageMs, msg.totalMs);
      data = msg;
      $('badge').textContent = 'limit ' + msg.limit;
      renderSql(msg.sql);
      renderResult();
    }
  });

  // --- progress: which dbt stage is running, and for how long -------------
  let progress = null; // { stages, expected, started, stageStarts, current, timer }

  function secs(ms) { return (ms / 1000).toFixed(1) + ' s'; }

  function startProgress(stages, expected) {
    if (progress) clearInterval(progress.timer);
    const now = performance.now();
    progress = { stages, expected, started: now, stageStarts: [now], current: 0, timer: 0 };
    const list = $('progress-stages');
    list.textContent = '';
    stages.forEach((label) => {
      const li = document.createElement('li');
      const mark = document.createElement('span');
      mark.className = 'mark';
      const text = document.createElement('span');
      text.textContent = label;
      const time = document.createElement('span');
      time.className = 'time';
      li.appendChild(mark);
      li.appendChild(text);
      li.appendChild(time);
      list.appendChild(li);
    });
    $('progress').hidden = false;
    $('timing').hidden = true;
    progress.timer = setInterval(tickProgress, 100);
    tickProgress();
  }

  function advanceStage(index) {
    if (!progress || index <= progress.current) return;
    const now = performance.now();
    for (let i = progress.current + 1; i <= index; i++) progress.stageStarts[i] = now;
    progress.current = index;
    tickProgress();
  }

  function tickProgress() {
    if (!progress) return;
    const now = performance.now();
    const p = progress;
    const total = p.expected.reduce((a, b) => a + b, 0) || 1;
    let before = 0;
    for (let i = 0; i < p.current; i++) before += p.expected[i];
    const inStage = now - p.stageStarts[p.current];
    // Creep towards the end of the current stage, never past 95% of it, so an
    // overrunning stage stalls instead of the bar claiming to be finished.
    const partial = Math.min(inStage, p.expected[p.current] * 0.95);
    const pct = Math.min(99, ((before + partial) / total) * 100);
    $('progress-fill').style.width = pct.toFixed(1) + '%';
    $('progress-stage').textContent =
      (p.current + 1) + '/' + p.stages.length + ' · ' + p.stages[p.current] + '… ' + secs(inStage);
    $('progress-clock').textContent = 'total ' + secs(now - p.started) + ' · usually ~' + secs(total);
    const items = $('progress-stages').children;
    for (let i = 0; i < items.length; i++) {
      const li = items[i];
      const started = p.stageStarts[i];
      const next = p.stageStarts.slice(i + 1).find((t) => t !== undefined);
      li.className = i < p.current ? 'done' : i === p.current ? 'active' : '';
      li.querySelector('.mark').textContent = i < p.current ? '✓' : i === p.current ? '●' : '○';
      li.querySelector('.time').textContent =
        started === undefined ? '' : secs((i < p.current && next !== undefined ? next : now) - started);
    }
  }

  function stopProgress(stageMs, totalMs) {
    if (progress) clearInterval(progress.timer);
    const stages = progress ? progress.stages : [];
    progress = null;
    $('progress').hidden = true;
    const parts = stages.map((label, i) => label + ' ' + secs(stageMs[i] || 0));
    $('timing').textContent = 'dbt took ' + secs(totalMs) + ' — ' + parts.join(' · ');
    $('timing').hidden = false;
  }

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

    closePopup();
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const names = document.createElement('tr');
    data.columns.forEach((col, i) => {
      const th = document.createElement('th');
      if (data.numeric[i]) th.className = 'num';
      const head = document.createElement('div');
      head.className = 'head';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = col;
      name.title = 'Sort';
      name.addEventListener('click', () => setSort(i, sortCol === i ? !ascending : true));
      head.appendChild(name);
      if (i === sortCol) appendArrow(head);
      const btn = document.createElement('button');
      btn.className = 'filter-btn' + ((excludedByName[col] || []).length ? ' active' : '');
      btn.textContent = '▾';
      btn.title = 'Filter';
      btn.addEventListener('click', (e) => { e.stopPropagation(); openPopup(i, btn); });
      head.appendChild(btn);
      th.appendChild(head);
      names.appendChild(th);
    });
    thead.appendChild(names);
    table.appendChild(thead);
    table.appendChild(document.createElement('tbody'));
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.appendChild(table);
    content.appendChild(wrap);
    renderBody();
  }

  function setSort(i, asc) {
    sortCol = i;
    sortName = data.columns[i];
    ascending = asc;
    renderResult();
  }

  /** Each column's excluded values, with column skipCol's left out (-1: none). */
  function excludedList(skipCol) {
    return data.columns.map((col, i) => (i === skipCol ? [] : excludedByName[col] || []));
  }

  function displayText(value) {
    if (value === null) return '(NULL)';
    if (value === '') return '(empty)';
    return value;
  }

  function closePopup() {
    if (popup) { popup.remove(); popup = null; }
  }

  document.addEventListener('mousedown', (e) => {
    if (popup && !popup.contains(e.target)) closePopup();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopup(); });

  // Excel-style checklist of every value in column i (among the rows the other
  // columns' filters keep), with search, select-all, sort, clear and OK/Cancel.
  function openPopup(i, anchor) {
    const wasThis = popup && popup.dataset.col === String(i);
    closePopup();
    if (wasThis) return;
    const col = data.columns[i];
    const others = excludedList(i);
    const values = distinctValues(data.rows.filter((row) => passesValueFilters(row, others)), i);
    const prior = excludedByName[col] || [];
    const checked = values.map((v) => prior.indexOf(v.value) === -1);

    const pop = document.createElement('div');
    pop.className = 'filter-pop';
    pop.dataset.col = String(i);

    const sorts = document.createElement('div');
    sorts.className = 'sorts';
    [['Sort ▲', true], ['Sort ▼', false]].forEach((pair) => {
      const b = document.createElement('button');
      b.textContent = pair[0];
      b.addEventListener('click', () => setSort(i, pair[1]));
      sorts.appendChild(b);
    });
    pop.appendChild(sorts);

    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Search';
    pop.appendChild(search);

    const list = document.createElement('div');
    list.className = 'list';
    pop.appendChild(list);

    let visible = [];
    let allBox = null;
    const matchesSearch = (v) => {
      const needle = search.value.trim().toLowerCase();
      return needle === '' || displayText(v.value).toLowerCase().indexOf(needle) !== -1;
    };
    function drawList() {
      visible = [];
      values.forEach((v, k) => { if (matchesSearch(v)) visible.push(k); });
      list.textContent = '';
      allBox = null;
      if (visible.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'No matches';
        list.appendChild(empty);
        return;
      }
      const all = document.createElement('label');
      all.className = 'all';
      const box = document.createElement('input');
      box.type = 'checkbox';
      all.appendChild(box);
      const allText = document.createElement('span');
      allText.className = 'text';
      allText.textContent = search.value.trim() === '' ? '(Select all)' : '(Select all search results)';
      all.appendChild(allText);
      box.addEventListener('change', () => {
        visible.forEach((k) => { checked[k] = box.checked; });
        drawList();
      });
      list.appendChild(all);
      allBox = box;
      visible.forEach((k) => {
        const v = values[k];
        const label = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = checked[k];
        cb.addEventListener('change', () => { checked[k] = cb.checked; syncAll(); });
        label.appendChild(cb);
        const text = document.createElement('span');
        text.className = 'text' + (v.value === null || v.value === '' ? ' special' : '');
        text.textContent = displayText(v.value);
        text.title = displayText(v.value);
        label.appendChild(text);
        const count = document.createElement('span');
        count.className = 'count';
        count.textContent = String(v.count);
        label.appendChild(count);
        list.appendChild(label);
      });
      syncAll();
    }
    function syncAll() {
      if (!allBox) return;
      const on = visible.filter((k) => checked[k]).length;
      allBox.checked = on === visible.length;
      allBox.indeterminate = on > 0 && on < visible.length;
    }
    search.addEventListener('input', drawList);
    drawList();

    function apply() {
      // Values hidden by other columns' filters keep their earlier state;
      // with a search typed, only ticked search results are kept (as in Excel).
      const shown = values.map((v) => v.value);
      const next = prior.filter((value) => shown.indexOf(value) === -1);
      values.forEach((v, k) => {
        if (!checked[k] || !matchesSearch(v)) next.push(v.value);
      });
      excludedByName[col] = next;
      renderResult();
    }

    const actions = document.createElement('div');
    actions.className = 'actions';
    const clear = document.createElement('button');
    clear.textContent = 'Clear';
    clear.title = 'Remove this column filter';
    clear.addEventListener('click', () => { excludedByName[col] = []; renderResult(); });
    actions.appendChild(clear);
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    actions.appendChild(spacer);
    const ok = document.createElement('button');
    ok.className = 'primary';
    ok.textContent = 'OK';
    ok.addEventListener('click', apply);
    actions.appendChild(ok);
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', closePopup);
    actions.appendChild(cancel);
    pop.appendChild(actions);
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });

    document.body.appendChild(pop);
    popup = pop;
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(4, Math.min(r.left, window.innerWidth - pop.offsetWidth - 4)) + 'px';
    pop.style.top = Math.max(4, Math.min(r.bottom + 2, window.innerHeight - pop.offsetHeight - 4)) + 'px';
    search.focus();
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
    let rows = data.rows.filter((row) => passesValueFilters(row, excludedList(-1)));
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
