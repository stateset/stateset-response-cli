import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockExistsSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockMkdirSync,
  mockReaddirSync,
  mockStatSync,
  mockUnlinkSync,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn((_path?: any) => false as boolean),
  mockReadFileSync: vi.fn((_path?: any, _opts?: any) => '' as any),
  mockWriteFileSync: vi.fn((_path?: any, _data?: any) => undefined as any),
  mockMkdirSync: vi.fn((_path?: any, _opts?: any) => undefined as any),
  mockReaddirSync: vi.fn((_path?: any, _opts?: any) => [] as any[]),
  mockStatSync: vi.fn((_path?: any) => ({}) as any),
  mockUnlinkSync: vi.fn((_path?: any) => undefined as any),
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
    readdirSync: mockReaddirSync,
    statSync: mockStatSync,
    unlinkSync: mockUnlinkSync,
  },
}));

vi.mock('../session.js', () => ({
  sanitizeSessionId: (id: string) => id || 'default',
  getSessionsDir: () => '/tmp/test-sessions',
  getSessionDir: (id: string) => `/tmp/test-sessions/${id}`,
  getStateSetDir: () => '/tmp/test-stateset',
}));

vi.mock('./audit.js', () => ({
  readToolAudit: vi.fn(() => []),
}));

vi.mock('../utils/session-exports.js', () => ({
  getSessionExportPath: vi.fn((sid: string) => `/tmp/test-sessions/${sid}/exports`),
  resolveExportFilePath: vi.fn(
    (sid: string, name: string) => `/tmp/test-sessions/${sid}/exports/${name}`,
  ),
}));

vi.mock('./utils.js', () => ({
  ensureDirExists: vi.fn(),
}));

import {
  readSessionMeta,
  writeSessionMeta,
  listSessionSummaries,
  formatContentForExport,
  exportSessionToMarkdown,
} from '../cli/session-meta.js';

describe('readSessionMeta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty object when meta.json does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(readSessionMeta('/tmp/test-sessions/sess-1')).toEqual({});
  });

  it('parses valid meta.json', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ tags: ['urgent'], archived: true }));
    const meta = readSessionMeta('/tmp/test-sessions/sess-1');
    expect(meta.tags).toEqual(['urgent']);
    expect(meta.archived).toBe(true);
  });

  it('returns empty object on malformed JSON', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{bad json}');
    expect(readSessionMeta('/tmp/test-sessions/sess-1')).toEqual({});
  });
});

describe('writeSessionMeta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes JSON-stringified meta to meta.json', () => {
    writeSessionMeta('/tmp/test-sessions/sess-1', { tags: ['vip'] });
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const written = mockWriteFileSync.mock.calls[0][1] as string;
    expect(JSON.parse(written)).toEqual({ tags: ['vip'] });
  });
});

describe('listSessionSummaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when sessions directory is unreadable', () => {
    mockReaddirSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(listSessionSummaries()).toEqual([]);
  });

  it('returns sorted summaries for valid session directories', () => {
    mockReaddirSync.mockReturnValue([
      { name: 'sess-a', isDirectory: () => true },
      { name: 'sess-b', isDirectory: () => true },
    ]);
    mockExistsSync.mockReturnValue(false);
    mockStatSync.mockReturnValue({ mtimeMs: 1000 });
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const summaries = listSessionSummaries();
    expect(summaries).toHaveLength(2);
    expect(summaries[0].id).toBeDefined();
  });

  it('excludes archived sessions by default', () => {
    mockReaddirSync.mockReturnValue([{ name: 'sess-archived', isDirectory: () => true }]);
    mockExistsSync.mockImplementation((p: any) => String(p).includes('meta.json'));
    mockReadFileSync.mockReturnValue(JSON.stringify({ archived: true }));
    mockStatSync.mockReturnValue({ mtimeMs: 1000 });

    expect(listSessionSummaries()).toEqual([]);
    expect(listSessionSummaries({ includeArchived: true })).toHaveLength(1);
  });
});

describe('formatContentForExport', () => {
  it('handles string content', () => {
    expect(formatContentForExport('hello world')).toBe('hello world');
  });

  it('handles array with text blocks', () => {
    const content = [
      { type: 'text' as const, text: 'Hello' },
      { type: 'text' as const, text: 'World' },
    ];
    const result = formatContentForExport(content);
    expect(result).toContain('Hello');
    expect(result).toContain('World');
  });

  it('handles array with tool_use blocks', () => {
    const content = [
      { type: 'tool_use' as const, id: 'tu1', name: 'read_file', input: { path: '/foo' } },
    ];
    const result = formatContentForExport(content);
    expect(result).toContain('[tool_use] read_file');
    expect(result).toContain('/foo');
  });

  it('handles array with tool_result blocks', () => {
    const content = [
      { type: 'tool_result' as const, tool_use_id: 'tu1', content: 'file contents here' },
    ];
    const result = formatContentForExport(content);
    expect(result).toContain('[tool_result]');
    expect(result).toContain('file contents here');
  });

  it('handles null/undefined content', () => {
    expect(formatContentForExport(null as any)).toBe('');
    expect(formatContentForExport(undefined as any)).toBe('');
  });
});

describe('exportSessionToMarkdown', () => {
  it('produces expected markdown structure', () => {
    const entries = [
      { role: 'user' as const, content: 'What is 2+2?', ts: '2025-01-01T00:00:00Z' },
      { role: 'assistant' as const, content: 'The answer is 4.' },
    ];

    const md = exportSessionToMarkdown('sess-1', entries);
    expect(md).toContain('# Session Export: sess-1');
    expect(md).toContain('Messages: 2');
    expect(md).toContain('## User (2025-01-01T00:00:00Z)');
    expect(md).toContain('What is 2+2?');
    expect(md).toContain('## Assistant');
    expect(md).toContain('The answer is 4.');
  });
});
