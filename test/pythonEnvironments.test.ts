import { describe, it, expect } from 'vitest';
import {
  dbtExecutableInEnv,
  describeDbtPath,
  parseCondaEnvironmentsFile,
} from '../src/pythonEnvironments';

describe('dbtExecutableInEnv', () => {
  it('builds the Windows Scripts path', () => {
    expect(dbtExecutableInEnv('C:\\envs\\skai', 'win32')).toBe('C:\\envs\\skai\\Scripts\\dbt.exe');
  });

  it('builds the POSIX bin path', () => {
    expect(dbtExecutableInEnv('/home/x/envs/skai', 'linux')).toBe('/home/x/envs/skai/bin/dbt');
  });
});

describe('parseCondaEnvironmentsFile', () => {
  it('extracts non-empty, non-comment lines', () => {
    const content = 'C:\\Users\\x\\miniconda3\\envs\\skai\n# a comment\n\nC:\\Users\\x\\miniconda3\n';
    expect(parseCondaEnvironmentsFile(content)).toEqual([
      'C:\\Users\\x\\miniconda3\\envs\\skai',
      'C:\\Users\\x\\miniconda3',
    ]);
  });

  it('returns an empty list for empty input', () => {
    expect(parseCondaEnvironmentsFile('')).toEqual([]);
  });
});

describe('describeDbtPath', () => {
  it('labels the default as PATH', () => {
    expect(describeDbtPath('dbt')).toBe('PATH');
    expect(describeDbtPath('')).toBe('PATH');
    expect(describeDbtPath('  DBT  ')).toBe('PATH');
  });

  it('extracts the conda env name from an envs/<name>/... path', () => {
    expect(describeDbtPath('C:\\Users\\x\\miniconda3\\envs\\skai\\Scripts\\dbt.exe')).toBe('skai');
    expect(describeDbtPath('/home/x/miniconda3/envs/skai/bin/dbt')).toBe('skai');
  });

  it('falls back to the env-root folder name for a plain venv', () => {
    expect(describeDbtPath('/home/x/projects/myproj/.venv/bin/dbt')).toBe('.venv');
  });

  it('falls back to the raw command for anything unrecognisable', () => {
    expect(describeDbtPath('uv run dbt')).toBe('uv run dbt');
  });
});
