import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../mcp-server/graphql-client.js', () => ({
  executeQuery: vi.fn(),
}));

import { executeQuery } from '../mcp-server/graphql-client.js';
import { registerWebhookTools } from '../mcp-server/tools/webhooks.js';

const executeQueryMock = vi.mocked(executeQuery);
const ORG_ID = 'org-test-123';
const WEBHOOK_ID = '00000000-0000-0000-0000-000000000123';

function buildMockServer() {
  const handlers: Record<string, (args: unknown) => Promise<unknown>> = {};
  const mockServer = {
    tool: vi.fn(
      (
        name: string,
        _desc: string,
        _schema: unknown,
        handler: (args: unknown) => Promise<unknown>,
      ) => {
        handlers[name] = handler;
      },
    ),
  };
  return { mockServer, handlers };
}

function parseResult(result: unknown): unknown {
  const content = (result as { content: Array<{ text: string }> }).content;
  return JSON.parse(content[0].text);
}

function extractText(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text;
}

function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

describe('webhook MCP tools', () => {
  let handlers: Record<string, (args: unknown) => Promise<unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const ctx = buildMockServer();
    handlers = ctx.handlers;
    registerWebhookTools(ctx.mockServer as never, {} as never, ORG_ID);
  });

  it('list_webhooks scopes to org_id with default pagination', async () => {
    executeQueryMock.mockResolvedValueOnce({ webhooks: [{ id: WEBHOOK_ID }] });
    await handlers.list_webhooks({});

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.where).toEqual({ org_id: { _eq: ORG_ID } });
    expect(vars.limit).toBe(100);
    expect(vars.offset).toBe(0);
  });

  it('get_webhook scopes to org_id and returns the row', async () => {
    executeQueryMock.mockResolvedValueOnce({
      webhooks: [{ id: WEBHOOK_ID, url: 'https://x.test' }],
    });
    const result = await handlers.get_webhook({ id: WEBHOOK_ID });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.id).toBe(WEBHOOK_ID);
    expect(vars.org_id).toBe(ORG_ID);
    expect(parseResult(result)).toMatchObject({ id: WEBHOOK_ID });
  });

  it('get_webhook returns error when missing', async () => {
    executeQueryMock.mockResolvedValueOnce({ webhooks: [] });
    const result = await handlers.get_webhook({ id: WEBHOOK_ID });

    expect(isError(result)).toBe(true);
    expect(extractText(result)).toBe('Webhook not found');
  });

  it('create_webhook stamps org_id, secret, and active flag', async () => {
    executeQueryMock.mockResolvedValueOnce({
      insert_webhooks_one: { id: WEBHOOK_ID, url: 'https://example.com/hook' },
    });
    await handlers.create_webhook({
      url: 'https://example.com/hook',
      events: ['response.created', 'response.created', 'invalid.event'],
      is_active: false,
    });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    const object = vars.object as Record<string, unknown>;
    expect(object.org_id).toBe(ORG_ID);
    expect(object.url).toBe('https://example.com/hook');
    expect(object.events).toEqual(['response.created']);
    expect(object.is_active).toBe(false);
    expect(String(object.secret)).toMatch(/^whsec_/);
  });

  it('create_webhook rejects when no valid events remain', async () => {
    const result = await handlers.create_webhook({
      url: 'https://example.com/hook',
      events: ['invalid.event'],
    });

    expect(isError(result)).toBe(true);
    expect(extractText(result)).toContain('At least one valid event required');
  });

  it('update_webhook strips undefined values and adds updated_at', async () => {
    executeQueryMock.mockResolvedValueOnce({
      update_webhooks: { returning: [{ id: WEBHOOK_ID }] },
    });
    await handlers.update_webhook({
      id: WEBHOOK_ID,
      url: 'https://example.com/updated',
      is_active: true,
    });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.id).toBe(WEBHOOK_ID);
    expect(vars.org_id).toBe(ORG_ID);
    const set = vars.set as Record<string, unknown>;
    expect(set.url).toBe('https://example.com/updated');
    expect(set.is_active).toBe(true);
    expect(set).toHaveProperty('updated_at');
    expect(set).not.toHaveProperty('events');
  });

  it('delete_webhook scopes to org_id and returns deleted payload', async () => {
    executeQueryMock.mockResolvedValueOnce({
      delete_webhooks: { returning: [{ id: WEBHOOK_ID }] },
    });
    const result = await handlers.delete_webhook({ id: WEBHOOK_ID });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.id).toBe(WEBHOOK_ID);
    expect(vars.org_id).toBe(ORG_ID);
    expect(parseResult(result)).toEqual({ deleted: { id: WEBHOOK_ID } });
  });

  it('list_webhook_deliveries scopes to org_id and optional webhook id', async () => {
    executeQueryMock.mockResolvedValueOnce({
      webhook_deliveries: [{ id: 'delivery-1', webhook_id: WEBHOOK_ID }],
    });
    await handlers.list_webhook_deliveries({ webhook_id: WEBHOOK_ID, limit: 10, offset: 5 });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.where).toEqual({
      org_id: { _eq: ORG_ID },
      webhook_id: { _eq: WEBHOOK_ID },
    });
    expect(vars.limit).toBe(10);
    expect(vars.offset).toBe(5);
  });
});
