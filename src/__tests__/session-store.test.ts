import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExistsSync, mockReadFileSync, mockWriteFileSync, mockAppendFileSync, mockMkdirSync } =
  vi.hoisted(() => ({
    mockExistsSync: vi.fn((_path?: any) => false as boolean),
    mockReadFileSync: vi.fn((_path?: any, _opts?: any) => '' as any),
    mockWriteFileSync: vi.fn((_path?: any, _data?: any) => undefined as any),
    mockAppendFileSync: vi.fn((_path?: any, _data?: any) => undefined as any),
    mockMkdirSync: vi.fn((_path?: any, _opts?: any) => undefined as any),
  }));

vi.mock('node:fs', () => ({
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    appendFileSync: mockAppendFileSync,
    mkdirSync: mockMkdirSync,
  },
}));

vi.mock('node:os', () => ({
  default: { homedir: () => '/tmp/test-home' },
}));

import { SessionStore } from '../session.js';

describe('SessionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
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
      mockReadFileSync.mockReturnValue(
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
      mockReadFileSync.mockReturnValue(
        '{"role":"user","content":"ok"}\n{bad json}\n{"role":"assistant","content":"yes"}\n',
      );

      const messages = store.loadMessages();
      expect(messages).toHaveLength(2);
    });

    it('skips entries with invalid role', () => {
      const store = new SessionStore('sess-1');
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        '{"role":"system","content":"sys"}\n{"role":"user","content":"ok"}\n',
      );

      const messages = store.loadMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('user');
    });

    it('skips entries with missing content', () => {
      const store = new SessionStore('sess-1');
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('{"role":"user"}\n');

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
  });

  describe('clear', () => {
    it('clears both files when they exist', () => {
      const store = new SessionStore('sess-1');
      mockExistsSync.mockReturnValue(true);
      store.clear();
      expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
    });

    it('does nothing when files do not exist', () => {
      const store = new SessionStore('sess-1');
      mockExistsSync.mockReturnValue(false);
      store.clear();
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });
  });
});
