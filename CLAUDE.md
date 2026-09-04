# CLAUDE.md — dbt booster

Context for a fresh session. Read this first, then `.scratch/dbt-booster/issues/` for the ticket backlog.

## What this is

A lean, clean-room VS Code extension for dbt projects — a personal tool that will also be
published to a marketplace. Two features:

1. **Lineage panel** — an interactive dependency graph for the model you are editing.
2. **Run buttons** — one-click Run / Test / Build / Preview for that model, from the editor
   title bar or by right-clicking a node in the graph.

It is a from-scratch analogue of "dbt Power User" with the AI assistant deliberately left out.
**No code is borrowed** from dbt Power User or any other extension. No telemetry, no cloud
account, no AI features.

## Hard design decisions (do not relitigate)

These were settled with the user during a grilling session. Honour them.

- **Buttons are exactly: Run, Test, Build, Preview.** No "Compile" button.
- **Selectors target the model only, with one narrow exception.** Test / Build / Preview and the
  lineage graph's node context menu always use `--select <model>` — never `+model` / `model+`.
  The one exception (ticket 10, added after the original grilling session): a small "Run With…"
  dropdown next to the editor-title Run button offers "Run Model" (unchanged), "Run with
  Upstream (`+model`)", and "Run with Downstream (`model+`)". Do not spread graph operators to
  any other action without the user asking again.
- **dbt resolves its own `profiles.yml`.** Never pass `--profiles-dir` or `--target`. No `.env`
  loading, no environment shims.
- **One user setting only: `dbtBooster.dbtPath`** (default `dbt`). Lineage depth (2 up / 2 down)
  is a hardcoded constant. Preview's row limit is **not** hardcoded any more (ticket 12, same
  pattern as ticket 10's exception): Preview prompts for it every run, defaulting to 20
  (`DEFAULT_PREVIEW_LIMIT` in `dbtShow.ts`).
- **No CSV / download / export** anywhere in the preview UI.
- **One reused integrated terminal** named `dbt-booster` for Run/Test/Build/parse. Preview runs
  as a background process (not in the terminal) so its JSON output can be parsed.
- **Lineage panel lives in the bottom Panel area** (next to Terminal / Problems), not the
  sidebar.
- Node click opens the model file; **Shift-click re-centres** the graph.

## Project map

```
src/
  extension.ts            activate(): wires everything, registers commands
  projectResolution.ts    PURE  isPathWithin, resolveActiveProjectRoot
  projectRegistry.ts      GLUE  ProjectRegistry — discover dbt_project.yml, track active root,
                                context keys dbtBooster.projectDetected / .multipleProjects
  manifest.ts             PURE  buildLineageSubgraph (depth-limited BFS + "＋" expansion,
                                cycle-safe, carries config.docs.node_color through),
                                resolveNodeIdForFile (original_file_path → stem),
                                countModels, normaliseManifest, all the Lineage* types
  manifestStore.ts        GLUE  ManifestStore — load target/manifest.json, RelativePattern
                                watcher, missing-manifest "Run dbt parse" prompt,
                                resolveModelId / lineageAround / absolutePathForNode
  dbtTerminal.ts          GLUE  runDbt(args, cwd) — the shared `dbt-booster` terminal; dbtCommand()
  pythonEnvironments.ts   PURE  dbtExecutableInEnv, parseCondaEnvironmentsFile, describeDbtPath
  pythonEnvironmentPicker.ts
                          GLUE  pickPythonEnvironment() — QuickPick over discovered conda/venv
                                envs (via ~/.conda/environments.txt, no `conda` on PATH needed) +
                                manual entry + reset; writes dbtBooster.dbtPath, no new setting
  modelActions.ts         GLUE  performModelAction(action, name, root) — run|test|build in the
                                terminal or open the preview panel; runActiveModelAction() resolves
                                that from the active editor for the title-bar buttons/palette;
                                runModelWithScope/runActiveModelWithScope add the Run-variants
                                dropdown's +model / model+ selectors (Run button only)
  dbtShow.ts              GLUE  runDbtShow(model, cwd, limit) — `dbt show --output json` as a
                                background child_process (not the terminal), for Preview;
                                DEFAULT_PREVIEW_LIMIT = 20
  dbtShowParser.ts        PURE  parseDbtShowOutput() — extracts columns/rows from `dbt show` JSON
                                output, tolerant of surrounding plain or structured-JSON log
                                lines; numericColumns() — which columns to right-align
  previewPanel.ts         GLUE  showPreview(model, root) — editor-area WebviewPanel, re-created per
                                run, self-contained HTML/CSS/JS sortable table (no React needed)
  lineagePanelProvider.ts GLUE  LineagePanelProvider — WebviewViewProvider for the panel;
                                resolves the centre from the active editor, posts graph/empty,
                                handles openFile / recentre / expand / nodeAction (run/test/build/
                                preview a right-clicked node); Refresh = dbt parse + reload
  protocol.ts             PURE  ExtensionToWebview / WebviewToExtension message types
  webview/
    index.tsx             React bootstrap
    App.tsx               React Flow surface + custom LineageNode (badges, "＋" handles) +
                           right-click NodeContextMenu (Run/Test/Build/Preview, model nodes only)
    layout.ts             PURE-ish  layoutLineage() — dagre LR layout → React Flow nodes/edges
    styles.css            theme-var-based node + context-menu styling
    vscode.d.ts           acquireVsCodeApi() typing
test/                     vitest — one file per pure module
sample/jaffle/            minimal dbt project + hand-written target/manifest.json fixture
                          (customers ← orders) so features work without a real dbt run
media/lineage.svg         panel container icon
esbuild.mjs               dual build: out/extension.js (node/cjs) + out/webview.js+css (browser/esm)
.scratch/dbt-booster/issues/   the 8 tickets; each carries a Status + Notes section
```

**Pattern:** every non-trivial algorithm is a pure function in its own module with vitest
coverage; VS Code / React glue is thin and untested. Keep it that way.

## Build & test

Commands (`npm run …`): `build`, `watch`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`),
`package` (`vsce package --no-dependencies` → `dbt-booster-<version>.vsix`).

**This machine:** Node 24 / npm 11 are installed at `C:\Program Files\nodejs\` but the shell
PATH can be stale. If `node` is "not recognized", prefix commands in PowerShell with
`$env:Path = "C:\Program Files\nodejs;" + $env:Path;` or restart the session.

Manual check: F5 → Extension Development Host opens on `sample/jaffle`; the "dbt booster" output
channel shows an activation line; the Lineage panel renders for `models/orders.sql`.

## Per-ticket workflow (what the user expects)

1. Implement the ticket — pure function + vitest first, then glue.
2. `npm run typecheck && npm test` green; `npm run build`.
3. Bump `version` in `package.json`, `npm run package`.
4. Tick the acceptance boxes in the ticket file and add a short **Notes** section.
5. One commit per ticket. Commit message ends with:
   `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`
   Commit messages go through a file (`git commit -F`) — inline `-m` with quotes breaks in
   Windows PowerShell.
6. Send the `.vsix` to the user. Do **not** push (there is no remote).

## Status (as of ticket 09)

| # | Ticket | State |
|---|---|---|
| 01 | Walking skeleton — scaffold + dual build | ✅ done (v0.0.1) |
| 02 | dbt project discovery | ✅ done (v0.0.2) |
| 03 | Manifest model — graph, resolver, watcher | ✅ done (v0.0.3) |
| 04 | Lineage panel — render | ✅ done (v0.0.4) |
| 05 | Lineage panel — "＋" expand handles | ✅ done (v0.0.5) |
| 06 | Run / Test / Build buttons | ✅ done (v0.0.6) |
| 07 | Preview data | ✅ done (v0.0.7) |
| 08 | Run actions from graph nodes | ✅ done (v0.0.8) |
| 09 | Lineage panel — draggable nodes | ✅ done (v0.0.9) |
| 10 | Run-variants dropdown (`+model` / `model+`) | ✅ done (v0.0.11) |
| 11 | Python environment picker (status bar) | ✅ done (v0.0.12) |
| 12 | Preview UX polish + configurable row limit | ✅ done (v0.0.13) |
| 13 | Lineage node colour from `dbt_project.yml` | ✅ done (v0.0.14) |

The original 8-ticket backlog is complete; 09–13 are post-backlog additions requested directly
by the user. Also since ticket 08: two fixes to Preview's dbt-launch path — Windows codepage
mojibake, then a follow-up once that turned out to be masking a "dbt not found" (ENOENT) case
(see `src/dbtShow.ts`'s doc comment for why it no longer uses `shell: true`) — which is also the
motivation for ticket 11 (conda-activated envs are invisible to the Extension Host). 55 vitest
tests passing. Branch `main`, 16 commits, nothing pushed. Anything past this point (marketplace
publish, more features) needs a fresh scope discussion with the user — there is no ticket 14 yet.

## Stack

TypeScript, esbuild (no webpack), vitest (no VS Code test runner — pure functions only),
React 18 + `@xyflow/react` v12 + `dagre` in the webview. `@vscode/vsce` for packaging.
`publisher` is `imangali01` (placeholder — confirm before any marketplace publish).
