import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import type { ChatContext } from '../cli/types.js';

const mockEntries = [{ role: 'user' as const, content: 'hello', ts: '2025-01-01T00:00:00Z' }];

const {
  mockWriteFileSync,
  mockReadSessionEntries,
  mockExportSessionToMarkdown,
  mockGetSessionExportPath,
  mockReadTextFile,
  mockListExportFiles,
} = vi.hoisted(() => ({
  mockWriteFileSync: vi.fn(),
  mockReadSessionEntries: vi.fn((_sessionId?: string) => [...mockEntries]),
  mockExportSessionToMarkdown: vi.fn(
    (_sessionId?: string, _entries?: unknown[]) => '# Session Export',
  ),
  mockGetSessionExportPath: vi.fn((sessionId: string) => `/tmp/sessions/${sessionId}/exports`),
  mockReadTextFile: vi.fn((_filePath?: string, _opts?: unknown) => 'line1\nline2\nline3'),
  mockListExportFiles: vi.fn(
    (_sessionId?: string) => [] as Array<{ name: string; updatedAtMs: number; size: number }>,
  ),
}));

const { mockExistsSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(() => false),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    default: {
      ...actual,
      writeFileSync: mockWriteFileSync,
      existsSync: mockExistsSync,
      mkdirSync: vi.fn(),
      lstatSync: vi.fn(() => ({
        isDirectory: () => false,
        isSymbolicLink: () => false,
      })),
      realpathSync: vi.fn((p: string) => p),
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

vi.mock('../utils/file-read.js', () => ({
  readTextFile: (filePath: string, opts?: unknown) => mockReadTextFile(filePath, opts),
  MAX_TEXT_FILE_SIZE_BYTES: 10_485_760,
}));

vi.mock('../cli/session-meta.js', () => ({
  readSessionEntries: (sessionId: string) => mockReadSessionEntries(sessionId),
  exportSessionToMarkdown: (_sessionId: string, _entries: unknown[]) =>
    mockExportSessionToMarkdown(_sessionId, _entries),
  listExportFiles: (sessionId: string) => mockListExportFiles(sessionId),
  deleteExportFile: vi.fn(),
}));

import { handleExportCommand } from '../cli/commands-export.js';

function createMockCtx(overrides: Partial<ChatContext> = {}): ChatContext {
  return {
    rl: { prompt: vi.fn() } as any,
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

  it('/export-list shows empty export list', async () => {
    const ctx = createMockCtx();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handleExportCommand('/export-list', ctx);

    expect(result).toBe(true);
    expect(
      consoleSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('No exports found'),
      ),
    ).toBe(true);
    expect(ctx.rl.prompt).toHaveBeenCalled();
  });

  it('/export-show with no filename shows usage', async () => {
    const ctx = createMockCtx();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handleExportCommand('/export-show', ctx);

    expect(result).toBe(true);
    expect(
      consoleSpy.mock.calls.some(([line]) => typeof line === 'string' && line.includes('Usage')),
    ).toBe(true);
    expect(ctx.rl.prompt).toHaveBeenCalled();
  });

  it('/export-open with no filename shows usage', async () => {
    const ctx = createMockCtx();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handleExportCommand('/export-open', ctx);

    expect(result).toBe(true);
    expect(
      consoleSpy.mock.calls.some(([line]) => typeof line === 'string' && line.includes('Usage')),
    ).toBe(true);
    expect(ctx.rl.prompt).toHaveBeenCalled();
  });

  it('/export-show with nonexistent file shows warning', async () => {
    const ctx = createMockCtx();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handleExportCommand('/export-show missing.md', ctx);

    expect(result).toBe(true);
    expect(
      consoleSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('not found'),
      ),
    ).toBe(true);
  });

  it('/export-open with nonexistent file shows warning', async () => {
    const ctx = createMockCtx();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handleExportCommand('/export-open missing.md', ctx);

    expect(result).toBe(true);
    expect(
      consoleSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('not found'),
      ),
    ).toBe(true);
  });

  it('/export with no messages shows warning', async () => {
    mockReadSessionEntries.mockReturnValue([]);
    const ctx = createMockCtx();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handleExportCommand('/export', ctx);

    expect(result).toBe(true);
    expect(
      consoleSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('No messages found'),
      ),
    ).toBe(true);
  });

  it('/export writes markdown by default', async () => {
    const ctx = createMockCtx({ cwd: '/tmp/sessions/test-session/exports' });
    const result = await handleExportCommand('/export', ctx);

    expect(result).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    expect(mockWriteFileSync.mock.calls[0][1]).toBe('# Session Export');
  });

  it('/export json writes JSON format', async () => {
    const ctx = createMockCtx({ cwd: '/tmp/sessions/test-session/exports' });
    const result = await handleExportCommand('/export json', ctx);

    expect(result).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(JSON.parse(written)).toEqual(mockEntries);
  });

  it('/export jsonl writes JSONL format', async () => {
    const ctx = createMockCtx({ cwd: '/tmp/sessions/test-session/exports' });
    const result = await handleExportCommand('/export jsonl', ctx);

    expect(result).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(written.endsWith('\n')).toBe(true);
    const lines = written.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual(mockEntries[0]);
  });

  it('/export-delete with no filename shows usage', async () => {
    const ctx = createMockCtx();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handleExportCommand('/export-delete', ctx);

    expect(result).toBe(true);
    expect(
      consoleSpy.mock.calls.some(([line]) => typeof line === 'string' && line.includes('Usage')),
    ).toBe(true);
  });

  it('/export-prune with few files shows nothing to prune', async () => {
    const ctx = createMockCtx();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handleExportCommand('/export-prune', ctx);

    expect(result).toBe(true);
    expect(
      consoleSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('No exports to prune'),
      ),
    ).toBe(true);
  });

  it('/export-list shows file list when exports exist', async () => {
    mockListExportFiles.mockReturnValue([
      { name: 'export1.md', updatedAtMs: Date.now(), size: 1024 },
      { name: 'export2.json', updatedAtMs: Date.now(), size: 2048 },
    ]);
    const ctx = createMockCtx();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handleExportCommand('/export-list', ctx);

    expect(result).toBe(true);
    expect(
      consoleSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('Exports for'),
      ),
    ).toBe(true);
  });

  it('/export-list accepts session argument', async () => {
    mockListExportFiles.mockReturnValue([]);
    const ctx = createMockCtx();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handleExportCommand('/export-list other-session', ctx);

    expect(result).toBe(true);
    expect(mockListExportFiles).toHaveBeenCalledWith('other-session');
  });

  it('/export-show displays file contents when file exists', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadTextFile.mockReturnValue('# Export Content\nLine 2\nLine 3');
    const ctx = createMockCtx();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handleExportCommand('/export-show report.md', ctx);

    expect(result).toBe(true);
    expect(
      consoleSpy.mock.calls.some(([line]) => typeof line === 'string' && line.includes('Showing')),
    ).toBe(true);
  });

  it('/export-show respects head= parameter', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadTextFile.mockReturnValue('L1\nL2\nL3\nL4\nL5');
    const ctx = createMockCtx();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handleExportCommand('/export-show report.md test-session head=2', ctx);

    expect(result).toBe(true);
    expect(
      consoleSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('Showing 2 lines'),
      ),
    ).toBe(true);
  });

  it('/export-open shows path when file exists', async () => {
    mockExistsSync.mockReturnValue(true);
    const ctx = createMockCtx();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handleExportCommand('/export-open report.md', ctx);

    expect(result).toBe(true);
    expect(
      consoleSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('Export path'),
      ),
    ).toBe(true);
  });

  it('/export-delete with nonexistent file shows warning', async () => {
    mockExistsSync.mockReturnValue(false);
    const ctx = createMockCtx();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handleExportCommand('/export-delete missing.md', ctx);

    expect(result).toBe(true);
    expect(
      consoleSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('not found'),
      ),
    ).toBe(true);
  });

  it('/export with session and format arguments', async () => {
    const ctx = createMockCtx({ cwd: '/tmp/sessions/test-session/exports' });
    const result = await handleExportCommand('/export my-session json', ctx);

    expect(result).toBe(true);
    expect(mockReadSessionEntries).toHaveBeenCalledWith('my-session');
    expect(mockWriteFileSync).toHaveBeenCalled();
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(JSON.parse(written)).toEqual(mockEntries);
  });
});
