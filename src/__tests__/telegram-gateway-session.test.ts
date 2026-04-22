import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  getConfiguredModel: vi.fn(() => 'claude-sonnet-4-6'),
  resolveModelOrThrow: vi.fn((value: string) => {
    if (value === 'bad-model') throw new Error('Unknown model "' + value + '"');
    return value;
  }),
  formatUnknownModelError: vi.fn((value: string) => 'Unknown model "' + value + '"'),
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

class MockAgent {
  private model = 'claude-sonnet-4-6';
  private history: string[] = [];

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async chat(msg: string): Promise<string> {
    this.history.push(msg);
    return 'echo: ' + msg;
  }
  clearHistory(): void {
    this.history = [];
  }
  getModel(): string {
    return this.model;
  }
  getHistoryLength(): number {
    return this.history.length;
  }
  setModel(model: string): void {
    this.model = model;
  }
}

vi.mock('../agent.js', () => ({
  StateSetAgent: vi.fn(() => new MockAgent()),
}));

import { TelegramGateway } from '../telegram/gateway.js';

type GatewayInternals = {
  anthropicApiKey: string | null;
  orgId: string;
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
  handleCommand: (text: string, session: { agent: MockAgent }) => string | null;
  getOrCreateSession: (userId: string) => {
    agent: MockAgent;
    lastActivity: number;
    processing: boolean;
    queue: unknown[];
  } | null;
  cleanupSessions: () => void;
};

function internals(gateway: TelegramGateway): GatewayInternals {
  return gateway as unknown as GatewayInternals;
}

function createGateway(opts?: { allowList?: string[] }): TelegramGateway {
  const gateway = new TelegramGateway(opts ?? {});
  const state = internals(gateway);
  state.anthropicApiKey = 'anthropic-example-key';
  state.orgId = 'org-test';
  return gateway;
}

describe('TelegramGateway handleCommand', () => {
  let gateway: TelegramGateway;
  let session: { agent: MockAgent; lastActivity: number; processing: boolean; queue: unknown[] };

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = createGateway();
    session = {
      agent: new MockAgent(),
      lastActivity: Date.now(),
      processing: false,
      queue: [],
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('/help returns help text', () => {
    const result = internals(gateway).handleCommand('/help', session);
    expect(result).toContain('StateSet Response Agent');
    expect(result).toContain('/reset');
    expect(result).toContain('/status');
  });

  it('/reset clears agent history', () => {
    const spy = vi.spyOn(session.agent, 'clearHistory');
    const result = internals(gateway).handleCommand('/reset', session);
    expect(result).toBe('Conversation history cleared.');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('/status reports org, model, and active sessions', () => {
    internals(gateway).sessions.set('123', session as never);
    session.agent.setModel('claude-haiku-4-5-20251001');

    const result = internals(gateway).handleCommand('/status', session);
    expect(result).toContain('org-test');
    expect(result).toContain('claude-haiku-4-5-20251001');
    expect(result).toContain('Active sessions: 1');
  });

  it('/model without arg shows current model', () => {
    session.agent.setModel('claude-opus-4-7');
    const result = internals(gateway).handleCommand('/model', session);
    expect(result).toContain('Current model');
    expect(result).toContain('claude-opus-4-7');
  });

  it('/model with valid arg changes model', () => {
    const spy = vi.spyOn(session.agent, 'setModel');
    const result = internals(gateway).handleCommand('/model haiku', session);
    expect(result).toContain('Model changed to: haiku');
    expect(spy).toHaveBeenCalledWith('haiku');
  });

  it('/model with invalid arg returns error', () => {
    const result = internals(gateway).handleCommand('/model bad-model', session);
    expect(result).toContain('Unknown model');
  });
});

describe('TelegramGateway session management', () => {
  let gateway: TelegramGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = createGateway();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates and reuses sessions by user id', () => {
    const first = internals(gateway).getOrCreateSession('123');
    const second = internals(gateway).getOrCreateSession('123');
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });

  it('cleans up expired idle sessions', () => {
    const state = internals(gateway);
    state.sessions.set('123', {
      agent: new MockAgent(),
      lastActivity: Date.now() - 31 * 60 * 1000,
      processing: false,
      queue: [],
    } as never);

    state.cleanupSessions();
    expect(state.sessions.size).toBe(0);
  });

  it('returns a health snapshot', () => {
    const health = gateway.getHealth();
    expect(health).toEqual({
      running: false,
      connected: false,
      activeSessions: 0,
      model: 'claude-sonnet-4-6',
      orgId: 'org-test',
      pollFailures: 0,
    });
  });
});
