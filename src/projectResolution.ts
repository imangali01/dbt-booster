/** Path helpers and active-project resolution. Pure — no `vscode` imports. */

function normalise(p: string, caseInsensitive: boolean): string {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return caseInsensitive ? s.toLowerCase() : s;
}

/** True when `file` is `root` itself or sits anywhere beneath it. */
export function isPathWithin(root: string, file: string, caseInsensitive = false): boolean {
  const r = normalise(root, caseInsensitive);
  const f = normalise(file, caseInsensitive);
  return f === r || f.startsWith(r + '/');
}

/**
 * Pick the active dbt project root.
 *
 * Preference order:
 *  1. the deepest discovered root that contains the active file
 *  2. the pinned root, if it is still among the discovered roots
 *  3. the first discovered root (lexicographic) as a stable fallback
 */
export function resolveActiveProjectRoot(
  projectRoots: readonly string[],
  activeFilePath: string | undefined,
  pinnedRoot: string | undefined,
  caseInsensitive = false,
): string | undefined {
  if (projectRoots.length === 0) {
    return undefined;
  }
  if (activeFilePath) {
    const containing = projectRoots
      .filter((root) => isPathWithin(root, activeFilePath, caseInsensitive))
      .sort((a, b) => b.length - a.length);
    if (containing.length > 0) {
      return containing[0];
    }
  }
  if (pinnedRoot && projectRoots.includes(pinnedRoot)) {
    return pinnedRoot;
  }
  return [...projectRoots].sort()[0];
}
