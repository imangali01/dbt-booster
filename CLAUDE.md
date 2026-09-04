# CLAUDE.md — dbt booster

Context for a fresh session. Read this first, then `.scratch/dbt-booster/issues/` for the ticket backlog.

## What this is

A lean, clean-room VS Code extension for dbt projects — a personal tool that will also be
published to a marketplace. Two features:

1. **Lineage panel** — an interactive dependency graph for the model you are editing.
2. **Run buttons** — one-click Run / Test / Build / Preview for that model, from the editor
   title bar (and later from graph nodes).

It is a from-scratch analogue of "dbt Power User" with the AI assistant deliberately left out.
**No code is borrowed** from dbt Power User or any other extension. No telemetry, no cloud
account, no AI features.

## Hard design decisions (do not relitigate)

These were settled with the user during a grilling session. Honour them.

- **Buttons are exactly: Run, Test, Build, Preview.** No "Compile" button.
- **Selectors target the model only** — `dbt run --select <model>`, never `+model` / `model+`.
- **dbt resolves its own `profiles.yml`.** Never pass `--profiles-dir` or `--target`. No `.env`
  loading, no environment shims.
- **One user setting only: `dbtBooster.dbtPath`** (default `dbt`). Everything else is a
  hardcoded constant: lineage depth = 2 up / 2 down, preview limit = 500 rows.
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
                                cycle-safe), resolveNodeIdForFile (original_file_path → stem),
                                countModels, normaliseManifest, all the Lineage* types
  manifestStore.ts        GLUE  ManifestStore — load target/manifest.json, RelativePattern
                                watcher, missing-manifest "Run dbt parse" prompt,
                                resolveModelId / lineageAround / absolutePathForNode
  dbtTerminal.ts          GLUE  runDbt(args, cwd) — the shared `dbt-booster` terminal; dbtCommand()
  lineagePanelProvider.ts GLUE  LineagePanelProvider — WebviewViewProvider for the panel;
                                resolves the centre from the active editor, posts graph/empty,
                                handles openFile / recentre / expand; Refresh = dbt parse + reload
  protocol.ts             PURE  ExtensionToWebview / WebviewToExtension message types
  webview/
    index.tsx             React bootstrap
    App.tsx               React Flow surface + custom LineageNode (badges, "＋" handles)
    layout.ts             PURE-ish  layoutLineage() — dagre LR layout → React Flow nodes/edges
    styles.css            theme-var-based node styling
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

## Status (as of ticket 05)

| # | Ticket | State |
|---|---|---|
| 01 | Walking skeleton — scaffold + dual build | ✅ done (v0.0.1) |
| 02 | dbt project discovery | ✅ done (v0.0.2) |
| 03 | Manifest model — graph, resolver, watcher | ✅ done (v0.0.3) |
| 04 | Lineage panel — render | ✅ done (v0.0.4) |
| 05 | Lineage panel — "＋" expand handles | ✅ done (v0.0.5) |
| 06 | Run / Test / Build buttons | ✅ done (v0.0.6) |
| 07 | Preview data | ✅ done (v0.0.7) |
| 08 | Run actions from graph nodes | ⬜ next — unblocked (needs 05, 06, 07) |

41 vitest tests passing. Branch `main`, 7 commits, nothing pushed.

## Stack

TypeScript, esbuild (no webpack), vitest (no VS Code test runner — pure functions only),
React 18 + `@xyflow/react` v12 + `dagre` in the webview. `@vscode/vsce` for packaging.
`publisher` is `imangali01` (placeholder — confirm before any marketplace publish).
