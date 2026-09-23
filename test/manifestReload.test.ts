import { describe, it, expect } from 'vitest';
import { MANIFEST_RETRY_DELAYS_MS, afterFailedManifestLoad } from '../src/manifestReload';

const LAST = MANIFEST_RETRY_DELAYS_MS.length;

describe('afterFailedManifestLoad', () => {
  it('retries a truncated manifest (dbt still writing) with growing delays', () => {
    expect(afterFailedManifestLoad('invalid', 0, true)).toEqual({ action: 'retry', delayMs: 300 });
    expect(afterFailedManifestLoad('invalid', 1, true)).toEqual({ action: 'retry', delayMs: 1000 });
    expect(afterFailedManifestLoad('invalid', 2, true)).toEqual({ action: 'retry', delayMs: 2500 });
  });

  it('retries a momentarily missing manifest too', () => {
    expect(afterFailedManifestLoad('missing', 0, true)).toEqual({ action: 'retry', delayMs: 300 });
  });

  it('never prompts for a manifest that exists but will not parse', () => {
    expect(afterFailedManifestLoad('invalid', LAST, true)).toEqual({
      action: 'give-up',
      keepPrevious: true,
      prompt: false,
    });
    expect(afterFailedManifestLoad('invalid', LAST, false)).toEqual({
      action: 'give-up',
      keepPrevious: false,
      prompt: false,
    });
  });

  it('prompts only once a manifest is still missing after every retry', () => {
    expect(afterFailedManifestLoad('missing', LAST, true)).toEqual({
      action: 'give-up',
      keepPrevious: false,
      prompt: true,
    });
  });
});
