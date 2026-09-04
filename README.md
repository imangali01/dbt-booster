# dbt booster

A lean VS Code extension for working with [dbt](https://www.getdbt.com/) projects:

- an interactive **lineage graph** for the model you are editing, and
- one-click **Run / Test / Build / Preview** buttons for that model.

No AI assistant, no telemetry, no cloud account. It reads your project's
`target/manifest.json` and shells out to your own `dbt` CLI, letting dbt resolve
`profiles.yml` the way it normally does.

> Status: early development. Only the walking skeleton (ticket 01) is in place so
> far — the extension activates on any workspace containing a `dbt_project.yml`
> and logs a line to its **dbt booster** output channel.

## Running from source

Requirements: Node.js 18+ and a local `dbt` on your `PATH` (or set
`dbtBooster.dbtPath`).

```sh
npm install
npm run build       # produces out/extension.js and out/webview.js
npm test            # vitest
```

Then press **F5** in VS Code. This launches an Extension Development Host opened
on the bundled `sample/jaffle` dbt project; the extension activates and writes an
activation line to the **dbt booster** output channel (View → Output → "dbt
booster").

### Scripts

| Script            | Purpose                                             |
| ----------------- | -------------------------------------------------- |
| `npm run build`   | One-off dual esbuild (extension + webview)         |
| `npm run watch`   | Rebuild on change                                  |
| `npm run typecheck` | `tsc --noEmit`                                   |
| `npm test`        | Run the vitest suite                               |

## License

MIT — see [LICENSE](./LICENSE). This is a clean-room implementation; no code is
taken from other dbt extensions.
