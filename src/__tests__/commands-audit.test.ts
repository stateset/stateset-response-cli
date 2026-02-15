import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleAuditCommand } from '../cli/commands-audit.js';
import type { ChatContext, ToolAuditEntry } from '../cli/types.js';

const mockAuditEntries: ToolAuditEntry[] = [];

vi.mock('../cli/audit.js', () => ({
  readToolAudit: vi.fn(() => mockAuditEntries),
  getToolAuditPath: vi.fn((id: string) => `/tmp/.stateset/sessions/${id}/tool-audit.jsonl`),
}));

vi.mock('../session.js', () => ({
  sanitizeSessionId: vi.fn((id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '')),
}));

function createMockCtx(overrides: Partial<ChatContext> = {}): ChatContext {
  return {
    rl: { prompt: vi.fn(), pause: vi.fn(), resume: vi.fn() } as any,
    sessionId: 'test-session',
    auditEnabled: false,
    auditIncludeExcerpt: false,
    ...overrides,
  } as unknown as ChatContext;
}

describe('handleAuditCommand', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.STATESET_TOOL_AUDIT = process.env.STATESET_TOOL_AUDIT;
    savedEnv.STATESET_TOOL_AUDIT_DETAIL = process.env.STATESET_TOOL_AUDIT_DETAIL;
    mockAuditEntries.length = 0;
  });

  afterEach(() => {
    process.env.STATESET_TOOL_AUDIT = savedEnv.STATESET_TOOL_AUDIT;
    process.env.STATESET_TOOL_AUDIT_DETAIL = savedEnv.STATESET_TOOL_AUDIT_DETAIL;
    vi.restoreAllMocks();
  });

  it('returns null for non-audit commands', async () => {
    const ctx = createMockCtx();
    expect(await handleAuditCommand('/help', ctx)).toBeNull();
    expect(await handleAuditCommand('/apply on', ctx)).toBeNull();
  });

  it('/audit shows current status', async () => {
    const ctx = createMockCtx({ auditEnabled: true, auditIncludeExcerpt: false });
    const result = await handleAuditCommand('/audit', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.rl.prompt).toHaveBeenCalled();
  });

  it('/audit on enables audit', async () => {
    const ctx = createMockCtx({ auditEnabled: false });
    const result = await handleAuditCommand('/audit on', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.auditEnabled).toBe(true);
    expect(process.env.STATESET_TOOL_AUDIT).toBe('true');
  });

  it('/audit off disables audit', async () => {
    const ctx = createMockCtx({ auditEnabled: true });
    const result = await handleAuditCommand('/audit off', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.auditEnabled).toBe(false);
    expect(process.env.STATESET_TOOL_AUDIT).toBe('false');
  });

  it('/audit on on enables audit with detail', async () => {
    const ctx = createMockCtx({ auditEnabled: false, auditIncludeExcerpt: false });
    const result = await handleAuditCommand('/audit on on', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.auditEnabled).toBe(true);
    expect(ctx.auditIncludeExcerpt).toBe(true);
  });

  it('/audit invalid arg shows warning', async () => {
    const ctx = createMockCtx();
    const result = await handleAuditCommand('/audit banana', ctx);
    expect(result).toEqual({ handled: true });
  });

  it('/audit-show with no entries shows message', async () => {
    const ctx = createMockCtx();
    const result = await handleAuditCommand('/audit-show', ctx);
    expect(result).toEqual({ handled: true });
  });

  it('/audit-show displays entries', async () => {
    mockAuditEntries.push(
      {
        ts: '2025-01-01T00:00:00Z',
        type: 'tool_call',
        session: 'test',
        name: 'shopify_get_order',
        isError: false,
      },
      {
        ts: '2025-01-01T00:01:00Z',
        type: 'tool_result',
        session: 'test',
        name: 'shopify_get_order',
        durationMs: 123,
        isError: false,
      },
    );
    const ctx = createMockCtx();
    const result = await handleAuditCommand('/audit-show', ctx);
    expect(result).toEqual({ handled: true });
  });

  it('/audit-show filters by tool=', async () => {
    mockAuditEntries.push(
      { ts: '2025-01-01T00:00:00Z', type: 'tool_call', session: 'test', name: 'shopify_get_order' },
      { ts: '2025-01-01T00:01:00Z', type: 'tool_call', session: 'test', name: 'zendesk_create' },
    );
    const ctx = createMockCtx();
    const result = await handleAuditCommand('/audit-show tool=shopify', ctx);
    expect(result).toEqual({ handled: true });
  });

  it('/audit-show filters errors only', async () => {
    mockAuditEntries.push(
      {
        ts: '2025-01-01T00:00:00Z',
        type: 'tool_result',
        session: 'test',
        name: 'tool_a',
        isError: true,
      },
      {
        ts: '2025-01-01T00:01:00Z',
        type: 'tool_result',
        session: 'test',
        name: 'tool_b',
        isError: false,
      },
    );
    const ctx = createMockCtx();
    const result = await handleAuditCommand('/audit-show errors', ctx);
    expect(result).toEqual({ handled: true });
  });
});
