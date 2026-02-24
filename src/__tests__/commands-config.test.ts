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
      throw new Error(`Unknown model "${input}". Use sonnet, haiku, opus`);
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
      setMcpEnvOverrides: vi.fn(),
    } as any,
    cwd: '/tmp/test',
    rl: { prompt: vi.fn() } as any,
    sessionId: 'test-session',
    activeSkills: [],
    showUsage: false,
    allowApply: false,
    redactEmails: false,
    reconnectAgent: vi.fn(async () => {}),
    ...overrides,
  } as unknown as ChatContext;
}

describe('handleConfigCommand', () => {
  let originalStructuredMetadata: string | undefined;

  beforeEach(() => {
    vi.restoreAllMocks();
    originalStructuredMetadata = process.env.STATESET_MCP_STRUCTURED_TOOL_RESULTS;
  });

  afterEach(() => {
    if (originalStructuredMetadata === undefined) {
      delete process.env.STATESET_MCP_STRUCTURED_TOOL_RESULTS;
    } else {
      process.env.STATESET_MCP_STRUCTURED_TOOL_RESULTS = originalStructuredMetadata;
    }
  });

  it('returns unhandled for non-config commands', async () => {
    const ctx = createMockCtx();
    expect(await handleConfigCommand('/help', ctx)).toEqual({ handled: false });
    expect(await handleConfigCommand('/clear', ctx)).toEqual({ handled: false });
    expect(await handleConfigCommand('/applyx', ctx)).toEqual({ handled: false });
  });

  // /apply tests
  it('/apply shows current state when no arg given', async () => {
    const ctx = createMockCtx({ allowApply: true });
    const result = await handleConfigCommand('/apply', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.rl.prompt).toHaveBeenCalled();
  });

  it('/apply on enables writes', async () => {
    const ctx = createMockCtx({ allowApply: false });
    const result = await handleConfigCommand('/apply on', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.allowApply).toBe(true);
    expect(ctx.agent.setMcpEnvOverrides).toHaveBeenCalledWith({
      STATESET_ALLOW_APPLY: 'true',
      STATESET_REDACT: 'false',
      STATESET_MCP_STRUCTURED_TOOL_RESULTS: 'false',
    });
  });

  it('/apply off disables writes', async () => {
    const ctx = createMockCtx({ allowApply: true });
    const result = await handleConfigCommand('/apply off', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.allowApply).toBe(false);
    expect(ctx.agent.setMcpEnvOverrides).toHaveBeenCalledWith({
      STATESET_ALLOW_APPLY: 'false',
      STATESET_REDACT: 'false',
      STATESET_MCP_STRUCTURED_TOOL_RESULTS: 'false',
    });
  });

  it('/apply with invalid arg shows warning', async () => {
    const ctx = createMockCtx();
    const result = await handleConfigCommand('/apply banana', ctx);
    expect(result).toEqual({ handled: true });
  });

  it('/apply on when already enabled shows already-enabled message', async () => {
    const ctx = createMockCtx({ allowApply: true });
    const result = await handleConfigCommand('/apply on', ctx);
    expect(result).toEqual({ handled: true });
    // reconnectAgent should NOT be called since state didn't change
    expect(ctx.reconnectAgent).not.toHaveBeenCalled();
  });

  it('/apply failure restores previous value and returns handled', async () => {
    const reconnectAgent = vi.fn(async () => {
      throw new Error('network down');
    });
    const setSystemPrompt = vi.fn();
    const setMcpEnvOverrides = vi.fn();
    const ctx = createMockCtx({
      reconnectAgent,
      agent: {
        getModel: vi.fn(() => 'claude-sonnet-4-6-20250514'),
        setModel: vi.fn(),
        setSystemPrompt,
        setMcpEnvOverrides,
      } as any,
      allowApply: false,
      redactEmails: false,
    });

    const result = await handleConfigCommand('/apply on', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.allowApply).toBe(false);
    expect(reconnectAgent).toHaveBeenCalled();
    expect(setMcpEnvOverrides).toHaveBeenLastCalledWith({
      STATESET_ALLOW_APPLY: 'false',
      STATESET_REDACT: 'false',
      STATESET_MCP_STRUCTURED_TOOL_RESULTS: 'false',
    });
    expect(setSystemPrompt).not.toHaveBeenCalled();
  });

  // /redact tests
  it('/redact on enables redaction', async () => {
    const ctx = createMockCtx({ redactEmails: false });
    const result = await handleConfigCommand('/redact on', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.redactEmails).toBe(true);
    expect(ctx.agent.setMcpEnvOverrides).toHaveBeenCalledWith({
      STATESET_ALLOW_APPLY: 'false',
      STATESET_REDACT: 'true',
      STATESET_MCP_STRUCTURED_TOOL_RESULTS: 'false',
    });
  });

  it('/redact failure restores previous value and returns handled', async () => {
    const reconnectAgent = vi.fn(async () => {
      throw new Error('network down');
    });
    const setSystemPrompt = vi.fn();
    const setMcpEnvOverrides = vi.fn();
    const ctx = createMockCtx({
      reconnectAgent,
      agent: {
        getModel: vi.fn(() => 'claude-sonnet-4-6-20250514'),
        setModel: vi.fn(),
        setSystemPrompt,
        setMcpEnvOverrides,
      } as any,
      allowApply: false,
      redactEmails: false,
    });

    const result = await handleConfigCommand('/redact on', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.redactEmails).toBe(false);
    expect(reconnectAgent).toHaveBeenCalled();
    expect(setMcpEnvOverrides).toHaveBeenLastCalledWith({
      STATESET_ALLOW_APPLY: 'false',
      STATESET_REDACT: 'false',
      STATESET_MCP_STRUCTURED_TOOL_RESULTS: 'false',
    });
    expect(setSystemPrompt).not.toHaveBeenCalled();
  });

  it('/redact off disables redaction', async () => {
    const ctx = createMockCtx({ redactEmails: true });
    const result = await handleConfigCommand('/redact off', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.redactEmails).toBe(false);
    expect(ctx.agent.setMcpEnvOverrides).toHaveBeenCalledWith({
      STATESET_ALLOW_APPLY: 'false',
      STATESET_REDACT: 'false',
      STATESET_MCP_STRUCTURED_TOOL_RESULTS: 'false',
    });
  });

  // /agentic tests
  it('/agentic shows current state when no arg given', async () => {
    process.env.STATESET_MCP_STRUCTURED_TOOL_RESULTS = 'true';
    const ctx = createMockCtx();
    const result = await handleConfigCommand('/agentic', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.rl.prompt).toHaveBeenCalled();
  });

  it('/agentic on enables structured tool results', async () => {
    process.env.STATESET_MCP_STRUCTURED_TOOL_RESULTS = 'false';
    const ctx = createMockCtx();
    const result = await handleConfigCommand('/agentic on', ctx);
    expect(result).toEqual({ handled: true });
    expect(process.env.STATESET_MCP_STRUCTURED_TOOL_RESULTS).toBe('true');
    expect(ctx.agent.setMcpEnvOverrides).toHaveBeenCalledWith({
      STATESET_ALLOW_APPLY: 'false',
      STATESET_REDACT: 'false',
      STATESET_MCP_STRUCTURED_TOOL_RESULTS: 'true',
    });
  });

  it('/agentic off disables structured tool results', async () => {
    process.env.STATESET_MCP_STRUCTURED_TOOL_RESULTS = 'true';
    const ctx = createMockCtx();
    const result = await handleConfigCommand('/agentic off', ctx);
    expect(result).toEqual({ handled: true });
    expect(process.env.STATESET_MCP_STRUCTURED_TOOL_RESULTS).toBe('false');
    expect(ctx.agent.setMcpEnvOverrides).toHaveBeenCalledWith({
      STATESET_ALLOW_APPLY: 'false',
      STATESET_REDACT: 'false',
      STATESET_MCP_STRUCTURED_TOOL_RESULTS: 'false',
    });
  });

  it('/agentic with invalid arg shows warning', async () => {
    process.env.STATESET_MCP_STRUCTURED_TOOL_RESULTS = 'false';
    const ctx = createMockCtx();
    const result = await handleConfigCommand('/agentic maybe', ctx);
    expect(result).toEqual({ handled: true });
    expect(process.env.STATESET_MCP_STRUCTURED_TOOL_RESULTS).toBe('false');
  });

  it('/agentic on when already enabled shows already-enabled message', async () => {
    process.env.STATESET_MCP_STRUCTURED_TOOL_RESULTS = 'true';
    const ctx = createMockCtx();
    const result = await handleConfigCommand('/agentic on', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.reconnectAgent).not.toHaveBeenCalled();
  });

  it('/agentic failure restores previous value and returns handled', async () => {
    const reconnectAgent = vi.fn(async () => {
      throw new Error('network down');
    });
    const setSystemPrompt = vi.fn();
    const setMcpEnvOverrides = vi.fn();
    const ctx = createMockCtx({
      reconnectAgent,
      agent: {
        getModel: vi.fn(() => 'claude-sonnet-4-6-20250514'),
        setModel: vi.fn(),
        setSystemPrompt,
        setMcpEnvOverrides,
      } as any,
    });

    process.env.STATESET_MCP_STRUCTURED_TOOL_RESULTS = 'false';
    const result = await handleConfigCommand('/agentic on', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.reconnectAgent).toHaveBeenCalled();
    expect(process.env.STATESET_MCP_STRUCTURED_TOOL_RESULTS).toBe('false');
    expect(setMcpEnvOverrides).toHaveBeenLastCalledWith({
      STATESET_ALLOW_APPLY: 'false',
      STATESET_REDACT: 'false',
      STATESET_MCP_STRUCTURED_TOOL_RESULTS: 'false',
    });
    expect(setSystemPrompt).not.toHaveBeenCalled();
  });

  // /usage tests
  it('/usage on enables usage summaries', async () => {
    const ctx = createMockCtx({ showUsage: false });
    const result = await handleConfigCommand('/usage on', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.showUsage).toBe(true);
  });

  it('/usage off disables usage summaries', async () => {
    const ctx = createMockCtx({ showUsage: true });
    const result = await handleConfigCommand('/usage off', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.showUsage).toBe(false);
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
