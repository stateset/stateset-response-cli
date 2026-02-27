import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerMessageTools } from '../mcp-server/tools/messages.js';

const handlers: Record<string, (args: unknown) => Promise<unknown>> = {};

vi.mock('../mcp-server/graphql-client.js', () => ({
  executeQuery: vi.fn(),
}));

import { executeQuery } from '../mcp-server/graphql-client.js';

const executeQueryMock = vi.mocked(executeQuery);

describe('message MCP tools', () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(handlers).forEach((name) => {
      delete handlers[name];
    });
    registerMessageTools(mockServer as never, {} as never, 'org-123');
  });

  it('scopes list_messages to org_id', async () => {
    executeQueryMock.mockResolvedValueOnce({ message: [] });
    await handlers.list_messages({ chat_id: 'chat-1', limit: 10, offset: 0 });

    expect(executeQueryMock).toHaveBeenCalledTimes(1);
    const query = String(executeQueryMock.mock.calls[0][1]);
    const variables = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(query).toContain('org_id');
    expect(query).toContain('_and');
    expect(variables.org_id).toBe('org-123');
    expect(variables.chat_id).toBe('chat-1');
  });

  it('scopes get_message to org_id', async () => {
    executeQueryMock.mockResolvedValueOnce({ message: [] });
    await handlers.get_message({ id: 'msg-1' });

    const query = String(executeQueryMock.mock.calls[0][1]);
    const variables = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(query).toContain('org_id');
    expect(query).toContain('_and');
    expect(variables.org_id).toBe('org-123');
    expect(variables.id).toBe('msg-1');
  });

  it('scopes update_message to org_id', async () => {
    executeQueryMock.mockResolvedValueOnce({ update_message: { returning: [{ id: 'msg-1' }] } });
    await handlers.update_message({ id: 'msg-1', body: 'updated' });

    const query = String(executeQueryMock.mock.calls[0][1]);
    const variables = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(query).toContain('org_id');
    expect(query).toContain('_and');
    expect(variables.org_id).toBe('org-123');
    expect(variables.id).toBe('msg-1');
  });

  it('scopes delete_message to org_id', async () => {
    executeQueryMock.mockResolvedValueOnce({ delete_message: { affected_rows: 1 } });
    await handlers.delete_message({ id: 'msg-1' });

    const query = String(executeQueryMock.mock.calls[0][1]);
    const variables = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(query).toContain('org_id');
    expect(query).toContain('_and');
    expect(variables.org_id).toBe('org-123');
    expect(variables.id).toBe('msg-1');
  });
});
