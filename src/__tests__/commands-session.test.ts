import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleSessionCommand } from '../cli/commands-session.js';
import type { ChatContext } from '../cli/types.js';

const mockMeta = { tags: ['test'], archived: false };
const mockSessions = [
  {
    id: 'default',
    dir: '/tmp/sessions/default',
    updatedAtMs: 1700000000000,
    messageCount: 5,
    tags: ['dev'],
    archived: false,
  },
  {
    id: 'archived-session',
    dir: '/tmp/sessions/archived',
    updatedAtMs: 1699000000000,
    messageCount: 2,
    tags: ['old'],
    archived: true,
  },
];
const mockEntries = [
  { role: 'user', content: 'hello world', ts: '2025-01-01T00:00:00Z' },
  { role: 'assistant', content: 'hi there', ts: '2025-01-01T00:01:00Z' },
  { role: 'user', content: 'search target text', ts: '2025-01-02T00:00:00Z' },
];

vi.mock('../session.js', () => ({
  sanitizeSessionId: vi.fn((id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '')),
  getSessionsDir: vi.fn(() => '/tmp/sessions'),
  getSessionDir: vi.fn((id: string) => `/tmp/sessions/${id}`),
}));

vi.mock('../cli/session-meta.js', () => ({
  readSessionMeta: vi.fn(() => ({ ...mockMeta })),
  writeSessionMeta: vi.fn(),
  listSessionSummaries: vi.fn(() => [...mockSessions]),
  readSessionEntries: vi.fn(() => [...mockEntries]),
  formatContentForExport: vi.fn((c: unknown) => (typeof c === 'string' ? c : '')),
  getSessionMetaSummary: vi.fn(() => ({
    id: 'test-session',
    dir: '/tmp/sessions/test-session',
    updatedAtMs: 1700000000000,
    messages: 5,
    tags: ['test'],
    archived: false,
    memory: { global: false, session: false },
    exports: 0,
    auditEntries: 0,
  })),
}));

vi.mock('../memory.js', () => ({
  loadMemory: vi.fn(() => ''),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => true),
      renameSync: vi.fn(),
      rmSync: vi.fn(),
    },
  };
});

import {
  writeSessionMeta,
  readSessionMeta,
  readSessionEntries,
  listSessionSummaries,
} from '../cli/session-meta.js';

const mockWriteSessionMeta = vi.mocked(writeSessionMeta);
const mockReadSessionMeta = vi.mocked(readSessionMeta);
const mockReadSessionEntries = vi.mocked(readSessionEntries);
const mockListSessionSummaries = vi.mocked(listSessionSummaries);

function createMockCtx(overrides: Partial<ChatContext> = {}): ChatContext {
  return {
    agent: {
      getHistoryLength: vi.fn(() => 5),
    } as any,
    rl: { prompt: vi.fn(), pause: vi.fn(), resume: vi.fn() } as any,
    sessionId: 'test-session',
    sessionStore: {
      getSessionDir: vi.fn(() => '/tmp/sessions/test-session'),
      clear: vi.fn(),
    } as any,
    cwd: '/tmp/project',
    activeSkills: [],
    switchSession: vi.fn(),
    ...overrides,
  } as unknown as ChatContext;
}

describe('handleSessionCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadSessionMeta.mockReturnValue({ ...mockMeta });
    mockReadSessionEntries.mockReturnValue([...mockEntries]);
    mockListSessionSummaries.mockReturnValue([...mockSessions]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false for non-session commands', async () => {
    const ctx = createMockCtx();
    expect(await handleSessionCommand('/help', ctx)).toBe(false);
    expect(await handleSessionCommand('/apply on', ctx)).toBe(false);
    expect(await handleSessionCommand('hello', ctx)).toBe(false);
    expect(await handleSessionCommand('/searchx', ctx)).toBe(false);
    expect(await handleSessionCommand('/archivex', ctx)).toBe(false);
  });

  // /session
  it('/session shows current session info', async () => {
    const ctx = createMockCtx();
    const result = await handleSessionCommand('/session', ctx);
    expect(result).toBe(true);
    expect(ctx.rl.prompt).toHaveBeenCalled();
  });

  it('/session accepts trailing whitespace', async () => {
    const ctx = createMockCtx();
    const result = await handleSessionCommand('/session   ', ctx);
    expect(result).toBe(true);
    expect(ctx.rl.prompt).toHaveBeenCalled();
  });

  // /sessions
  it('/sessions lists sessions', async () => {
    const ctx = createMockCtx();
    const result = await handleSessionCommand('/sessions', ctx);
    expect(result).toBe(true);
    expect(ctx.rl.prompt).toHaveBeenCalled();
  });

  it('/sessions with tag= filters by tag', async () => {
    mockListSessionSummaries.mockReturnValue([...mockSessions]);
    const ctx = createMockCtx();
    const result = await handleSessionCommand('/sessions tag=dev', ctx);
    expect(result).toBe(true);
  });

  it('/sessions shows empty message when no sessions', async () => {
    mockListSessionSummaries.mockReturnValue([]);
    const ctx = createMockCtx();
    const result = await handleSessionCommand('/sessions', ctx);
    expect(result).toBe(true);
  });

  // /tag
  it('/tag with no args shows usage', async () => {
    const ctx = createMockCtx();
    const result = await handleSessionCommand('/tag', ctx);
    expect(result).toBe(true);
  });

  it('/tag list shows tags for current session', async () => {
    const ctx = createMockCtx();
    const result = await handleSessionCommand('/tag list', ctx);
    expect(result).toBe(true);
  });

  it('/tag add adds a tag and persists', async () => {
    mockReadSessionMeta.mockReturnValue({ tags: ['existing'], archived: false });
    const ctx = createMockCtx();
    const result = await handleSessionCommand('/tag add newtag', ctx);
    expect(result).toBe(true);
    expect(mockWriteSessionMeta).toHaveBeenCalled();
    const writtenMeta = mockWriteSessionMeta.mock.calls[0][1];
    expect(writtenMeta.tags).toContain('newtag');
    expect(writtenMeta.tags).toContain('existing');
  });

  it('/tag remove removes a tag and persists', async () => {
    mockReadSessionMeta.mockReturnValue({ tags: ['keep', 'remove-me'], archived: false });
    const ctx = createMockCtx();
    const result = await handleSessionCommand('/tag remove remove-me', ctx);
    expect(result).toBe(true);
    expect(mockWriteSessionMeta).toHaveBeenCalled();
    const writtenMeta = mockWriteSessionMeta.mock.calls[0][1];
    expect(writtenMeta.tags).toContain('keep');
    expect(writtenMeta.tags).not.toContain('remove-me');
  });

  it('/tag add with empty tag shows warning', async () => {
    const ctx = createMockCtx();
    const result = await handleSessionCommand('/tag add', ctx);
    expect(result).toBe(true);
  });

  // /search
  it('/search with no term shows usage', async () => {
    const ctx = createMockCtx();
    const result = await handleSessionCommand('/search', ctx);
    expect(result).toBe(true);
  });

  it('/search finds matching text', async () => {
    const ctx = createMockCtx();
    const result = await handleSessionCommand('/search target', ctx);
    expect(result).toBe(true);
  });

  it('/search rejects invalid role filter', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const ctx = createMockCtx();
    const result = await handleSessionCommand('/search role=system target', ctx);
    expect(result).toBe(true);
    expect(
      consoleSpy.mock.calls.some(
        ([line]) =>
          typeof line === 'string' &&
          line.includes('Invalid role filter. Use role=user or role=assistant.'),
      ),
    ).toBe(true);
  });

  it('/search rejects invalid limit', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const ctx = createMockCtx();
    const result = await handleSessionCommand('/search target limit=0', ctx);
    expect(result).toBe(true);
    expect(
      consoleSpy.mock.calls.some(
        ([line]) =>
          typeof line === 'string' && line.includes('Invalid limit. Use a positive number.'),
      ),
    ).toBe(true);
  });

  it('/search caps requested limit above maximum', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const ctx = createMockCtx();
    const result = await handleSessionCommand('/search target limit=999', ctx);
    expect(result).toBe(true);
    expect(
      consoleSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('Requested limit 999 exceeds 100.'),
      ),
    ).toBe(true);
  });

  it('/search validates since/until ordering', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const ctx = createMockCtx();
    const result = await handleSessionCommand(
      '/search target since=2025-01-02 until=2025-01-01',
      ctx,
    );
    expect(result).toBe(true);
    expect(
      consoleSpy.mock.calls.some(
        ([line]) =>
          typeof line === 'string' &&
          line.includes('Invalid date range. `since` must be earlier than or equal to `until`.'),
      ),
    ).toBe(true);
  });

  it('/search role=user filters by role', async () => {
    const ctx = createMockCtx();
    const result = await handleSessionCommand('/search role=user hello', ctx);
    expect(result).toBe(true);
  });

  it('/search with regex= uses regex matching', async () => {
    const ctx = createMockCtx();
    const result = await handleSessionCommand('/search regex=/target/i', ctx);
    expect(result).toBe(true);
  });

  it('/search with invalid regex shows warning', async () => {
    const ctx = createMockCtx();
    const result = await handleSessionCommand('/search regex=/[invalid', ctx);
    expect(result).toBe(true);
  });

  it('/search enforces a hard scanned-entry limit', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mockEntries = Array.from({ length: 5005 }, (_, i) => ({
      role: 'user' as const,
      content: `entry-${i}`,
      ts: '2025-01-01T00:00:00Z',
    }));
    mockReadSessionEntries.mockReturnValue([...mockEntries]);

    const ctx = createMockCtx();
    const result = await handleSessionCommand('/search thisdoesnotexist', ctx);
    expect(result).toBe(true);
    expect(
      consoleSpy.mock.calls.some(
        ([line]) =>
          typeof line === 'string' && line.includes('Search stopped after 5000 scanned entries.'),
      ),
    ).toBe(true);
    expect(
      consoleSpy.mock.calls.some(
        ([line]) =>
          typeof line === 'string' && line.includes('No matches found in scanned entries.'),
      ),
    ).toBe(true);
  });

  it('/search honors output limit before reaching scan limit', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mockEntries = Array.from({ length: 5005 }, (_, i) => ({
      role: 'user' as const,
      content: `entry-${i}`,
      ts: '2025-01-01T00:00:00Z',
    }));
    mockReadSessionEntries.mockReturnValue([...mockEntries]);

    const ctx = createMockCtx();
    const result = await handleSessionCommand('/search entry', ctx);
    expect(result).toBe(true);
    expect(
      consoleSpy.mock.calls.some(
        ([line]) =>
          typeof line === 'string' && line.includes('Result limit reached after 25 matches.'),
      ),
    ).toBe(true);
  });

  it('/search rejects unsafe nested-repetition regex patterns', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const ctx = createMockCtx();
    const result = await handleSessionCommand('/search regex=/(a+)+/i', ctx);
    expect(result).toBe(true);
    expect(
      consoleSpy.mock.calls.some(
        ([line]) =>
          typeof line === 'string' &&
          line.includes(
            'Invalid regex: Regex has nested repetition and may cause expensive evaluation.',
          ),
      ),
    ).toBe(true);
  });

  it('/search rejects lookaround regex patterns', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const ctx = createMockCtx();
    const result = await handleSessionCommand('/search regex=/target(?=test)/i', ctx);
    expect(result).toBe(true);
    expect(
      consoleSpy.mock.calls.some(
        ([line]) =>
          typeof line === 'string' &&
          line.includes('Invalid regex: Regex lookaround assertions are disabled for safety.'),
      ),
    ).toBe(true);
  });

  // /archive / /unarchive
  it('/archive sets archived to true', async () => {
    mockReadSessionMeta.mockReturnValue({ tags: [], archived: false });
    const ctx = createMockCtx();
    const result = await handleSessionCommand('/archive', ctx);
    expect(result).toBe(true);
    expect(mockWriteSessionMeta).toHaveBeenCalled();
    const writtenMeta = mockWriteSessionMeta.mock.calls[0][1];
    expect(writtenMeta.archived).toBe(true);
  });

  it('/unarchive sets archived to false', async () => {
    mockReadSessionMeta.mockReturnValue({ tags: [], archived: true });
    const ctx = createMockCtx();
    const result = await handleSessionCommand('/unarchive', ctx);
    expect(result).toBe(true);
    expect(mockWriteSessionMeta).toHaveBeenCalled();
    const writtenMeta = mockWriteSessionMeta.mock.calls[0][1];
    expect(writtenMeta.archived).toBe(false);
  });

  // /rename
  it('/rename with no arg shows usage', async () => {
    const ctx = createMockCtx();
    const result = await handleSessionCommand('/rename', ctx);
    expect(result).toBe(true);
  });

  it('/rename with same name shows unchanged message', async () => {
    const ctx = createMockCtx({ sessionId: 'test-session' });
    const result = await handleSessionCommand('/rename test-session', ctx);
    expect(result).toBe(true);
    expect(ctx.switchSession).not.toHaveBeenCalled();
  });
});
