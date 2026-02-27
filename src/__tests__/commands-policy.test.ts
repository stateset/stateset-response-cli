import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChatContext } from '../cli/types.js';

const {
  mockWriteFileSync,
  mockReadPolicyOverridesDetailed,
  mockReadPolicyFile,
  mockWritePolicyOverrides,
} = vi.hoisted(() => ({
  mockWriteFileSync: vi.fn(),
  mockReadPolicyOverridesDetailed: vi.fn((_cwd?: string) => ({
    localPath: '/tmp/project/.stateset/policies.json',
    globalPath: '/tmp/stateset/policies.json',
    local: { toolHooks: { 'local-hook': 'allow' } as Record<string, string> },
    global: { toolHooks: { 'global-hook': 'deny' } as Record<string, string> },
    merged: {
      toolHooks: { 'global-hook': 'deny', 'local-hook': 'allow' } as Record<string, string>,
    },
  })),
  mockReadPolicyFile: vi.fn((_path?: string) => ({
    toolHooks: { 'imported-hook': 'allow' } as Record<string, string>,
  })),
  mockWritePolicyOverrides: vi.fn((_cwd?: string, _data?: Record<string, unknown>) => {}),
}));

const mockLoadExtensions = vi.fn();

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    default: {
      ...actual,
      writeFileSync: mockWriteFileSync,
      existsSync: vi.fn(() => false),
      lstatSync: vi.fn(() => ({
        isDirectory: () => false,
        isSymbolicLink: () => false,
      })),
      realpathSync: vi.fn((p: string) => p),
    },
  };
});

vi.mock('../session.js', () => ({
  getStateSetDir: vi.fn(() => '/tmp/stateset'),
}));

vi.mock('../cli/permissions.js', () => ({
  readPolicyOverridesDetailed: (cwd: string) => mockReadPolicyOverridesDetailed(cwd),
  writePolicyOverrides: (cwd: string, data: Record<string, unknown>) =>
    mockWritePolicyOverrides(cwd, data),
  readPolicyFile: (path: string) => mockReadPolicyFile(path),
  writePermissionStore: vi.fn(),
  readPermissionStore: vi.fn(() => ({ toolHooks: {} })),
  getPolicyOverridesPath: vi.fn((cwd: string) => `${cwd}/.stateset/policies.json`),
  parsePolicyFile: vi.fn((_filePath: string) => ({ toolHooks: {} })),
}));

import { handlePolicyCommand } from '../cli/commands-policy.js';

function createMockCtx(overrides: Partial<ChatContext> = {}): ChatContext {
  return {
    rl: { prompt: vi.fn(), pause: vi.fn(), resume: vi.fn() } as any,
    sessionId: 'test-session',
    cwd: '/tmp/test',
    permissionStore: { toolHooks: {} },
    extensions: {
      load: async () => {
        mockLoadExtensions();
      },
    } as any,
    ...overrides,
  } as unknown as ChatContext;
}

describe('handlePolicyCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFileSync.mockClear();
    mockReadPolicyOverridesDetailed.mockReturnValue({
      localPath: '/tmp/project/.stateset/policies.json',
      globalPath: '/tmp/stateset/policies.json',
      local: { toolHooks: { 'local-hook': 'allow' } },
      global: { toolHooks: { 'global-hook': 'deny' } },
      merged: { toolHooks: { 'global-hook': 'deny', 'local-hook': 'allow' } },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockLoadExtensions.mockReset();
  });

  it('returns false for non-policy commands', async () => {
    const ctx = createMockCtx();
    expect(await handlePolicyCommand('/help', ctx)).toEqual({ handled: false });
    expect(await handlePolicyCommand('/apply on', ctx)).toEqual({ handled: false });
  });

  it('does not match partial policy prefixes', async () => {
    const ctx = createMockCtx();
    expect(await handlePolicyCommand('/permissionsx', ctx)).toEqual({ handled: false });
    expect(await handlePolicyCommand('/policyx', ctx)).toEqual({ handled: false });
  });

  it('rejects /policy export to an unsafe path by default', async () => {
    const ctx = createMockCtx({ cwd: '/tmp/project' });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const outPath = '/tmp/unsafe-policy-export.json';

    const result = await handlePolicyCommand(`/policy export out=${outPath}`, ctx);

    expect(result).toEqual({ handled: true });
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(
      consoleSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('must be within'),
      ),
    ).toBe(true);
  });

  it('allows /policy export with --unsafe-path', async () => {
    const ctx = createMockCtx({ cwd: '/tmp/project' });
    const outPath = '/tmp/unsafe-policy-export.json';

    const result = await handlePolicyCommand(`/policy export out=${outPath} --unsafe-path`, ctx);

    expect(result).toEqual({ handled: true });
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    expect(mockWriteFileSync.mock.calls[0][0]).toBe(outPath);
    const payload = JSON.parse(String(mockWriteFileSync.mock.calls[0][1]));
    expect(payload).toEqual(mockReadPolicyOverridesDetailed().merged);
    expect(mockWriteFileSync.mock.calls[0][2]).toBe('utf-8');
  });

  it('/policy import handles merge mode through command handler', async () => {
    const ctx = createMockCtx({ cwd: '/tmp/project' });
    mockReadPolicyFile.mockReturnValue({
      toolHooks: { imported: 'allow' } as Record<string, string>,
    });

    const result = await handlePolicyCommand('/policy import /tmp/policy-import.json', ctx);

    expect(result).toEqual({ handled: true });
    expect(mockWritePolicyOverrides).toHaveBeenCalled();
    expect(mockLoadExtensions).toHaveBeenCalled();
    expect(mockWritePolicyOverrides.mock.calls[0][0]).toBe('/tmp/project');
    expect(mockWritePolicyOverrides.mock.calls[0][1]).toEqual({
      toolHooks: { 'local-hook': 'allow', imported: 'allow' },
    });
  });

  it('/policy import supports replace mode through command handler', async () => {
    const ctx = createMockCtx({ cwd: '/tmp/project' });
    mockReadPolicyFile.mockReturnValue({
      toolHooks: { replaced: 'deny' } as Record<string, string>,
    });

    const result = await handlePolicyCommand('/policy import /tmp/policy-import.json replace', ctx);

    expect(result).toEqual({ handled: true });
    expect(mockWritePolicyOverrides).toHaveBeenCalled();
    expect(mockWritePolicyOverrides.mock.calls[0][1]).toEqual({
      toolHooks: { replaced: 'deny' },
    });
  });

  it('/policy import without a file path shows usage and does not import', async () => {
    const ctx = createMockCtx({ cwd: '/tmp/project' });
    const result = await handlePolicyCommand('/policy import', ctx);

    expect(result).toEqual({ handled: true });
    expect(mockWritePolicyOverrides).not.toHaveBeenCalled();
  });

  it('/permissions list shows empty when no permissions stored', async () => {
    const ctx = createMockCtx();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handlePolicyCommand('/permissions', ctx);

    expect(result).toEqual({ handled: true });
    expect(
      consoleSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('No stored permissions'),
      ),
    ).toBe(true);
  });

  it('/permissions list shows stored permissions', async () => {
    const ctx = createMockCtx({
      permissionStore: { toolHooks: { 'myHook::myTool': 'allow' as const } },
    });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handlePolicyCommand('/permissions list', ctx);

    expect(result).toEqual({ handled: true });
    expect(
      consoleSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('Stored permissions'),
      ),
    ).toBe(true);
  });

  it('/permissions with invalid action shows usage', async () => {
    const ctx = createMockCtx();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handlePolicyCommand('/permissions bogus', ctx);

    expect(result).toEqual({ handled: true });
    expect(
      consoleSpy.mock.calls.some(([line]) => typeof line === 'string' && line.includes('Usage')),
    ).toBe(true);
  });

  it('/policy list shows merged overrides', async () => {
    const ctx = createMockCtx();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handlePolicyCommand('/policy list', ctx);

    expect(result).toEqual({ handled: true });
    expect(
      consoleSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('Policy overrides'),
      ),
    ).toBe(true);
  });

  it('/policy with no action shows overrides', async () => {
    const ctx = createMockCtx();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handlePolicyCommand('/policy', ctx);

    expect(result).toEqual({ handled: true });
    expect(mockReadPolicyOverridesDetailed).toHaveBeenCalled();
  });

  it('/policy set adds a policy override', async () => {
    const ctx = createMockCtx({ cwd: '/tmp/project' });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handlePolicyCommand('/policy set my-hook allow', ctx);

    expect(result).toEqual({ handled: true });
    expect(mockWritePolicyOverrides).toHaveBeenCalled();
    expect(mockLoadExtensions).toHaveBeenCalled();
    expect(
      consoleSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('Policy set'),
      ),
    ).toBe(true);
  });

  it('/policy set with missing decision shows usage', async () => {
    const ctx = createMockCtx();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handlePolicyCommand('/policy set my-hook', ctx);

    expect(result).toEqual({ handled: true });
    expect(
      consoleSpy.mock.calls.some(([line]) => typeof line === 'string' && line.includes('Usage')),
    ).toBe(true);
    expect(mockWritePolicyOverrides).not.toHaveBeenCalled();
  });

  it('/policy unset removes a policy override', async () => {
    const ctx = createMockCtx({ cwd: '/tmp/project' });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handlePolicyCommand('/policy unset local-hook', ctx);

    expect(result).toEqual({ handled: true });
    expect(mockWritePolicyOverrides).toHaveBeenCalled();
    expect(
      consoleSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('Policy removed'),
      ),
    ).toBe(true);
  });

  it('/policy unset with missing hook shows usage', async () => {
    const ctx = createMockCtx();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handlePolicyCommand('/policy unset', ctx);

    expect(result).toEqual({ handled: true });
    expect(
      consoleSpy.mock.calls.some(([line]) => typeof line === 'string' && line.includes('Usage')),
    ).toBe(true);
  });

  it('/policy unset with non-existent hook shows warning', async () => {
    const ctx = createMockCtx({ cwd: '/tmp/project' });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handlePolicyCommand('/policy unset nonexistent', ctx);

    expect(result).toEqual({ handled: true });
    expect(
      consoleSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('No policy set'),
      ),
    ).toBe(true);
  });

  it('/policy edit shows file location', async () => {
    const ctx = createMockCtx({ cwd: '/tmp/project' });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handlePolicyCommand('/policy edit', ctx);

    expect(result).toEqual({ handled: true });
    expect(
      consoleSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('Policy file location'),
      ),
    ).toBe(true);
  });

  it('/policy init creates a starter file', async () => {
    const ctx = createMockCtx({ cwd: '/tmp/project' });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handlePolicyCommand('/policy init', ctx);

    expect(result).toEqual({ handled: true });
    expect(mockWriteFileSync).toHaveBeenCalled();
    expect(
      consoleSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('Created policy file'),
      ),
    ).toBe(true);
  });

  it('/policy export without out= uses default path', async () => {
    const ctx = createMockCtx({ cwd: '/tmp/project' });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handlePolicyCommand('/policy export', ctx);

    expect(result).toEqual({ handled: true });
    expect(mockWriteFileSync).toHaveBeenCalled();
    expect(
      consoleSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('exported to'),
      ),
    ).toBe(true);
  });

  it('/policy with unknown action shows usage', async () => {
    const ctx = createMockCtx();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handlePolicyCommand('/policy bogus', ctx);

    expect(result).toEqual({ handled: true });
    expect(
      consoleSpy.mock.calls.some(([line]) => typeof line === 'string' && line.includes('Usage')),
    ).toBe(true);
  });
});
