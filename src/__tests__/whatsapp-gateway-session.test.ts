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
    anthropicApiKey: 'anthropic-example-key',
  })),
}));

vi.mock('../whatsapp/session.js', () => ({
  createWhatsAppSocket: vi.fn(),
  waitForConnection: vi.fn(),
  extractText: vi.fn(),
  jidToPhone: vi.fn((jid: string) => jid.split('@')[0]),
  isGroup: vi.fn((jid: string) => jid.endsWith('@g.us')),
  getStatusCode: vi.fn(() => 0),
  getDisconnectReason: vi.fn(async () => ({ loggedOut: 401 })),
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

import { WhatsAppGateway } from '../whatsapp/gateway.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type GatewayInternals = {
  anthropicApiKey: string | null;
  orgId: string;
  running: boolean;
  model: string;
  ownJid: string | null;
  ownPhone: string | null;
  selfChatOnly: boolean;
  allowList: Set<string> | null;
  allowGroups: boolean;
  reconnectAttempts: number;
  reconnectScheduled: boolean;
  connecting: boolean;
  sock: unknown;
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
  sentMessageIds: Map<string, number>;
  handleCommand: (text: string, session: { agent: MockAgent }) => string | null;
  getOrCreateSession: (
    jid: string,
  ) => { agent: MockAgent; lastActivity: number; processing: boolean; queue: unknown[] } | null;
  evictOldestSessions: (limit?: number) => void;
  cleanupSessions: () => void;
  isSelfChat: (jid: string) => boolean;
  isSentByGateway: (messageId?: string) => boolean;
  rememberSentMessage: (messageId: string) => void;
  pruneSentMessageIds: () => void;
  isAgentMessage: (text: string) => boolean;
  decorateOutgoing: (text: string) => string;
  scheduleReconnect: () => Promise<void>;
};

function internals(gw: WhatsAppGateway): GatewayInternals {
  return gw as unknown as GatewayInternals;
}

function makeSession(
  overrides?: Partial<{
    model: string;
    lastActivity: number;
    processing: boolean;
  }>,
): { agent: MockAgent; lastActivity: number; processing: boolean; queue: unknown[] } {
  const agent = new MockAgent();
  if (overrides?.model) agent.setModel(overrides.model);
  return {
    agent,
    lastActivity: overrides?.lastActivity ?? Date.now(),
    processing: overrides?.processing ?? false,
    queue: [],
  };
}

function createGateway(opts?: {
  allowList?: string[];
  selfChatOnly?: boolean;
  allowGroups?: boolean;
}): WhatsAppGateway {
  const gw = new WhatsAppGateway(opts ?? {});
  const g = internals(gw);
  g.anthropicApiKey = 'anthropic-example-key';
  g.orgId = 'org-test';
  g.sock = {
    sendMessage: vi.fn().mockResolvedValue({ key: { id: 'msg-out-1' } }),
    sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    end: vi.fn(),
    ws: { readyState: 1 },
    ev: { on: vi.fn() },
  };
  return gw;
}

// ---------------------------------------------------------------------------
// Tests: handleCommand
// ---------------------------------------------------------------------------

describe('WhatsAppGateway handleCommand', () => {
  let gw: WhatsAppGateway;
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
    internals(gw).sessions.set('15551234567', session as never);
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

// ---------------------------------------------------------------------------
// Tests: session management
// ---------------------------------------------------------------------------

describe('WhatsAppGateway session management', () => {
  let gw: WhatsAppGateway;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    gw = createGateway();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a new session for a new JID', () => {
    const session = internals(gw).getOrCreateSession('15551234567@s.whatsapp.net');
    expect(session).not.toBeNull();
    expect(internals(gw).sessions.size).toBe(1);
    expect(internals(gw).sessions.has('15551234567')).toBe(true);
  });

  it('returns the same session for repeated calls within TTL', () => {
    const s1 = internals(gw).getOrCreateSession('15551234567@s.whatsapp.net');
    const s2 = internals(gw).getOrCreateSession('15551234567@s.whatsapp.net');
    expect(s1).toBe(s2);
    expect(internals(gw).sessions.size).toBe(1);
  });

  it('expires stale sessions past the 30-minute TTL', () => {
    const s1 = internals(gw).getOrCreateSession('15551234567@s.whatsapp.net');
    expect(s1).not.toBeNull();
    const disconnectSpy = vi.spyOn(s1!.agent as MockAgent, 'disconnect');

    // Advance past the 30-minute TTL
    vi.advanceTimersByTime(31 * 60 * 1000);

    const s2 = internals(gw).getOrCreateSession('15551234567@s.whatsapp.net');
    expect(s2).not.toBeNull();
    expect(s2).not.toBe(s1);
    expect(disconnectSpy).toHaveBeenCalled();
  });

  it('returns null when session limit is reached and all sessions are processing', () => {
    for (let i = 0; i < 400; i++) {
      const session = internals(gw).getOrCreateSession(`${1000000 + i}@s.whatsapp.net`);
      if (session) {
        (session as { processing: boolean }).processing = true;
      }
    }

    expect(internals(gw).sessions.size).toBe(400);
    const result = internals(gw).getOrCreateSession('9999999@s.whatsapp.net');
    expect(result).toBeNull();
  });

  it('evicts oldest idle session when limit is reached', () => {
    const s1 = internals(gw).getOrCreateSession('1000000@s.whatsapp.net');
    expect(s1).not.toBeNull();
    (s1 as { lastActivity: number }).lastActivity = Date.now() - 1000;

    vi.advanceTimersByTime(500);

    const s2 = internals(gw).getOrCreateSession('1000001@s.whatsapp.net');
    expect(s2).not.toBeNull();

    for (let i = 2; i < 400; i++) {
      internals(gw).getOrCreateSession(`${1000000 + i}@s.whatsapp.net`);
    }
    expect(internals(gw).sessions.size).toBe(400);

    const s3 = internals(gw).getOrCreateSession('9999999@s.whatsapp.net');
    expect(s3).not.toBeNull();
    expect(internals(gw).sessions.has('1000000')).toBe(false);
    expect(internals(gw).sessions.has('9999999')).toBe(true);
  });

  it('evictOldestSessions skips sessions that are processing', () => {
    const s1 = internals(gw).getOrCreateSession('1111111@s.whatsapp.net');
    const s2 = internals(gw).getOrCreateSession('2222222@s.whatsapp.net');
    expect(s1).not.toBeNull();
    expect(s2).not.toBeNull();

    // Make s1 older but processing
    (s1 as { lastActivity: number }).lastActivity = Date.now() - 10_000;
    (s1 as { processing: boolean }).processing = true;
    // Make s2 slightly newer but idle
    (s2 as { lastActivity: number }).lastActivity = Date.now() - 5_000;

    internals(gw).evictOldestSessions(1);

    expect(internals(gw).sessions.has('1111111')).toBe(true);
    expect(internals(gw).sessions.has('2222222')).toBe(false);
  });

  it('cleanupSessions removes expired sessions and leaves active ones', () => {
    const s1 = internals(gw).getOrCreateSession('1111111@s.whatsapp.net');
    const s2 = internals(gw).getOrCreateSession('2222222@s.whatsapp.net');
    expect(s1).not.toBeNull();
    expect(s2).not.toBeNull();

    (s1 as { lastActivity: number }).lastActivity = Date.now() - 31 * 60 * 1000;
    (s2 as { lastActivity: number }).lastActivity = Date.now();

    internals(gw).cleanupSessions();

    expect(internals(gw).sessions.has('1111111')).toBe(false);
    expect(internals(gw).sessions.has('2222222')).toBe(true);
  });

  it('cleanupSessions does not remove expired session that is processing', () => {
    const s1 = internals(gw).getOrCreateSession('1111111@s.whatsapp.net');
    expect(s1).not.toBeNull();
    (s1 as { lastActivity: number }).lastActivity = Date.now() - 31 * 60 * 1000;
    (s1 as { processing: boolean }).processing = true;

    internals(gw).cleanupSessions();

    expect(internals(gw).sessions.has('1111111')).toBe(true);
  });

  it('returns null when anthropicApiKey is not set', () => {
    internals(gw).anthropicApiKey = null;
    const result = internals(gw).getOrCreateSession('1111111@s.whatsapp.net');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: allowList filtering
// ---------------------------------------------------------------------------

describe('WhatsAppGateway allowList', () => {
  it('normalizes phone numbers in the allowList (strips non-digits)', () => {
    const gw = createGateway({ allowList: ['+1-555-123-4567'] });
    // The constructor normalizes: '+1-555-123-4567' -> '15551234567'
    expect(internals(gw).allowList).not.toBeNull();
    expect(internals(gw).allowList!.has('15551234567')).toBe(true);
  });

  it('stores null when no allowList is provided', () => {
    const gw = createGateway();
    expect(internals(gw).allowList).toBeNull();
  });

  it('stores null for empty allowList', () => {
    const gw = createGateway({ allowList: [] });
    expect(internals(gw).allowList).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: self-chat detection
// ---------------------------------------------------------------------------

describe('WhatsAppGateway isSelfChat', () => {
  let gw: WhatsAppGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    gw = createGateway();
  });

  it('returns true when JID matches own phone number', () => {
    internals(gw).ownPhone = '15551234567';
    // jidToPhone mock: '15551234567@s.whatsapp.net'.split('@')[0] => '15551234567'
    // normalizePhone strips non-digits => '15551234567'
    expect(internals(gw).isSelfChat('15551234567@s.whatsapp.net')).toBe(true);
  });

  it('returns false when JID does not match own phone number', () => {
    internals(gw).ownPhone = '15551234567';
    expect(internals(gw).isSelfChat('19998887777@s.whatsapp.net')).toBe(false);
  });

  it('returns false when ownPhone is null (not yet connected)', () => {
    internals(gw).ownPhone = null;
    expect(internals(gw).isSelfChat('15551234567@s.whatsapp.net')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: message deduplication
// ---------------------------------------------------------------------------

describe('WhatsAppGateway message deduplication', () => {
  let gw: WhatsAppGateway;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    gw = createGateway();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rememberSentMessage stores the message ID with a timestamp', () => {
    internals(gw).rememberSentMessage('msg-1');
    expect(internals(gw).sentMessageIds.has('msg-1')).toBe(true);
    expect(internals(gw).sentMessageIds.get('msg-1')).toBe(Date.now());
  });

  it('isSentByGateway returns true for recently remembered messages', () => {
    internals(gw).rememberSentMessage('msg-1');
    expect(internals(gw).isSentByGateway('msg-1')).toBe(true);
  });

  it('isSentByGateway returns false for unknown message IDs', () => {
    expect(internals(gw).isSentByGateway('msg-unknown')).toBe(false);
  });

  it('isSentByGateway returns false for undefined message ID', () => {
    expect(internals(gw).isSentByGateway(undefined)).toBe(false);
  });

  it('isSentByGateway expires messages older than 10 minutes', () => {
    internals(gw).rememberSentMessage('msg-1');

    // Advance past the 10-minute sent message TTL
    vi.advanceTimersByTime(11 * 60 * 1000);

    expect(internals(gw).isSentByGateway('msg-1')).toBe(false);
    // Also cleans up the entry
    expect(internals(gw).sentMessageIds.has('msg-1')).toBe(false);
  });

  it('pruneSentMessageIds removes expired entries', () => {
    internals(gw).rememberSentMessage('msg-old');
    vi.advanceTimersByTime(11 * 60 * 1000);
    internals(gw).rememberSentMessage('msg-new');

    internals(gw).pruneSentMessageIds();

    expect(internals(gw).sentMessageIds.has('msg-old')).toBe(false);
    expect(internals(gw).sentMessageIds.has('msg-new')).toBe(true);
  });

  it('cleanupSessions also prunes sent message IDs', () => {
    internals(gw).rememberSentMessage('msg-old');
    vi.advanceTimersByTime(11 * 60 * 1000);
    internals(gw).rememberSentMessage('msg-new');

    internals(gw).cleanupSessions();

    expect(internals(gw).sentMessageIds.has('msg-old')).toBe(false);
    expect(internals(gw).sentMessageIds.has('msg-new')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: agent message detection and outgoing decoration
// ---------------------------------------------------------------------------

describe('WhatsAppGateway agent message tagging', () => {
  let gw: WhatsAppGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    gw = createGateway({ selfChatOnly: true });
  });

  it('isAgentMessage detects [agent] prefix (case-insensitive)', () => {
    expect(internals(gw).isAgentMessage('[agent] Hello!')).toBe(true);
    expect(internals(gw).isAgentMessage('[Agent] Hello!')).toBe(true);
    expect(internals(gw).isAgentMessage('[AGENT] Hello!')).toBe(true);
  });

  it('isAgentMessage allows leading whitespace', () => {
    expect(internals(gw).isAgentMessage('  [agent] Hello!')).toBe(true);
  });

  it('isAgentMessage returns false for non-agent messages', () => {
    expect(internals(gw).isAgentMessage('Hello world')).toBe(false);
    expect(internals(gw).isAgentMessage('Some [agent] text')).toBe(false);
  });

  it('decorateOutgoing prepends [agent] in selfChatOnly mode', () => {
    expect(internals(gw).decorateOutgoing('Hello')).toBe('[agent] Hello');
  });

  it('decorateOutgoing does not double-tag already tagged messages', () => {
    expect(internals(gw).decorateOutgoing('[agent] Hello')).toBe('[agent] Hello');
  });

  it('decorateOutgoing returns blank text as-is', () => {
    expect(internals(gw).decorateOutgoing('')).toBe('');
    expect(internals(gw).decorateOutgoing('   ')).toBe('   ');
  });

  it('decorateOutgoing does not tag when selfChatOnly is false', () => {
    const gw2 = createGateway({ selfChatOnly: false });
    expect(internals(gw2).decorateOutgoing('Hello')).toBe('Hello');
  });
});

// ---------------------------------------------------------------------------
// Tests: reconnect delay calculation
// ---------------------------------------------------------------------------

describe('WhatsAppGateway reconnect backoff', () => {
  let gw: WhatsAppGateway;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    gw = createGateway();
    internals(gw).running = true;
    // Ensure socket appears disconnected so scheduleReconnect proceeds
    internals(gw).sock = { ws: { readyState: 3 }, end: vi.fn(), ev: { on: vi.fn() } };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('increments reconnectAttempts on each call', async () => {
    // Stub connect to avoid actual connection logic
    const connectStub = vi.fn().mockResolvedValue(undefined);
    (gw as unknown as { connect: () => Promise<void> }).connect = connectStub;

    expect(internals(gw).reconnectAttempts).toBe(0);

    // Schedule reconnect — it will setTimeout internally, so we need to advance timers
    const p = internals(gw).scheduleReconnect();
    // Advance timers enough for the initial delay (~2000ms + jitter)
    vi.advanceTimersByTime(5000);
    await p;

    expect(internals(gw).reconnectAttempts).toBe(1);
    expect(connectStub).toHaveBeenCalledTimes(1);
  });

  it('stops reconnecting after max attempts (12)', async () => {
    const connectStub = vi.fn().mockResolvedValue(undefined);
    (gw as unknown as { connect: () => Promise<void> }).connect = connectStub;

    // Pre-set reconnect attempts to one below max
    internals(gw).reconnectAttempts = 12;

    const p = internals(gw).scheduleReconnect();
    vi.advanceTimersByTime(60_000);
    await p;

    // Should have set running to false, not called connect
    expect(internals(gw).running).toBe(false);
    expect(connectStub).not.toHaveBeenCalled();
  });

  it('does not reconnect when running is false', async () => {
    const connectStub = vi.fn().mockResolvedValue(undefined);
    (gw as unknown as { connect: () => Promise<void> }).connect = connectStub;
    internals(gw).running = false;

    await internals(gw).scheduleReconnect();

    expect(connectStub).not.toHaveBeenCalled();
  });

  it('does not reconnect when connecting is true', async () => {
    const connectStub = vi.fn().mockResolvedValue(undefined);
    (gw as unknown as { connect: () => Promise<void> }).connect = connectStub;
    internals(gw).connecting = true;

    await internals(gw).scheduleReconnect();

    expect(connectStub).not.toHaveBeenCalled();
  });

  it('does not reconnect when socket is already open (readyState 1)', async () => {
    const connectStub = vi.fn().mockResolvedValue(undefined);
    (gw as unknown as { connect: () => Promise<void> }).connect = connectStub;
    internals(gw).sock = { ws: { readyState: 1 }, end: vi.fn(), ev: { on: vi.fn() } };

    await internals(gw).scheduleReconnect();

    expect(connectStub).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent reconnect scheduling', async () => {
    const connectStub = vi.fn().mockResolvedValue(undefined);
    (gw as unknown as { connect: () => Promise<void> }).connect = connectStub;

    // Start first reconnect
    const p1 = internals(gw).scheduleReconnect();
    // The flag should be set
    expect(internals(gw).reconnectScheduled).toBe(true);

    // Try to schedule another one concurrently
    const p2 = internals(gw).scheduleReconnect();

    vi.advanceTimersByTime(60_000);
    await Promise.all([p1, p2]);

    // Connect should only have been called once
    expect(connectStub).toHaveBeenCalledTimes(1);
    expect(internals(gw).reconnectAttempts).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: selfChatOnly / allowGroups constructor logic
// ---------------------------------------------------------------------------

describe('WhatsAppGateway constructor options', () => {
  it('selfChatOnly forces allowGroups to false', () => {
    const gw = new WhatsAppGateway({ selfChatOnly: true, allowGroups: true });
    expect(internals(gw).selfChatOnly).toBe(true);
    expect(internals(gw).allowGroups).toBe(false);
  });

  it('allowGroups defaults to false', () => {
    const gw = new WhatsAppGateway({});
    expect(internals(gw).allowGroups).toBe(false);
  });

  it('allowGroups can be enabled when selfChatOnly is false', () => {
    const gw = new WhatsAppGateway({ allowGroups: true });
    expect(internals(gw).allowGroups).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: getHealth
// ---------------------------------------------------------------------------

describe('WhatsAppGateway getHealth', () => {
  it('returns a health snapshot with connected=true when socket is open', () => {
    const gw = createGateway();
    internals(gw).running = true;
    const health = gw.getHealth();
    expect(health).toEqual({
      running: true,
      connected: true,
      connecting: false,
      reconnectAttempts: 0,
      activeSessions: 0,
      model: 'claude-sonnet-4-6',
      orgId: 'org-test',
    });
  });

  it('reports connected=false when socket is null', () => {
    const gw = createGateway();
    internals(gw).sock = null;
    const health = gw.getHealth();
    expect(health.connected).toBe(false);
  });

  it('reports connecting state', () => {
    const gw = createGateway();
    internals(gw).connecting = true;
    expect(gw.getHealth().connecting).toBe(true);
  });
});
