import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (must precede the import of the module under test)
// ---------------------------------------------------------------------------

vi.mock('../config.js', () => ({
  getConfiguredModel: vi.fn(() => 'claude-sonnet-4-6'),
  resolveModelOrThrow: vi.fn((value: string) => {
    if (value === 'bad-model') throw new Error(`Unknown model "${value}"`);
    return value;
  }),
  formatUnknownModelError: vi.fn((value: string) => `Unknown model "${value}"`),
  validateRuntimeConfig: vi.fn(() => ({
    orgId: 'org-test',
    orgConfig: {
      name: 'TestOrg',
      graphqlEndpoint: 'https://api.example.com/graphql',
      adminSecret: 'secret',
    },
    anthropicApiKey: 'sk-ant-test',
  })),
}));

class MockAgent {
  private _model = 'claude-sonnet-4-6';
  private _history: string[] = [];

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async chat(msg: string): Promise<string> {
    this._history.push(msg);
    return `echo: ${msg}`;
  }
  clearHistory(): void {
    this._history = [];
  }
  getModel(): string {
    return this._model;
  }
  getHistoryLength(): number {
    return this._history.length;
  }
  setModel(m: string): void {
    this._model = m;
  }
}

vi.mock('../agent.js', () => ({
  StateSetAgent: vi.fn(() => new MockAgent()),
}));

import { SlackGateway } from '../slack/gateway.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type GatewayInternals = {
  anthropicApiKey: string | null;
  botToken: string;
  botUserId: string | null;
  orgId: string;
  running: boolean;
  app: unknown;
  sessions: Map<
    string,
    {
      agent: MockAgent;
      lastActivity: number;
      processing: boolean;
      queue: unknown[];
      connectPromise?: Promise<void>;
      droppedMessages?: number;
    }
  >;
  activeChannelThreads: Map<string, number>;
  handleCommand: (text: string, session: { agent: MockAgent }) => string | null;
  onMessage: (event: Record<string, unknown>) => Promise<void>;
  getOrCreateSession: (
    userId: string,
  ) => { agent: MockAgent; lastActivity: number; processing: boolean; queue: unknown[] } | null;
  evictOldestSessions: (limit?: number) => void;
  cleanupSessions: () => void;
  getThreadKey: (channel: string, threadTs: string) => string;
  markThreadActive: (channel: string, threadTs: string) => void;
  isTrackedThread: (channel: string, threadTs?: string) => boolean;
};

function internals(gw: SlackGateway): GatewayInternals {
  return gw as unknown as GatewayInternals;
}

function makeSession(
  overrides?: Partial<{
    model: string;
    historyLength: number;
    lastActivity: number;
    processing: boolean;
  }>,
): { agent: MockAgent; lastActivity: number; processing: boolean; queue: unknown[] } {
  const agent = new MockAgent();
  if (overrides?.model) agent.setModel(overrides.model);
  // Simulate history by chatting
  for (let i = 0; i < (overrides?.historyLength ?? 0); i++) {
    agent.clearHistory(); // reset; we use getHistoryLength mock below
  }
  return {
    agent,
    lastActivity: overrides?.lastActivity ?? Date.now(),
    processing: overrides?.processing ?? false,
    queue: [],
  };
}

function createGateway(opts?: { allowList?: string[] }): SlackGateway {
  const gw = new SlackGateway(opts ?? {});
  const g = internals(gw);
  g.anthropicApiKey = 'sk-ant-test';
  g.botToken = 'xoxb-test';
  g.orgId = 'org-test';
  g.app = {
    client: {
      chat: { postMessage: vi.fn().mockResolvedValue({}) },
    },
  };
  return gw;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SlackGateway handleCommand', () => {
  let gw: SlackGateway;
  let session: ReturnType<typeof makeSession>;

  beforeEach(() => {
    vi.clearAllMocks();
    gw = createGateway();
    session = makeSession();
  });

  it('/help returns help text with all commands listed', () => {
    const result = internals(gw).handleCommand('/help', session);
    expect(result).not.toBeNull();
    expect(result).toContain('StateSet Response Agent');
    expect(result).toContain('/help');
    expect(result).toContain('/reset');
    expect(result).toContain('/clear');
    expect(result).toContain('/status');
    expect(result).toContain('/model');
  });

  it('/help is case-insensitive', () => {
    const result = internals(gw).handleCommand('/HELP', session);
    expect(result).toContain('StateSet Response Agent');
  });

  it('/help trims surrounding whitespace', () => {
    const result = internals(gw).handleCommand('  /help  ', session);
    expect(result).toContain('StateSet Response Agent');
  });

  it('/reset clears agent history', () => {
    const spy = vi.spyOn(session.agent, 'clearHistory');
    const result = internals(gw).handleCommand('/reset', session);
    expect(result).toBe('Conversation history cleared.');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('/clear also clears agent history', () => {
    const spy = vi.spyOn(session.agent, 'clearHistory');
    const result = internals(gw).handleCommand('/clear', session);
    expect(result).toBe('Conversation history cleared.');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('/status shows org, model, history length, and session count', () => {
    // Add a session so the count is non-zero
    internals(gw).sessions.set('U1', session as never);
    session.agent.setModel('claude-haiku-4-5-20251001');

    const result = internals(gw).handleCommand('/status', session);
    expect(result).toContain('org-test');
    expect(result).toContain('claude-haiku-4-5-20251001');
    expect(result).toContain('Active sessions: 1');
    expect(result).toContain('History:');
  });

  it('/model without arg shows current model', () => {
    session.agent.setModel('claude-opus-4-6-20250514');
    const result = internals(gw).handleCommand('/model', session);
    expect(result).toContain('claude-opus-4-6-20250514');
    expect(result).toContain('Current model');
  });

  it('/model with valid arg changes model', () => {
    const spy = vi.spyOn(session.agent, 'setModel');
    const result = internals(gw).handleCommand('/model haiku', session);
    expect(result).toContain('Model changed to');
    expect(result).toContain('haiku');
    expect(spy).toHaveBeenCalledWith('haiku');
  });

  it('/model with invalid arg returns error', () => {
    const result = internals(gw).handleCommand('/model bad-model', session);
    expect(result).toContain('Unknown model');
    expect(result).toContain('bad-model');
  });

  it('returns null for non-command text', () => {
    expect(internals(gw).handleCommand('hello world', session)).toBeNull();
    expect(internals(gw).handleCommand('What is /help?', session)).toBeNull();
    expect(internals(gw).handleCommand('just chatting', session)).toBeNull();
  });
});

describe('SlackGateway session management', () => {
  let gw: SlackGateway;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    gw = createGateway();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a new session for a new user', () => {
    const session = internals(gw).getOrCreateSession('U100');
    expect(session).not.toBeNull();
    expect(internals(gw).sessions.size).toBe(1);
    expect(internals(gw).sessions.has('U100')).toBe(true);
  });

  it('returns the same session for repeated calls within TTL', () => {
    const s1 = internals(gw).getOrCreateSession('U100');
    const s2 = internals(gw).getOrCreateSession('U100');
    expect(s1).toBe(s2);
    expect(internals(gw).sessions.size).toBe(1);
  });

  it('expires stale sessions past the 30-minute TTL', () => {
    const s1 = internals(gw).getOrCreateSession('U100');
    expect(s1).not.toBeNull();
    const disconnectSpy = vi.spyOn(s1!.agent as MockAgent, 'disconnect');

    // Advance past the 30-minute TTL
    vi.advanceTimersByTime(31 * 60 * 1000);

    const s2 = internals(gw).getOrCreateSession('U100');
    expect(s2).not.toBeNull();
    // Should be a different session
    expect(s2).not.toBe(s1);
    expect(disconnectSpy).toHaveBeenCalled();
  });

  it('returns null when session limit is reached and all sessions are processing', () => {
    // Fill up to the 400 session limit
    for (let i = 0; i < 400; i++) {
      const session = internals(gw).getOrCreateSession(`U${i}`);
      // Mark as processing so eviction cannot remove them
      if (session) {
        (session as { processing: boolean }).processing = true;
      }
    }

    expect(internals(gw).sessions.size).toBe(400);
    const result = internals(gw).getOrCreateSession('U999');
    expect(result).toBeNull();
  });

  it('evicts oldest idle session when limit is reached', () => {
    // Create two sessions with different activity times
    const s1 = internals(gw).getOrCreateSession('U-old');
    expect(s1).not.toBeNull();
    (s1 as { lastActivity: number }).lastActivity = Date.now() - 1000;

    vi.advanceTimersByTime(500);

    const s2 = internals(gw).getOrCreateSession('U-new');
    expect(s2).not.toBeNull();

    // Now fill up to 400
    for (let i = 0; i < 398; i++) {
      internals(gw).getOrCreateSession(`U-fill-${i}`);
    }
    expect(internals(gw).sessions.size).toBe(400);

    // The next create should evict U-old (oldest, non-processing)
    const s3 = internals(gw).getOrCreateSession('U-overflow');
    expect(s3).not.toBeNull();
    expect(internals(gw).sessions.has('U-old')).toBe(false);
    expect(internals(gw).sessions.has('U-overflow')).toBe(true);
  });

  it('evictOldestSessions skips sessions that are processing', () => {
    const s1 = internals(gw).getOrCreateSession('U1');
    const s2 = internals(gw).getOrCreateSession('U2');
    expect(s1).not.toBeNull();
    expect(s2).not.toBeNull();

    // Make U1 older but processing
    (s1 as { lastActivity: number }).lastActivity = Date.now() - 10_000;
    (s1 as { processing: boolean }).processing = true;
    // Make U2 slightly newer but idle
    (s2 as { lastActivity: number }).lastActivity = Date.now() - 5_000;

    internals(gw).evictOldestSessions(1);

    // U1 should still exist (processing), U2 should be evicted (oldest idle)
    expect(internals(gw).sessions.has('U1')).toBe(true);
    expect(internals(gw).sessions.has('U2')).toBe(false);
  });

  it('cleanupSessions removes expired sessions and leaves active ones', () => {
    const s1 = internals(gw).getOrCreateSession('U-expired');
    const s2 = internals(gw).getOrCreateSession('U-active');
    expect(s1).not.toBeNull();
    expect(s2).not.toBeNull();

    // Make s1 expired
    (s1 as { lastActivity: number }).lastActivity = Date.now() - 31 * 60 * 1000;
    // Keep s2 fresh
    (s2 as { lastActivity: number }).lastActivity = Date.now();

    internals(gw).cleanupSessions();

    expect(internals(gw).sessions.has('U-expired')).toBe(false);
    expect(internals(gw).sessions.has('U-active')).toBe(true);
  });

  it('cleanupSessions does not remove expired session that is processing', () => {
    const s1 = internals(gw).getOrCreateSession('U-busy');
    expect(s1).not.toBeNull();
    (s1 as { lastActivity: number }).lastActivity = Date.now() - 31 * 60 * 1000;
    (s1 as { processing: boolean }).processing = true;

    internals(gw).cleanupSessions();

    expect(internals(gw).sessions.has('U-busy')).toBe(true);
  });

  it('returns null when anthropicApiKey is not set', () => {
    internals(gw).anthropicApiKey = null;
    const result = internals(gw).getOrCreateSession('U1');
    expect(result).toBeNull();
  });
});

describe('SlackGateway thread tracking', () => {
  let gw: SlackGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    gw = createGateway();
  });

  it('getThreadKey creates channel:threadTs composite key', () => {
    const key = internals(gw).getThreadKey('C123', '1234567890.000100');
    expect(key).toBe('C123:1234567890.000100');
  });

  it('markThreadActive stores thread in the map', () => {
    internals(gw).markThreadActive('C1', 'ts1');
    expect(internals(gw).activeChannelThreads.has('C1:ts1')).toBe(true);
  });

  it('isTrackedThread returns true for tracked threads', () => {
    internals(gw).markThreadActive('C1', 'ts1');
    expect(internals(gw).isTrackedThread('C1', 'ts1')).toBe(true);
  });

  it('isTrackedThread returns false for untracked threads', () => {
    expect(internals(gw).isTrackedThread('C1', 'ts-unknown')).toBe(false);
  });

  it('isTrackedThread returns false when threadTs is undefined', () => {
    internals(gw).markThreadActive('C1', 'ts1');
    expect(internals(gw).isTrackedThread('C1', undefined)).toBe(false);
  });

  it('cleanupSessions expires tracked threads past TTL', () => {
    vi.useFakeTimers();
    try {
      internals(gw).markThreadActive('C1', 'ts-old');

      // Advance time past TTL (30 min)
      vi.advanceTimersByTime(31 * 60 * 1000);

      internals(gw).markThreadActive('C1', 'ts-new');

      internals(gw).cleanupSessions();

      expect(internals(gw).activeChannelThreads.has('C1:ts-old')).toBe(false);
      expect(internals(gw).activeChannelThreads.has('C1:ts-new')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('SlackGateway allowList filtering', () => {
  it('blocks messages from users not in allowList', async () => {
    const gw = createGateway({ allowList: ['U-allowed'] });
    internals(gw).botUserId = null;

    await internals(gw).onMessage({
      text: 'hello',
      user: 'U-blocked',
      channel: 'D1',
      channel_type: 'im',
      ts: '100',
    });

    expect(internals(gw).sessions.size).toBe(0);
  });

  it('allows messages from users in the allowList', async () => {
    const gw = createGateway({ allowList: ['U-allowed'] });
    internals(gw).botUserId = null;

    await internals(gw).onMessage({
      text: 'hello',
      user: 'U-allowed',
      channel: 'D1',
      channel_type: 'im',
      ts: '100',
    });

    expect(internals(gw).sessions.size).toBe(1);
  });
});

describe('SlackGateway message filtering', () => {
  let gw: SlackGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    gw = createGateway();
    internals(gw).botUserId = 'B1';
  });

  it('skips bot messages (subtype bot_message)', async () => {
    await internals(gw).onMessage({
      text: 'bot says hi',
      user: 'U1',
      channel: 'D1',
      channel_type: 'im',
      ts: '100',
      subtype: 'bot_message',
    });
    expect(internals(gw).sessions.size).toBe(0);
  });

  it('skips messages with bot_id', async () => {
    await internals(gw).onMessage({
      text: 'bot says hi',
      user: 'U1',
      channel: 'D1',
      channel_type: 'im',
      ts: '100',
      bot_id: 'B123',
    });
    expect(internals(gw).sessions.size).toBe(0);
  });

  it('skips messages with empty text after mention stripping', async () => {
    await internals(gw).onMessage({
      text: '<@B1>',
      user: 'U1',
      channel: 'C1',
      channel_type: 'channel',
      ts: '100',
    });
    // After stripping the mention, text is empty -> ignored
    expect(internals(gw).sessions.size).toBe(0);
  });

  it('skips messages without user', async () => {
    await internals(gw).onMessage({
      text: 'hello',
      channel: 'D1',
      channel_type: 'im',
      ts: '100',
    });
    expect(internals(gw).sessions.size).toBe(0);
  });

  it('skips messages without channel', async () => {
    await internals(gw).onMessage({
      text: 'hello',
      user: 'U1',
      channel_type: 'im',
      ts: '100',
    });
    expect(internals(gw).sessions.size).toBe(0);
  });
});

describe('SlackGateway getHealth', () => {
  it('returns health snapshot', () => {
    const gw = createGateway();
    internals(gw).running = true;
    const health = gw.getHealth();
    expect(health).toEqual({
      running: true,
      connected: true,
      activeSessions: 0,
      model: 'claude-sonnet-4-6',
      orgId: 'org-test',
    });
  });

  it('reports disconnected when app is null', () => {
    const gw = createGateway();
    internals(gw).app = null;
    const health = gw.getHealth();
    expect(health.connected).toBe(false);
  });
});
