import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { handleExportCommand } from '../cli/commands-export.js';
import type { ChatContext } from '../cli/types.js';

const mockEntries = [{ role: 'user' as const, content: 'hello', ts: '2025-01-01T00:00:00Z' }];
const mockReadSessionEntries = vi.fn(() => [...mockEntries]);
const mockExportSessionToMarkdown = vi.fn(() => '# Session Export');
const mockGetSessionExportPath = vi.fn((sessionId: string) => `/tmp/sessions/${sessionId}/exports`);
const mockWriteFileSync = vi.fn();

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    default: {
      ...actual,
      writeFileSync: mockWriteFileSync,
    },
  };
});

vi.mock('../session.js', () => ({
  sanitizeSessionId: vi.fn((id: string) => id),
  getStateSetDir: vi.fn(() => '/tmp/stateset'),
}));

vi.mock('../utils/session-exports.js', () => ({
  getSessionExportPath: (sessionId: string) => mockGetSessionExportPath(sessionId),
  resolveExportFilePath: vi.fn(
    (sessionId: string, filename: string) => `/tmp/${sessionId}/${filename}`,
  ),
}));

vi.mock('../cli/session-meta.js', () => ({
  readSessionEntries: (sessionId: string) => mockReadSessionEntries(sessionId),
  exportSessionToMarkdown: (_sessionId: string, _entries: unknown[]) =>
    mockExportSessionToMarkdown(_sessionId, _entries),
  listExportFiles: vi.fn(() => []),
  deleteExportFile: vi.fn(),
}));

function createMockCtx(overrides: Partial<ChatContext> = {}): ChatContext {
  return {
    rl: { prompt: () => {} } as any,
    sessionId: 'test-session',
    cwd: '/tmp/test',
    ...overrides,
  } as unknown as ChatContext;
}

describe('handleExportCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadSessionEntries.mockReturnValue([...mockEntries]);
    mockExportSessionToMarkdown.mockReturnValue('# Session Export');
    mockGetSessionExportPath.mockReturnValue('/tmp/sessions/test-session/exports');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false for non-export commands', async () => {
    const ctx = createMockCtx();
    expect(await handleExportCommand('/help', ctx)).toEqual(false);
    expect(await handleExportCommand('/audit', ctx)).toEqual(false);
  });

  it('returns false for prefix collisions', async () => {
    const ctx = createMockCtx();
    expect(await handleExportCommand('/exportx', ctx)).toEqual(false);
    expect(await handleExportCommand('/export-listx', ctx)).toEqual(false);
    expect(await handleExportCommand('/export-showx', ctx)).toEqual(false);
  });

  it('rejects /export to unsafe output path by default', async () => {
    const ctx = createMockCtx({ cwd: '/tmp/project' });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const outPath = '/tmp/unsafe-session-export.json';

    const result = await handleExportCommand(`/export json ${outPath}`, ctx);

    expect(result).toBe(true);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(
      consoleSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('must be within'),
      ),
    ).toBe(true);
  });

  it('allows /export unsafe output path with --unsafe-path', async () => {
    const ctx = createMockCtx({ cwd: '/tmp/project' });
    const outPath = '/tmp/unsafe-session-export.json';

    const result = await handleExportCommand(`/export json ${outPath} --unsafe-path`, ctx);

    expect(result).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalled();
    expect(mockWriteFileSync.mock.calls[0][0]).toBe(path.resolve(outPath));
    expect(mockWriteFileSync.mock.calls[0][1]).toBe(JSON.stringify(mockEntries, null, 2));
    expect(mockWriteFileSync.mock.calls[0][2]).toBe('utf-8');
  });
});
