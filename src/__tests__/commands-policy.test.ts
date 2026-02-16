import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handlePolicyCommand } from '../cli/commands-policy.js';
import type { ChatContext } from '../cli/types.js';

const mockWriteFileSync = vi.fn();
const mockReadPolicyOverridesDetailed = vi.fn(() => ({
  localPath: '/tmp/project/.stateset/policies.json',
  globalPath: '/tmp/stateset/policies.json',
  local: { toolHooks: { 'local-hook': 'allow' } },
  global: { toolHooks: { 'global-hook': 'deny' } },
  merged: { toolHooks: { 'global-hook': 'deny', 'local-hook': 'allow' } },
}));
const mockReadPolicyFile = vi.fn(() => ({ toolHooks: { 'imported-hook': 'allow' } }));
const mockWritePolicyOverrides = vi.fn();
const mockLoadExtensions = vi.fn();

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    default: {
      ...actual,
      writeFileSync: mockWriteFileSync,
      existsSync: vi.fn(() => false),
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
  parsePolicyFile: vi.fn((filePath: string) => ({ toolHooks: {} })),
}));

function createMockCtx(overrides: Partial<ChatContext> = {}): ChatContext {
  return {
    rl: { prompt: () => {} } as any,
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
    mockReadPolicyFile.mockReturnValue({ toolHooks: { imported: 'allow' } });

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
    mockReadPolicyFile.mockReturnValue({ toolHooks: { replaced: 'deny' } });

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
});
