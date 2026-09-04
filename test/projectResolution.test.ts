import { describe, it, expect } from 'vitest';
import { isPathWithin, resolveActiveProjectRoot } from '../src/projectResolution';

describe('isPathWithin', () => {
  it('matches files beneath the root', () => {
    expect(isPathWithin('/w/proj', '/w/proj/models/a.sql')).toBe(true);
  });

  it('matches the root itself', () => {
    expect(isPathWithin('/w/proj', '/w/proj')).toBe(true);
  });

  it('rejects siblings that share a name prefix', () => {
    expect(isPathWithin('/w/proj', '/w/proj-two/models/a.sql')).toBe(false);
  });

  it('handles backslash paths and case-insensitive comparison', () => {
    expect(isPathWithin('C:\\W\\Proj', 'c:\\w\\proj\\models\\a.sql', true)).toBe(true);
  });

  it('stays case-sensitive when not told otherwise', () => {
    expect(isPathWithin('/w/Proj', '/w/proj/a.sql')).toBe(false);
  });
});

describe('resolveActiveProjectRoot', () => {
  const roots = ['/w/alpha', '/w/beta'];

  it('returns undefined when there are no projects', () => {
    expect(resolveActiveProjectRoot([], '/w/alpha/x.sql', undefined)).toBeUndefined();
  });

  it('resolves from the active file', () => {
    expect(resolveActiveProjectRoot(roots, '/w/beta/models/x.sql', undefined)).toBe('/w/beta');
  });

  it('prefers the deepest containing root for nested projects', () => {
    const nested = ['/w/alpha', '/w/alpha/sub'];
    expect(resolveActiveProjectRoot(nested, '/w/alpha/sub/models/x.sql', undefined)).toBe(
      '/w/alpha/sub',
    );
  });

  it('falls back to the pinned root when the file is outside every project', () => {
    expect(resolveActiveProjectRoot(roots, '/w/other/x.sql', '/w/beta')).toBe('/w/beta');
  });

  it('ignores a pinned root that is no longer discovered', () => {
    expect(resolveActiveProjectRoot(roots, undefined, '/w/gone')).toBe('/w/alpha');
  });

  it('falls back to the first root lexicographically', () => {
    expect(resolveActiveProjectRoot(roots, undefined, undefined)).toBe('/w/alpha');
  });
});
