import { describe, expect, it, vi } from 'vitest';
import {
  buildPackageUpdateCommand,
  detectInstallContext,
  detectPackageManager,
  runUpdateCommand,
  runUpdateStatusCommand,
} from '../cli/commands-update.js';
import type { UpdateStatus } from '../utils/update-check.js';

function createUpdateStatus(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    currentVersion: '1.9.3',
    latestVersion: '2.0.0',
    updateAvailable: true,
    source: 'network',
    instruction: 'npm i -g stateset-response-cli@latest',
    ...overrides,
  };
}

describe('commands-update', () => {
  it('detects a source checkout from git metadata', () => {
    const context = detectInstallContext(
      '/mock/response',
      (candidate) => candidate === '/mock/response/.git',
    );

    expect(context).toEqual({
      kind: 'source',
      packageRoot: '/mock/response',
    });
  });

  it('detects a packaged install when source markers are absent', () => {
    const context = detectInstallContext('/mock/response', () => false);

    expect(context).toEqual({
      kind: 'package',
      packageRoot: '/mock/response',
    });
  });

  it('prefers npm_config_user_agent when detecting a package manager', () => {
    const packageManager = detectPackageManager(
      { npm_config_user_agent: 'pnpm/9.0.0 node/v20.0.0' } as NodeJS.ProcessEnv,
      vi.fn(),
    );

    expect(packageManager).toBe('pnpm');
  });

  it('falls back to probing known package managers', () => {
    const spawnSyncFn = vi.fn((command: string) => ({
      status: command === 'bun' ? 0 : 1,
    }));

    const packageManager = detectPackageManager({} as NodeJS.ProcessEnv, spawnSyncFn as any);

    expect(packageManager).toBe('bun');
    expect(spawnSyncFn).toHaveBeenCalledTimes(3);
  });

  it('builds package-manager specific update commands', () => {
    expect(buildPackageUpdateCommand('npm')).toMatchObject({
      command: 'npm',
      args: ['install', '-g', 'stateset-response-cli@latest'],
    });
    expect(buildPackageUpdateCommand('pnpm').display).toBe(
      'pnpm add -g stateset-response-cli@latest',
    );
    expect(buildPackageUpdateCommand('bun').display).toBe(
      'bun add -g stateset-response-cli@latest',
    );
  });

  it('prints structured JSON for update status', async () => {
    const logs: string[] = [];

    const exitCode = await runUpdateStatusCommand(
      '1.9.3',
      { json: true },
      {
        env: { npm_config_user_agent: 'npm/10.0.0 node/v20.0.0' } as NodeJS.ProcessEnv,
        existsSync: () => false,
        log: (message) => logs.push(message),
        resolveUpdateStatus: async () => createUpdateStatus(),
      },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(logs[0] ?? '')).toMatchObject({
      currentVersion: '1.9.3',
      latestVersion: '2.0.0',
      installKind: 'package',
      packageManager: 'npm',
      source: 'network',
    });
  });

  it('prints a dry-run package update plan without executing it', async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const spawnSyncFn = vi.fn();

    const exitCode = await runUpdateCommand(
      '1.9.3',
      { dryRun: true },
      {
        env: { npm_config_user_agent: 'pnpm/9.0.0 node/v20.0.0' } as NodeJS.ProcessEnv,
        existsSync: () => false,
        spawnSyncFn: spawnSyncFn as any,
        log: (message) => logs.push(message),
        error: (message) => errors.push(message),
        resolveUpdateStatus: async () => createUpdateStatus(),
      },
    );

    expect(exitCode).toBe(0);
    expect(logs.join('\n')).toContain('Planned command: pnpm add -g stateset-response-cli@latest');
    expect(logs.join('\n')).toContain('Dry run only');
    expect(errors).toEqual([]);
    expect(spawnSyncFn).not.toHaveBeenCalled();
  });

  it('blocks automatic source updates when the working tree is dirty', async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const spawnSyncFn = vi.fn((command: string, args: string[]) => {
      if (command === 'git' && args[0] === 'status') {
        return { status: 0, stdout: ' M src/cli.ts\n' };
      }
      return { status: 0, stdout: '' };
    });

    const exitCode = await runUpdateCommand(
      '1.9.3',
      { yes: true },
      {
        existsSync: (candidate) =>
          candidate === '/home/dom/stateset-response-cli/.git' ||
          candidate === '/home/dom/stateset-response-cli/src' ||
          candidate === '/home/dom/stateset-response-cli/package.json',
        spawnSyncFn: spawnSyncFn as any,
        log: (message) => logs.push(message),
        error: (message) => errors.push(message),
        resolveUpdateStatus: async () => createUpdateStatus(),
      },
    );

    expect(exitCode).toBe(1);
    expect(logs.join('\n')).toContain('Working tree: dirty');
    expect(errors.join('\n')).toContain('Automatic update is blocked');
    expect(spawnSyncFn).toHaveBeenCalledTimes(1);
  });

  it('runs the source update steps when the checkout is clean', async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const spawnSyncFn = vi.fn((command: string, args: string[]) => {
      if (command === 'git' && args[0] === 'status') {
        return { status: 0, stdout: '' };
      }
      return { status: 0, stdout: '' };
    });

    const exitCode = await runUpdateCommand(
      '1.9.3',
      { yes: true },
      {
        existsSync: (candidate) =>
          candidate === '/home/dom/stateset-response-cli/.git' ||
          candidate === '/home/dom/stateset-response-cli/src' ||
          candidate === '/home/dom/stateset-response-cli/package.json',
        spawnSyncFn: spawnSyncFn as any,
        log: (message) => logs.push(message),
        error: (message) => errors.push(message),
        resolveUpdateStatus: async () => createUpdateStatus(),
      },
    );

    expect(exitCode).toBe(0);
    expect(spawnSyncFn.mock.calls).toEqual([
      [
        'git',
        ['status', '--porcelain'],
        expect.objectContaining({
          cwd: '/home/dom/stateset-response-cli',
          encoding: 'utf8',
        }),
      ],
      [
        'git',
        ['pull', '--rebase'],
        expect.objectContaining({
          cwd: '/home/dom/stateset-response-cli',
          stdio: 'inherit',
        }),
      ],
      [
        'npm',
        ['ci'],
        expect.objectContaining({
          cwd: '/home/dom/stateset-response-cli',
          stdio: 'inherit',
        }),
      ],
      [
        'npm',
        ['run', 'build'],
        expect.objectContaining({
          cwd: '/home/dom/stateset-response-cli',
          stdio: 'inherit',
        }),
      ],
    ]);
    expect(logs.join('\n')).toContain('Source checkout updated.');
    expect(errors).toEqual([]);
  });
});
