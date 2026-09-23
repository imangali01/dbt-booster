import { describe, it, expect } from 'vitest';
import { describeArgs, showArgs, splitCommand, terminalArgs } from '../src/dbtArgs';

describe('splitCommand', () => {
  it('splits a bare command into a program and no args', () => {
    expect(splitCommand('dbt')).toEqual(['dbt', []]);
  });

  it('keeps leading args of a wrapper command', () => {
    expect(splitCommand('uv run dbt')).toEqual(['uv', ['run', 'dbt']]);
  });

  it('ignores surrounding and repeated whitespace', () => {
    expect(splitCommand('  uv   run  dbt  ')).toEqual(['uv', ['run', 'dbt']]);
  });

  it('keeps an absolute path as the program', () => {
    expect(splitCommand('C:\envs\jaffle\Scripts\dbt.exe')).toEqual([
      'C:\envs\jaffle\Scripts\dbt.exe',
      [],
    ]);
  });

  it('falls back to dbt for an empty command', () => {
    expect(splitCommand('   ')).toEqual(['dbt', []]);
  });
});

describe('describeArgs', () => {
  it('joins plain args with spaces', () => {
    expect(describeArgs(['show', '--select', 'orders'])).toBe('show --select orders');
  });

  it('quotes an arg containing whitespace', () => {
    expect(describeArgs(['show', '--inline', 'select 1'])).toBe('show --inline "select 1"');
  });

  it('collapses newlines inside an arg so a log line stays one line', () => {
    expect(describeArgs(['--inline', 'select 1\nfrom t'])).toBe('--inline "select 1 from t"');
  });

  it('truncates an over-long arg, quoting only what actually has spaces', () => {
    expect(describeArgs(['--inline', 'a'.repeat(20)], 10)).toBe('--inline aaaaaaaaaa…');
  });

  it('leaves an arg of exactly the maximum length alone', () => {
    expect(describeArgs(['--inline', 'a'.repeat(10)], 10)).toBe('--inline aaaaaaaaaa');
  });

  it('returns an empty string for no args', () => {
    expect(describeArgs([])).toBe('');
  });
});

describe('showArgs', () => {
  it('puts the speed flags before the subcommand and asks for JSON', () => {
    expect(showArgs(['--select', 'orders'], 20)).toEqual([
      '--no-send-anonymous-usage-stats',
      '--no-populate-cache',
      '--no-write-json',
      'show',
      '--select',
      'orders',
      '--limit',
      '20',
      '--output',
      'json',
    ]);
  });

  it('keeps an inline SQL payload as one argument', () => {
    const args = showArgs(['--inline', 'select 1\nfrom x'], 5);
    expect(args.slice(3, 6)).toEqual(['show', '--inline', 'select 1\nfrom x']);
  });
});

describe('terminalArgs', () => {
  it('turns off usage tracking and leaves everything else alone', () => {
    expect(terminalArgs(['run', '--select', '+orders'])).toEqual([
      '--no-send-anonymous-usage-stats',
      'run',
      '--select',
      '+orders',
    ]);
  });

  it('does not add the preview-only flags', () => {
    expect(terminalArgs(['build'])).not.toContain('--no-populate-cache');
    expect(terminalArgs(['build'])).not.toContain('--no-write-json');
  });
});
