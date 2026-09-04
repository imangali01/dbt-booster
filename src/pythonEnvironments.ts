import * as path from 'path';

/** Absolute path to the `dbt` executable inside a venv/conda env root, per platform. */
export function dbtExecutableInEnv(envRoot: string, platform: NodeJS.Platform): string {
  return platform === 'win32'
    ? path.win32.join(envRoot, 'Scripts', 'dbt.exe')
    : path.posix.join(envRoot, 'bin', 'dbt');
}

/**
 * Parse conda's own `~/.conda/environments.txt` registry: one absolute env root
 * path per line, maintained automatically by every `conda create` / `conda env
 * create`. Reading it needs no `conda` on PATH and no process spawn.
 */
export function parseCondaEnvironmentsFile(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/**
 * Short, human label for a `dbtBooster.dbtPath` value, for the status bar and
 * the environment picker. Recognises the `envs/<name>/...` shape conda env
 * roots have, and otherwise falls back to the env-root folder name or the raw
 * command.
 */
export function describeDbtPath(dbtPath: string): string {
  const trimmed = dbtPath.trim();
  if (!trimmed || trimmed.toLowerCase() === 'dbt') {
    return 'PATH';
  }
  const parts = trimmed.replace(/\\/g, '/').split('/').filter(Boolean);
  const envsIndex = parts.lastIndexOf('envs');
  if (envsIndex >= 0 && envsIndex + 1 < parts.length) {
    return parts[envsIndex + 1];
  }
  // .../<envName>/Scripts/dbt.exe or .../<envName>/bin/dbt -> <envName>
  const envDirIndex = parts.length - 3;
  if (envDirIndex >= 0) {
    return parts[envDirIndex];
  }
  return trimmed;
}
