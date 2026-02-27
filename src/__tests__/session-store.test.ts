import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockExistsSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockAppendFileSync,
  mockMkdirSync,
  mockLstatSync,
  mockChmodSync,
  mockRenameSync,
  mockUnlinkSync,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn((_path?: any) => false as boolean),
  mockReadFileSync: vi.fn((_path?: any, _opts?: any) => '' as any),
  mockWriteFileSync: vi.fn((_path?: any, _data?: any) => undefined as any),
  mockAppendFileSync: vi.fn((_path?: any, _data?: any) => undefined as any),
  mockMkdirSync: vi.fn((_path?: any, _opts?: any) => undefined as any),
  mockLstatSync: vi.fn(
    (_path?: any) =>
      ({
        isSymbolicLink: () => false,
        isDirectory: () => true,
      }) as any,
  ),
  mockChmodSync: vi.fn((_path?: any, _mode?: any) => undefined as any),
  mockRenameSync: vi.fn((_oldPath?: any, _newPath?: any) => undefined as any),
  mockUnlinkSync: vi.fn((_path?: any) => undefined as any),
}));

const { mockReadTextFile, mockReadJsonFile } = vi.hoisted(() => ({
  mockReadTextFile: vi.fn((_path?: any, _opts?: any) => '' as any),
  mockReadJsonFile: vi.fn((_path?: any, _opts?: any) => null as any),
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    appendFileSync: mockAppendFileSync,
    mkdirSync: mockMkdirSync,
    lstatSync: mockLstatSync,
    chmodSync: mockChmodSync,
    renameSync: mockRenameSync,
    unlinkSync: mockUnlinkSync,
  },
}));

vi.mock('node:os', () => ({
  default: { homedir: () => '/tmp/test-home' },
}));

vi.mock('../utils/file-read.js', () => ({
  readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
  readJsonFile: (...args: unknown[]) => mockReadJsonFile(...args),
  MAX_TEXT_FILE_SIZE_BYTES: 1_048_576,
}));

import { SessionStore } from '../session.js';

describe('SessionStore', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockReadTextFile.mockReturnValue('');
    mockReadJsonFile.mockReturnValue(null);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('creates session directory on construction', () => {
    new SessionStore('test-session');
    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('test-session'),
      expect.objectContaining({ recursive: true }),
    );
  });

  it('returns correct session ID and paths', () => {
    const store = new SessionStore('my-sess');
    expect(store.getSessionId()).toBe('my-sess');
    expect(store.getContextPath()).toContain('context.jsonl');
    expect(store.getLogPath()).toContain('log.jsonl');
  });

  describe('loadMessages', () => {
    it('returns empty array when context file does not exist', () => {
      const store = new SessionStore('sess-1');
      mockExistsSync.mockReturnValue(false);
      expect(store.loadMessages()).toEqual([]);
    });

    it('parses valid JSONL lines into MessageParam array', () => {
      const store = new SessionStore('sess-1');
      mockExistsSync.mockReturnValue(true);
      mockReadTextFile.mockReturnValue(
        '{"role":"user","content":"hello"}\n{"role":"assistant","content":"hi"}\n',
      );

      const messages = store.loadMessages();
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: 'user', content: 'hello' });
      expect(messages[1]).toEqual({ role: 'assistant', content: 'hi' });
    });

    it('skips malformed JSON lines gracefully', () => {
      const store = new SessionStore('sess-1');
      mockExistsSync.mockReturnValue(true);
      mockReadTextFile.mockReturnValue(
        '{"role":"user","content":"ok"}\n{bad json}\n{"role":"assistant","content":"yes"}\n',
      );

      const messages = store.loadMessages();
      expect(messages).toHaveLength(2);
    });

    it('skips entries with invalid role', () => {
      const store = new SessionStore('sess-1');
      mockExistsSync.mockReturnValue(true);
      mockReadTextFile.mockReturnValue(
        '{"role":"system","content":"sys"}\n{"role":"user","content":"ok"}\n',
      );

      const messages = store.loadMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('user');
    });

    it('skips entries with missing content', () => {
      const store = new SessionStore('sess-1');
      mockExistsSync.mockReturnValue(true);
      mockReadTextFile.mockReturnValue('{"role":"user"}\n');

      expect(store.loadMessages()).toHaveLength(0);
    });
  });

  describe('appendMessage', () => {
    it('appends a single message as JSON line', () => {
      const store = new SessionStore('sess-1');
      store.appendMessage({ role: 'user', content: 'test message' });

      expect(mockAppendFileSync).toHaveBeenCalledTimes(1);
      const written = mockAppendFileSync.mock.calls[0][1] as string;
      expect(written).toMatch(/\n$/);
      const parsed = JSON.parse(written.trim());
      expect(parsed.role).toBe('user');
      expect(parsed.content).toBe('test message');
      expect(parsed.ts).toBeDefined();
    });

    it('logs warning once when append fails', () => {
      const store = new SessionStore('sess-1');
      mockAppendFileSync.mockImplementation(() => {
        throw new Error('disk full');
      });

      store.appendMessage({ role: 'user', content: 'first' });
      store.appendMessage({ role: 'user', content: 'second' });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Append session message failed'),
      );
    });
  });

  describe('appendMessages', () => {
    it('appends multiple messages; does nothing for empty array', () => {
      const store = new SessionStore('sess-1');
      store.appendMessages([]);
      expect(mockAppendFileSync).not.toHaveBeenCalled();

      store.appendMessages([
        { role: 'user', content: 'one' },
        { role: 'assistant', content: 'two' },
      ]);
      expect(mockAppendFileSync).toHaveBeenCalledTimes(1);
      const written = mockAppendFileSync.mock.calls[0][1] as string;
      const lines = written.trim().split('\n');
      expect(lines).toHaveLength(2);
    });

    it('warns when batch append fails', () => {
      const store = new SessionStore('sess-1');
      mockAppendFileSync.mockImplementation(() => {
        throw new Error('permission denied');
      });

      store.appendMessages([{ role: 'user', content: 'one' }]);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Append session messages failed'),
      );
    });
  });

  describe('appendLog', () => {
    it('appends log entry to logPath', () => {
      const store = new SessionStore('sess-1');
      store.appendLog({ ts: '2025-01-01T00:00:00Z', role: 'user', text: 'hello' });

      expect(mockAppendFileSync).toHaveBeenCalledTimes(1);
      const written = mockAppendFileSync.mock.calls[0][1] as string;
      const parsed = JSON.parse(written.trim());
      expect(parsed.role).toBe('user');
      expect(parsed.text).toBe('hello');
    });

    it('warns when log append fails', () => {
      const store = new SessionStore('sess-1');
      mockAppendFileSync.mockImplementation(() => {
        throw new Error('read-only fs');
      });

      store.appendLog({ ts: '2025-01-01T00:00:00Z', role: 'user', text: 'hello' });

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Append session log failed'));
    });
  });

  describe('clear', () => {
    it('clears both files when they exist', () => {
      const store = new SessionStore('sess-1');
      mockExistsSync.mockReturnValue(true);
      store.clear();
      // Atomic clear: writes to temp file then renames for each file
      expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
      expect(mockRenameSync).toHaveBeenCalledTimes(2);
    });

    it('does nothing when files do not exist', () => {
      const store = new SessionStore('sess-1');
      mockExistsSync.mockReturnValue(false);
      store.clear();
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });
  });
});
