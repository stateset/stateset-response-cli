import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildResetPlan, resolveResetScopes, runResetCommand } from '../cli/commands-reset.js';

function createStatePaths() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-reset-test-'));
  const stateDir = path.join(root, '.stateset');
  const sessionsDir = path.join(stateDir, 'sessions');
  const configPath = path.join(stateDir, 'config.json');

  fs.mkdirSync(sessionsDir, { recursive: true });
  return { root, stateDir, sessionsDir, configPath };
}

const cleanupDirs = new Set<string>();

afterEach(() => {
  for (const dir of cleanupDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  cleanupDirs.clear();
});

describe('commands-reset', () => {
  it('normalizes aliases and expands all scopes', () => {
    expect(resolveResetScopes(['auth', 'telemetry'])).toEqual(['config', 'history']);
    expect(resolveResetScopes(['all'])).toEqual([
      'config',
      'sessions',
      'metrics',
      'events',
      'history',
      'permissions',
      'integrations',
    ]);
  });

  it('builds a reset plan for existing CLI state', () => {
    const paths = createStatePaths();
    cleanupDirs.add(paths.root);

    fs.writeFileSync(paths.configPath, '{"currentOrg":"acme"}');
    fs.writeFileSync(path.join(paths.stateDir, 'prompt-history.jsonl'), 'prompt\n');
    fs.writeFileSync(path.join(paths.stateDir, 'integration-telemetry.jsonl'), 'telemetry\n');
    fs.mkdirSync(path.join(paths.sessionsDir, 'ops'), { recursive: true });
    fs.writeFileSync(path.join(paths.sessionsDir, 'ops', 'context.jsonl'), '[]\n');

    const plan = buildResetPlan(['config', 'sessions', 'history'], {
      getConfigPathFn: () => paths.configPath,
      getSessionsDirFn: () => paths.sessionsDir,
      getStateSetDirFn: () => paths.stateDir,
    });

    expect(plan.targets.filter((target) => target.exists)).toHaveLength(4);
    expect(plan.bytesToRemove).toBeGreaterThan(0);
  });

  it('prints a preview without deleting anything when --yes is omitted', async () => {
    const paths = createStatePaths();
    cleanupDirs.add(paths.root);

    fs.mkdirSync(path.join(paths.sessionsDir, 'preview'), { recursive: true });
    fs.writeFileSync(path.join(paths.sessionsDir, 'preview', 'context.jsonl'), '[]\n');

    const logs: string[] = [];
    const exitCode = await runResetCommand(
      ['sessions'],
      {},
      {
        getConfigPathFn: () => paths.configPath,
        getSessionsDirFn: () => paths.sessionsDir,
        getStateSetDirFn: () => paths.stateDir,
        log: (message) => logs.push(message),
      },
    );

    expect(exitCode).toBe(0);
    expect(logs.join('\n')).toContain('Preview only');
    expect(fs.existsSync(paths.sessionsDir)).toBe(true);
  });

  it('removes only the requested state scopes when confirmed', async () => {
    const paths = createStatePaths();
    cleanupDirs.add(paths.root);

    fs.writeFileSync(paths.configPath, '{"currentOrg":"acme"}');
    fs.mkdirSync(path.join(paths.sessionsDir, 'ops'), { recursive: true });
    fs.writeFileSync(path.join(paths.sessionsDir, 'ops', 'context.jsonl'), '[]\n');
    fs.writeFileSync(path.join(paths.stateDir, 'prompt-history.jsonl'), 'prompt\n');
    fs.mkdirSync(path.join(paths.stateDir, 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(paths.stateDir, 'prompts', 'keep.txt'), 'keep\n');

    const exitCode = await runResetCommand(
      ['sessions', 'history'],
      { yes: true },
      {
        getConfigPathFn: () => paths.configPath,
        getSessionsDirFn: () => paths.sessionsDir,
        getStateSetDirFn: () => paths.stateDir,
      },
    );

    expect(exitCode).toBe(0);
    expect(fs.existsSync(paths.sessionsDir)).toBe(false);
    expect(fs.existsSync(path.join(paths.stateDir, 'prompt-history.jsonl'))).toBe(false);
    expect(fs.existsSync(paths.configPath)).toBe(true);
    expect(fs.existsSync(path.join(paths.stateDir, 'prompts', 'keep.txt'))).toBe(true);
  });
});
