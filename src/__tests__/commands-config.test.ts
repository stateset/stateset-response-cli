import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleConfigCommand } from '../cli/commands-config.js';
import type { ChatContext } from '../cli/types.js';

vi.mock('../memory.js', () => ({
  loadMemory: vi.fn(() => ''),
}));

vi.mock('../prompt.js', () => ({
  buildSystemPrompt: vi.fn(() => 'system prompt'),
}));

vi.mock('../config.js', () => ({
  getModelAliasText: () => 'sonnet, haiku, opus',
  resolveModelOrThrow: vi.fn((input: string) => {
    const map: Record<string, string> = {
      sonnet: 'claude-sonnet-4-6-20250514',
      haiku: 'claude-haiku-4-5-20251001',
      opus: 'claude-opus-4-6-20250514',
    };
    const resolved = map[input.toLowerCase()] ?? null;
    if (!resolved) {
      throw new Error(`Unknown model "${input}". Use sonnet, haiku, or opus`);
    }
    return resolved;
  }),
  formatUnknownModelError: (input: string) =>
    `Unknown model "${input}". Valid: sonnet, haiku, opus`,
}));

function createMockCtx(overrides: Partial<ChatContext> = {}): ChatContext {
  return {
    agent: {
      getModel: vi.fn(() => 'claude-sonnet-4-6-20250514'),
      setModel: vi.fn(),
      setSystemPrompt: vi.fn(),
    } as any,
    cwd: '/tmp/test',
    rl: { prompt: vi.fn() } as any,
    sessionId: 'test-session',
    activeSkills: [],
    showUsage: false,
    reconnectAgent: vi.fn(async () => {}),
    ...overrides,
  } as unknown as ChatContext;
}

describe('handleConfigCommand', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.STATESET_ALLOW_APPLY = process.env.STATESET_ALLOW_APPLY;
    savedEnv.STATESET_REDACT = process.env.STATESET_REDACT;
    savedEnv.STATESET_SHOW_USAGE = process.env.STATESET_SHOW_USAGE;
  });

  afterEach(() => {
    process.env.STATESET_ALLOW_APPLY = savedEnv.STATESET_ALLOW_APPLY;
    process.env.STATESET_REDACT = savedEnv.STATESET_REDACT;
    process.env.STATESET_SHOW_USAGE = savedEnv.STATESET_SHOW_USAGE;
    vi.restoreAllMocks();
  });

  it('returns unhandled for non-config commands', async () => {
    const ctx = createMockCtx();
    expect(await handleConfigCommand('/help', ctx)).toEqual({ handled: false });
    expect(await handleConfigCommand('/clear', ctx)).toEqual({ handled: false });
    expect(await handleConfigCommand('/applyx', ctx)).toEqual({ handled: false });
  });

  // /apply tests
  it('/apply shows current state when no arg given', async () => {
    process.env.STATESET_ALLOW_APPLY = 'true';
    const ctx = createMockCtx();
    const result = await handleConfigCommand('/apply', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.rl.prompt).toHaveBeenCalled();
  });

  it('/apply on enables writes', async () => {
    process.env.STATESET_ALLOW_APPLY = 'false';
    const ctx = createMockCtx();
    const result = await handleConfigCommand('/apply on', ctx);
    expect(result).toEqual({ handled: true });
    expect(process.env.STATESET_ALLOW_APPLY).toBe('true');
  });

  it('/apply off disables writes', async () => {
    process.env.STATESET_ALLOW_APPLY = 'true';
    const ctx = createMockCtx();
    const result = await handleConfigCommand('/apply off', ctx);
    expect(result).toEqual({ handled: true });
    expect(process.env.STATESET_ALLOW_APPLY).toBe('false');
  });

  it('/apply with invalid arg shows warning', async () => {
    const ctx = createMockCtx();
    const result = await handleConfigCommand('/apply banana', ctx);
    expect(result).toEqual({ handled: true });
  });

  it('/apply on when already enabled shows already-enabled message', async () => {
    process.env.STATESET_ALLOW_APPLY = 'true';
    const ctx = createMockCtx();
    const result = await handleConfigCommand('/apply on', ctx);
    expect(result).toEqual({ handled: true });
    // reconnectAgent should NOT be called since state didn't change
    expect(ctx.reconnectAgent).not.toHaveBeenCalled();
  });

  it('/apply failure restores previous value and returns handled', async () => {
    process.env.STATESET_ALLOW_APPLY = 'false';
    const reconnectAgent = vi.fn(async () => {
      throw new Error('network down');
    });
    const setSystemPrompt = vi.fn();
    const ctx = createMockCtx({
      reconnectAgent,
      agent: {
        getModel: vi.fn(() => 'claude-sonnet-4-6-20250514'),
        setModel: vi.fn(),
        setSystemPrompt,
      } as any,
    });

    const result = await handleConfigCommand('/apply on', ctx);
    expect(result).toEqual({ handled: true });
    expect(process.env.STATESET_ALLOW_APPLY).toBe('false');
    expect(reconnectAgent).toHaveBeenCalled();
    expect(setSystemPrompt).not.toHaveBeenCalled();
  });

  // /redact tests
  it('/redact on enables redaction', async () => {
    process.env.STATESET_REDACT = 'false';
    const ctx = createMockCtx();
    const result = await handleConfigCommand('/redact on', ctx);
    expect(result).toEqual({ handled: true });
    expect(process.env.STATESET_REDACT).toBe('true');
  });

  it('/redact failure restores previous value and returns handled', async () => {
    process.env.STATESET_REDACT = 'false';
    const reconnectAgent = vi.fn(async () => {
      throw new Error('network down');
    });
    const setSystemPrompt = vi.fn();
    const ctx = createMockCtx({
      reconnectAgent,
      agent: {
        getModel: vi.fn(() => 'claude-sonnet-4-6-20250514'),
        setModel: vi.fn(),
        setSystemPrompt,
      } as any,
    });

    const result = await handleConfigCommand('/redact on', ctx);
    expect(result).toEqual({ handled: true });
    expect(process.env.STATESET_REDACT).toBe('false');
    expect(reconnectAgent).toHaveBeenCalled();
    expect(setSystemPrompt).not.toHaveBeenCalled();
  });

  it('/redact off disables redaction', async () => {
    process.env.STATESET_REDACT = 'true';
    const ctx = createMockCtx();
    const result = await handleConfigCommand('/redact off', ctx);
    expect(result).toEqual({ handled: true });
    expect(process.env.STATESET_REDACT).toBe('false');
  });

  // /usage tests
  it('/usage on enables usage summaries', async () => {
    const ctx = createMockCtx({ showUsage: false });
    const result = await handleConfigCommand('/usage on', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.showUsage).toBe(true);
    expect(process.env.STATESET_SHOW_USAGE).toBe('true');
  });

  it('/usage off disables usage summaries', async () => {
    const ctx = createMockCtx({ showUsage: true });
    const result = await handleConfigCommand('/usage off', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.showUsage).toBe(false);
    expect(process.env.STATESET_SHOW_USAGE).toBe('false');
  });

  // /model tests
  it('/model shows current model', async () => {
    const ctx = createMockCtx();
    const result = await handleConfigCommand('/model', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.agent.getModel).toHaveBeenCalled();
  });

  it('/model sonnet switches model', async () => {
    const ctx = createMockCtx();
    const result = await handleConfigCommand('/model sonnet', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.agent.setModel).toHaveBeenCalledWith('claude-sonnet-4-6-20250514');
  });

  it('/model invalid shows warning', async () => {
    const ctx = createMockCtx();
    const result = await handleConfigCommand('/model gpt-4', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.agent.setModel).not.toHaveBeenCalled();
  });
});
