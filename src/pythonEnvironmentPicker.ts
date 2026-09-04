import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import {
  dbtExecutableInEnv,
  describeDbtPath,
  parseCondaEnvironmentsFile,
} from './pythonEnvironments';

interface EnvCandidate {
  label: string;
  dbtPath: string;
  kind: 'conda' | 'venv';
}

/**
 * Discover conda env roots without needing `conda` itself on PATH: conda
 * maintains `~/.conda/environments.txt`, one absolute env root per line,
 * updated on every `conda create` / `conda env create`. We also try invoking
 * `conda env list --json` as a bonus, best-effort — it often isn't reachable
 * from the Extension Host, which is the whole reason this file exists.
 */
async function condaEnvRoots(): Promise<string[]> {
  const roots = new Set<string>();

  try {
    const registryPath = path.join(os.homedir(), '.conda', 'environments.txt');
    const content = await fs.promises.readFile(registryPath, 'utf8');
    for (const root of parseCondaEnvironmentsFile(content)) {
      roots.add(root);
    }
  } catch {
    // No conda registry — fine, conda may just not be installed.
  }

  try {
    const parsed = (await runJson('conda', ['env', 'list', '--json'])) as { envs?: string[] };
    for (const root of parsed.envs ?? []) {
      roots.add(root);
    }
  } catch {
    // conda not resolvable from here — expected in many setups.
  }

  return [...roots];
}

function runJson(command: string, args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args);
    } catch (err) {
      reject(err);
      return;
    }
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function findDbtCandidates(workspaceRoots: readonly string[]): Promise<EnvCandidate[]> {
  const candidates: EnvCandidate[] = [];
  const seen = new Set<string>();

  const consider = (envRoot: string, kind: EnvCandidate['kind']): void => {
    const dbtPath = dbtExecutableInEnv(envRoot, process.platform);
    if (seen.has(dbtPath) || !fs.existsSync(dbtPath)) {
      return;
    }
    seen.add(dbtPath);
    candidates.push({ label: describeDbtPath(dbtPath), dbtPath, kind });
  };

  for (const root of await condaEnvRoots()) {
    consider(root, 'conda');
  }
  for (const wsRoot of workspaceRoots) {
    for (const name of ['.venv', 'venv', 'env']) {
      consider(path.join(wsRoot, name), 'venv');
    }
  }

  return candidates.sort((a, b) => a.label.localeCompare(b.label));
}

type PickItem =
  | (vscode.QuickPickItem & { action: 'use'; dbtPath: string })
  | (vscode.QuickPickItem & { action: 'manual' })
  | (vscode.QuickPickItem & { action: 'reset' });

/**
 * Show a QuickPick of discovered dbt-capable Python environments (conda envs
 * via `~/.conda/environments.txt`, workspace `.venv`/`venv`/`env` folders),
 * plus manual entry and reset-to-PATH. Writes the pick to the one existing
 * `dbtBooster.dbtPath` setting — this is a picker for that setting, not a new
 * one.
 */
export async function pickPythonEnvironment(workspaceRoots: readonly string[]): Promise<void> {
  const config = vscode.workspace.getConfiguration('dbtBooster');
  const current = config.get<string>('dbtPath', 'dbt') || 'dbt';

  const candidates = await findDbtCandidates(workspaceRoots);

  const items: PickItem[] = [
    ...candidates.map(
      (c): PickItem => ({
        label: `$(${c.kind === 'conda' ? 'circuit-board' : 'symbol-namespace'}) ${c.label}`,
        description: c.dbtPath,
        picked: c.dbtPath === current,
        action: 'use',
        dbtPath: c.dbtPath,
      }),
    ),
    {
      label: '$(edit) Enter Path Manually…',
      description: 'Type the full path to a dbt executable',
      action: 'manual',
    },
    {
      label: '$(discard) Use dbt from PATH',
      description: 'Reset to the default "dbt"',
      action: 'reset',
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: 'dbt booster: Select Python Environment',
    placeHolder: `Currently: ${current === 'dbt' ? 'dbt (PATH)' : current}`,
  });
  if (!picked) {
    return;
  }

  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;

  if (picked.action === 'reset') {
    await config.update('dbtPath', undefined, target);
    return;
  }
  if (picked.action === 'manual') {
    const entered = await vscode.window.showInputBox({
      title: 'dbt executable path',
      value: current,
      placeHolder: 'e.g. C:\\Users\\you\\miniconda3\\envs\\skai\\Scripts\\dbt.exe',
    });
    if (entered) {
      await config.update('dbtPath', entered, target);
    }
    return;
  }
  await config.update('dbtPath', picked.dbtPath, target);
}
