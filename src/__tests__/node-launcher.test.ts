import { describe, expect, it, vi } from 'vitest';
import {
  MIN_NODE_MAJOR,
  NODE_OVERRIDE_ENV,
  NODE_REEXEC_ENV,
  chooseCompatibleNodeBinary,
  collectCandidateNodePaths,
  compareNodeVersions,
  ensureSupportedNodeRuntime,
  formatUnsupportedNodeMessage,
  parseNodeVersion,
  resolveNodeLaunch,
} from '../runtime/node-launcher.js';

describe('parseNodeVersion', () => {
  it('parses plain and v-prefixed versions', () => {
    expect(parseNodeVersion('20.11.1')).toMatchObject({ major: 20, minor: 11, patch: 1 });
    expect(parseNodeVersion('v18.19.0')).toMatchObject({ major: 18, minor: 19, patch: 0 });
  });

  it('returns null for invalid values', () => {
    expect(parseNodeVersion('')).toBeNull();
    expect(parseNodeVersion('node')).toBeNull();
  });
});

describe('compareNodeVersions', () => {
  it('sorts by major, minor, then patch', () => {
    const left = parseNodeVersion('20.1.0');
    const right = parseNodeVersion('18.19.1');
    const patch = parseNodeVersion('20.1.2');

    expect(left).toBeTruthy();
    expect(right).toBeTruthy();
    expect(patch).toBeTruthy();

    expect(compareNodeVersions(left!, right!)).toBeGreaterThan(0);
    expect(compareNodeVersions(left!, patch!)).toBeLessThan(0);
  });
});

describe('collectCandidateNodePaths', () => {
  it('collects candidates from override, PATH, nvm, and dedupes them', () => {
    const entries = collectCandidateNodePaths({
      env: {
        [NODE_OVERRIDE_ENV]: '/custom/node20',
        PATH: '/usr/bin:/custom/bin:/usr/bin',
      },
      homedir: '/home/tester',
      platform: 'linux',
      existsSync: (target) => target === '/home/tester/.nvm/versions/node',
      readdirSync: () => [
        { name: 'v20.11.1', isDirectory: () => true },
        { name: 'notes.txt', isDirectory: () => false },
        { name: 'v18.19.0', isDirectory: () => true },
      ],
    });

    expect(entries).toContain('/custom/node20');
    expect(entries).toContain('/usr/bin/node');
    expect(entries).toContain('/custom/bin/node');
    expect(entries).toContain('/home/tester/.nvm/versions/node/v20.11.1/bin/node');
    expect(entries).toContain('/home/tester/.nvm/versions/node/v18.19.0/bin/node');
    expect(entries.filter((value) => value === '/usr/bin/node')).toHaveLength(1);
  });
});

describe('chooseCompatibleNodeBinary', () => {
  it('selects the highest compatible version and ignores the current exec path', () => {
    const selected = chooseCompatibleNodeBinary(
      ['/current/node', '/node18', '/node20', '/node16'],
      '/current/node',
      (binaryPath) => {
        if (binaryPath === '/node20') return 'v20.10.0';
        if (binaryPath === '/node18') return 'v18.19.1';
        if (binaryPath === '/node16') return 'v16.13.1';
        return 'v16.13.1';
      },
    );

    expect(selected).toMatchObject({
      path: '/node20',
      version: { major: 20, minor: 10, patch: 0 },
    });
  });
});

describe('formatUnsupportedNodeMessage', () => {
  it('includes actionable guidance', () => {
    const message = formatUnsupportedNodeMessage('16.13.1');
    expect(message).toContain(`Node.js ${MIN_NODE_MAJOR}+ is required`);
    expect(message).toContain(`nvm use ${MIN_NODE_MAJOR}`);
    expect(message).toContain(NODE_OVERRIDE_ENV);
  });
});

describe('resolveNodeLaunch', () => {
  it('continues immediately on supported runtimes', () => {
    expect(
      resolveNodeLaunch('/app/bin.js', {
        currentVersion: '20.11.1',
      }),
    ).toEqual({ action: 'continue' });
  });

  it('returns a reexec plan when a compatible runtime is available', () => {
    const resolution = resolveNodeLaunch('/app/bin.js', {
      currentVersion: '16.13.1',
      execPath: '/usr/bin/node',
      argv: ['/usr/bin/node', '/app/bin.js', '--help'],
      env: {
        PATH: '/usr/bin',
      },
      existsSync: () => false,
      readVersion: (binaryPath) => {
        if (binaryPath === '/usr/bin/node') return 'v16.13.1';
        if (binaryPath === '/opt/homebrew/bin/node') return 'v20.11.1';
        if (binaryPath === '/usr/local/bin/node') return 'v18.19.0';
        return null;
      },
    });

    expect(resolution).toMatchObject({
      action: 'reexec',
      binaryPath: '/opt/homebrew/bin/node',
      args: ['/app/bin.js', '--help'],
      binaryVersion: { major: 20, minor: 11, patch: 1 },
    });
    if (resolution.action === 'reexec') {
      expect(resolution.env[NODE_REEXEC_ENV]).toBe('1');
    }
  });

  it('returns an actionable error when no compatible runtime is found', () => {
    const resolution = resolveNodeLaunch('/app/bin.js', {
      currentVersion: '16.13.1',
      execPath: '/usr/bin/node',
      env: {
        PATH: '/usr/bin',
      },
      existsSync: () => false,
      readVersion: () => 'v16.13.1',
    });

    expect(resolution.action).toBe('error');
    if (resolution.action === 'error') {
      expect(resolution.message).toContain(NODE_OVERRIDE_ENV);
      expect(resolution.message).toContain(`nvm use ${MIN_NODE_MAJOR}`);
    }
  });

  it('fails instead of looping when already relaunched and still unsupported', () => {
    const resolution = resolveNodeLaunch('/app/bin.js', {
      currentVersion: '16.13.1',
      env: {
        [NODE_REEXEC_ENV]: '1',
      },
    });

    expect(resolution.action).toBe('error');
    if (resolution.action === 'error') {
      expect(resolution.message).toContain('still using an unsupported Node version');
    }
  });
});

describe('ensureSupportedNodeRuntime', () => {
  it('spawns the compatible runtime and exits with the child status', async () => {
    const spawnSyncFn = vi.fn(() => ({ status: 0 }));
    const exit = vi.fn();

    await ensureSupportedNodeRuntime('file:///app/bin.js', {
      currentVersion: '16.13.1',
      execPath: '/usr/bin/node',
      argv: ['/usr/bin/node', '/app/bin.js', '--version'],
      env: { PATH: '/usr/bin' },
      existsSync: () => false,
      readVersion: (binaryPath) => (binaryPath === '/opt/homebrew/bin/node' ? 'v20.11.1' : null),
      spawnSyncFn: spawnSyncFn as any,
      stdoutIsTTY: true,
      stderrIsTTY: true,
      exit,
    });

    expect(spawnSyncFn).toHaveBeenCalledWith(
      '/opt/homebrew/bin/node',
      ['/app/bin.js', '--version'],
      {
        stdio: ['inherit', 'inherit', 'inherit'],
        env: expect.objectContaining({
          PATH: '/usr/bin',
          [NODE_REEXEC_ENV]: '1',
        }),
      },
    );
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('forwards child output when relaunched under piped stdout and stderr', async () => {
    const exit = vi.fn();
    const writeStdout = vi.fn();
    const writeStderr = vi.fn();

    await ensureSupportedNodeRuntime('file:///app/bin.js', {
      currentVersion: '16.13.1',
      execPath: '/usr/bin/node',
      argv: ['/usr/bin/node', '/app/bin.js', 'ask', '--help'],
      env: { PATH: '/usr/bin' },
      existsSync: () => false,
      readVersion: (binaryPath) => (binaryPath === '/opt/homebrew/bin/node' ? 'v20.11.1' : null),
      spawnSyncFn: vi.fn(() => ({
        status: 0,
        stdout: 'hello\n',
        stderr: 'warn\n',
      })) as any,
      stdoutIsTTY: false,
      stderrIsTTY: false,
      writeStdout,
      writeStderr,
      exit,
    });

    expect(writeStdout).toHaveBeenCalledWith('hello\n');
    expect(writeStderr).toHaveBeenCalledWith('warn\n');
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('logs guidance and exits when relaunch fails', async () => {
    const logError = vi.fn();
    const exit = vi.fn();

    await ensureSupportedNodeRuntime('file:///app/bin.js', {
      currentVersion: '16.13.1',
      execPath: '/usr/bin/node',
      argv: ['/usr/bin/node', '/app/bin.js'],
      env: { PATH: '/usr/bin' },
      existsSync: () => false,
      readVersion: (binaryPath) => (binaryPath === '/opt/homebrew/bin/node' ? 'v20.11.1' : null),
      spawnSyncFn: vi.fn(() => ({ error: new Error('boom'), status: null })) as any,
      stdoutIsTTY: true,
      stderrIsTTY: true,
      logError,
      exit,
    });

    expect(logError).toHaveBeenCalledWith(expect.stringContaining('Failed to relaunch'));
    expect(exit).toHaveBeenCalledWith(1);
  });
});
