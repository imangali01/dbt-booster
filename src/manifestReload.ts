/**
 * PURE: what to do when reading `target/manifest.json` fails.
 *
 * Most failures are not real: dbt rewrites the manifest on every run/build/
 * test/parse, and the file watcher fires while the write is still in flight —
 * so the read sees a truncated file ("Unexpected end of JSON input") or, for a
 * moment, no file at all. Those settle within a second or two, so a failure is
 * retried a few times, keeping the previous manifest meanwhile, before it is
 * believed. Only a manifest that is still *missing* after the retries is worth
 * the "not found — run dbt parse?" prompt; one that exists but will not parse
 * is logged, not prompted for (parsing it again would not help).
 */

export type ManifestReadError = 'missing' | 'invalid';

/** Wait before each retry of a failed read; the read is believed after the last. */
export const MANIFEST_RETRY_DELAYS_MS: readonly number[] = [300, 1000, 2500];

/** How long to let watcher events settle before reading. */
export const MANIFEST_RELOAD_DEBOUNCE_MS = 250;

export type FailedLoadDecision =
  | { action: 'retry'; delayMs: number }
  | { action: 'give-up'; keepPrevious: boolean; prompt: boolean };

/**
 * `attempt` counts failed reads so far for this reload, starting at 0.
 * `hasPrevious` says whether a manifest from an earlier read is loaded.
 */
export function afterFailedManifestLoad(
  error: ManifestReadError,
  attempt: number,
  hasPrevious: boolean,
): FailedLoadDecision {
  if (attempt < MANIFEST_RETRY_DELAYS_MS.length) {
    return { action: 'retry', delayMs: MANIFEST_RETRY_DELAYS_MS[attempt] };
  }
  if (error === 'invalid') {
    // A broken file: the last good manifest is still the best lineage we have.
    return { action: 'give-up', keepPrevious: hasPrevious, prompt: false };
  }
  // Really gone (e.g. `dbt clean`): drop it and offer a parse.
  return { action: 'give-up', keepPrevious: false, prompt: true };
}
