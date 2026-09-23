import { showArgs } from './dbtArgs';
import { runDbtCaptured } from './dbtProcess';

/** Row limit offered when the user is asked how much to preview. */
export const DEFAULT_PREVIEW_LIMIT = 20;

/**
 * Run `dbt show --select <model> --limit <limit> --output json` as a background
 * process (not the shared terminal) so its output can be parsed. Resolves with
 * the combined stdout+stderr text, including the readable message a failed
 * launch produces.
 */
export function runDbtShow(
  modelName: string,
  cwd: string,
  limit: number = DEFAULT_PREVIEW_LIMIT,
): Promise<string> {
  return runShow(['--select', modelName], cwd, limit);
}

/**
 * Same as {@link runDbtShow}, but for an arbitrary SQL fragment (an editor
 * selection) rather than a named model. dbt compiles the inline SQL in the
 * project's context, so `{{ ref('…') }}` inside the fragment still resolves.
 *
 * Needs dbt-core 1.5 or newer, which is where `--inline` arrived; on an older
 * dbt the usage error comes back through the returned text like any other
 * failure. The SQL travels as a single argv entry — `runDbtCaptured` spawns
 * without a shell, so it needs no quoting or escaping.
 */
export function runDbtShowInline(
  sql: string,
  cwd: string,
  limit: number = DEFAULT_PREVIEW_LIMIT,
): Promise<string> {
  return runShow(['--inline', sql], cwd, limit);
}

async function runShow(selector: string[], cwd: string, limit: number): Promise<string> {
  const { output } = await runDbtCaptured(showArgs(selector, limit), cwd);
  return output;
}
