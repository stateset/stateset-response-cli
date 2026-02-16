import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerKnowledgeBaseTools } from '../mcp-server/tools/knowledge-base.js';

const mockToolHandlers: Record<string, (args: unknown) => Promise<unknown>> = {};

vi.mock('../mcp-server/graphql-client.js', () => ({
  executeQuery: vi.fn(),
}));

import { executeQuery } from '../mcp-server/graphql-client.js';

describe('knowledge base tools', () => {
  const mockServer = {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: any) => {
      mockToolHandlers[name] = handler;
    }),
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPEN_AI;
    delete process.env.STATESET_KB_HOST;
    for (const key of Object.keys(mockToolHandlers)) delete mockToolHandlers[key];

    vi.mocked(executeQuery).mockResolvedValue({
      access_tokens: [
        {
          stateset_kb_collection: '  my_collection  ',
          stateset_kb_api_key: '  qdrant-api-key  ',
        },
      ],
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }),
      text: async () => 'ok',
    }) as unknown as typeof fetch;
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock;
  });

  it('rejects invalid top_k values before contacting external services', async () => {
    process.env.OPENAI_API_KEY = 'sk-ant-key';
    process.env.STATESET_KB_HOST = 'http://localhost:6333';

    await registerKnowledgeBaseTools(mockServer as never, {} as never, 'org-1');
    const handler = mockToolHandlers.kb_search as (args: unknown) => Promise<unknown>;

    await expect(handler({ question: 'what is this', top_k: 0 })).rejects.toThrow(
      'top_k must be a positive integer',
    );
  });

  it('normalizes Qdrant host before building request URLs', async () => {
    process.env.OPENAI_API_KEY = '  sk-ant-key  ';
    process.env.STATESET_KB_HOST = 'http://localhost:6333///';

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'ok',
        json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'ok',
        json: async () => ({ result: [] }),
      }) as unknown as typeof fetch;

    (globalThis as { fetch: typeof fetch }).fetch = fetchMock;

    await registerKnowledgeBaseTools(mockServer as never, {} as never, 'org-1');
    const handler = mockToolHandlers.kb_search as (args: unknown) => Promise<unknown>;

    await handler({ question: 'query' });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:6333/collections/my_collection/points/search',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('rejects similarity thresholds outside 0-1', async () => {
    process.env.OPENAI_API_KEY = '  sk-ant-key  ';
    process.env.STATESET_KB_HOST = 'http://localhost:6333';

    await registerKnowledgeBaseTools(mockServer as never, {} as never, 'org-1');
    const handler = mockToolHandlers.kb_upsert as (args: unknown) => Promise<unknown>;

    await expect(handler({ knowledge: 'new facts', similarity_threshold: 2 })).rejects.toThrow(
      'similarity_threshold must be between 0 and 1',
    );
  });

  it('rejects whitespace-only questions', async () => {
    process.env.OPENAI_API_KEY = 'sk-ant-key';
    process.env.STATESET_KB_HOST = 'http://localhost:6333';

    await registerKnowledgeBaseTools(mockServer as never, {} as never, 'org-1');
    const handler = mockToolHandlers.kb_search as (args: unknown) => Promise<unknown>;

    await expect(handler({ question: '   ' })).rejects.toThrow('question cannot be empty');
  });

  it('rejects invalid knowledge base collection names from config', async () => {
    process.env.OPENAI_API_KEY = 'sk-ant-key';
    process.env.STATESET_KB_HOST = 'http://localhost:6333';
    vi.mocked(executeQuery).mockResolvedValue({
      access_tokens: [
        {
          stateset_kb_collection: 'bad/collection',
          stateset_kb_api_key: 'qdrant-api-key',
        },
      ],
    });

    await registerKnowledgeBaseTools(mockServer as never, {} as never, 'org-1');
    const handler = mockToolHandlers.kb_search as (args: unknown) => Promise<unknown>;

    await expect(handler({ question: 'query' })).rejects.toThrow(
      'Knowledge Base collection name contains invalid characters',
    );
  });

  it('rejects whitespace-only knowledge payload', async () => {
    process.env.OPENAI_API_KEY = 'sk-ant-key';
    process.env.STATESET_KB_HOST = 'http://localhost:6333';

    await registerKnowledgeBaseTools(mockServer as never, {} as never, 'org-1');
    const handler = mockToolHandlers.kb_upsert as (args: unknown) => Promise<unknown>;

    await expect(handler({ knowledge: '   ' })).rejects.toThrow('knowledge cannot be empty');
  });
});
