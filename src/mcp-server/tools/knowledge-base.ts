import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GraphQLClient } from 'graphql-request';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { executeQuery } from '../graphql-client.js';

const QDRANT_HOST = process.env.STATESET_KB_HOST || '';
const EMBEDDING_MODEL = 'text-embedding-ada-002';
const SIMILARITY_THRESHOLD = 0.95;

interface KBConfig {
  collection: string;
  apiKey: string;
  openaiApiKey: string;
}

async function fetchKBConfig(client: GraphQLClient, orgId: string): Promise<KBConfig> {
  const query = `query ($org_id: String!) {
    access_tokens(where: { org_id: { _eq: $org_id } }) {
      stateset_kb_collection
      stateset_kb_api_key
    }
  }`;
  const data = await executeQuery<{
    access_tokens: Array<{ stateset_kb_collection: string; stateset_kb_api_key: string }>;
  }>(client, query, { org_id: orgId });

  if (!data.access_tokens?.length) {
    throw new Error('Knowledge Base configuration not found for this organization');
  }

  const { stateset_kb_collection, stateset_kb_api_key } = data.access_tokens[0];
  if (!stateset_kb_collection || !stateset_kb_api_key) {
    throw new Error(
      'Knowledge Base not configured — missing collection or API key in access_tokens',
    );
  }

  const openaiApiKey = process.env.OPENAI_API_KEY || process.env.OPEN_AI || '';
  if (!openaiApiKey) {
    throw new Error('No OpenAI API key found. Set OPENAI_API_KEY environment variable.');
  }

  return { collection: stateset_kb_collection, apiKey: stateset_kb_api_key, openaiApiKey };
}

async function createEmbedding(text: string, config: KBConfig): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({ input: text, model: EMBEDDING_MODEL }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI embedding failed (${res.status}): ${err}`);
  }

  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  if (!json.data?.[0]?.embedding) {
    throw new Error('Invalid embedding response from OpenAI');
  }
  return json.data[0].embedding;
}

async function qdrantRequest(
  path: string,
  method: string,
  body: unknown,
  config: KBConfig,
): Promise<unknown> {
  if (!QDRANT_HOST) {
    throw new Error(
      'STATESET_KB_HOST environment variable is required for Knowledge Base operations.',
    );
  }
  const url = `${QDRANT_HOST}/collections/${config.collection}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'api-key': config.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Qdrant request failed (${res.status}): ${err}`);
  }

  return res.json();
}

export function registerKnowledgeBaseTools(
  server: McpServer,
  client: GraphQLClient,
  orgId: string,
) {
  server.tool(
    'kb_search',
    'Search the Knowledge Base using semantic similarity. Returns the most relevant entries for a given question.',
    {
      question: z.string().describe('The question or text to search for'),
      top_k: z.number().optional().describe('Number of results to return (default 5)'),
      score_threshold: z
        .number()
        .optional()
        .describe('Minimum similarity score 0-1 (default: no threshold)'),
    },
    async ({ question, top_k, score_threshold }) => {
      const config = await fetchKBConfig(client, orgId);
      const vector = await createEmbedding(question, config);

      const searchBody: Record<string, unknown> = {
        vector,
        limit: top_k ?? 5,
        with_payload: true,
      };
      if (score_threshold !== undefined) {
        searchBody.score_threshold = score_threshold;
      }

      const result = (await qdrantRequest('/points/search', 'POST', searchBody, config)) as {
        result: Array<{ id: string; score: number; payload: Record<string, unknown> }>;
      };

      const matches = result.result.map((point) => ({
        id: point.id,
        score: point.score,
        text: point.payload?.text,
        metadata: point.payload,
      }));

      const contexts = matches.map((m) => m.text).filter(Boolean);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ matches, contexts, collection: config.collection }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'kb_upsert',
    'Add or update knowledge in the Knowledge Base. Automatically deduplicates — if similar content exists (above similarity threshold), it updates the existing entry instead of creating a duplicate.',
    {
      knowledge: z.string().describe('The text content to store in the knowledge base'),
      metadata: z
        .record(z.unknown())
        .optional()
        .describe('Additional metadata (e.g. category, source, tags)'),
      similarity_threshold: z
        .number()
        .optional()
        .describe('Deduplication threshold 0-1 (default 0.95)'),
    },
    async ({ knowledge, metadata, similarity_threshold }) => {
      const config = await fetchKBConfig(client, orgId);
      const vector = await createEmbedding(knowledge, config);
      const threshold = similarity_threshold ?? SIMILARITY_THRESHOLD;

      // Search for similar existing content
      const searchResult = (await qdrantRequest(
        '/points/search',
        'POST',
        {
          vector,
          limit: 1,
          with_payload: true,
          score_threshold: threshold,
        },
        config,
      )) as { result: Array<{ id: string; score: number }> };

      let pointId: string;
      let action: string;

      if (searchResult.result?.length > 0 && searchResult.result[0].score >= threshold) {
        pointId = searchResult.result[0].id as string;
        action = 'updated';
      } else {
        pointId = uuidv4();
        action = 'created';
      }

      await qdrantRequest(
        '/points?wait=true',
        'PUT',
        {
          points: [
            {
              id: pointId,
              vector,
              payload: {
                text: knowledge,
                org_id: orgId,
                [action === 'created' ? 'created_at' : 'updated_at']: new Date().toISOString(),
                ...(metadata || {}),
              },
            },
          ],
        },
        config,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                status: `${action}_stateset_kb_vector`,
                action,
                point_id: pointId,
                collection: config.collection,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'kb_update',
    'Update an existing Knowledge Base entry by ID, or find the closest match and update it',
    {
      knowledge: z.string().describe('Updated text content'),
      point_id: z
        .string()
        .optional()
        .describe('ID of the point to update (if omitted, finds closest match)'),
      metadata: z.record(z.unknown()).optional().describe('Updated metadata'),
    },
    async ({ knowledge, point_id, metadata }) => {
      const config = await fetchKBConfig(client, orgId);
      const vector = await createEmbedding(knowledge, config);

      let targetId = point_id;

      if (!targetId) {
        const searchResult = (await qdrantRequest(
          '/points/search',
          'POST',
          {
            vector,
            limit: 1,
            with_payload: true,
          },
          config,
        )) as { result: Array<{ id: string }> };

        if (!searchResult.result?.length) {
          return {
            content: [{ type: 'text' as const, text: 'No matching entry found to update' }],
            isError: true,
          };
        }
        targetId = searchResult.result[0].id as string;
      }

      await qdrantRequest(
        '/points?wait=true',
        'PUT',
        {
          points: [
            {
              id: targetId,
              vector,
              payload: {
                text: knowledge,
                org_id: orgId,
                updated_at: new Date().toISOString(),
                ...(metadata || {}),
              },
            },
          ],
        },
        config,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                status: 'updated_stateset_kb_vector',
                point_id: targetId,
                collection: config.collection,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'kb_delete',
    'Delete one or more entries from the Knowledge Base by ID',
    {
      ids: z.array(z.string()).describe('Array of point IDs to delete'),
    },
    async ({ ids }) => {
      const config = await fetchKBConfig(client, orgId);

      await qdrantRequest(
        '/points/delete?wait=true',
        'POST',
        {
          points: ids,
        },
        config,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                status: 'deleted_stateset_kb_vector',
                deleted_ids: ids,
                collection: config.collection,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'kb_get_collection_info',
    'Get information about the Knowledge Base collection (point count, status, etc.)',
    {},
    async () => {
      const config = await fetchKBConfig(client, orgId);

      const url = `${QDRANT_HOST}/collections/${config.collection}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'api-key': config.apiKey,
        },
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Failed to get collection info (${res.status}): ${err}`);
      }

      const data = await res.json();
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ collection: config.collection, info: data }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'kb_scroll',
    'Browse Knowledge Base entries with optional filtering. Returns entries with their payloads.',
    {
      limit: z.number().optional().describe('Number of entries to return (default 10)'),
      offset: z.string().optional().describe('Pagination offset (point ID from previous scroll)'),
      filter: z
        .record(z.unknown())
        .optional()
        .describe('Qdrant filter object for metadata filtering'),
    },
    async ({ limit, offset, filter }) => {
      const config = await fetchKBConfig(client, orgId);

      const scrollBody: Record<string, unknown> = {
        limit: limit ?? 10,
        with_payload: true,
      };
      if (offset) {
        scrollBody.offset = offset;
      }
      if (filter) {
        scrollBody.filter = filter;
      }

      const result = (await qdrantRequest('/points/scroll', 'POST', scrollBody, config)) as {
        result: {
          points: Array<{ id: string; payload: Record<string, unknown> }>;
          next_page_offset: string | null;
        };
      };

      const entries = result.result.points.map((p) => ({
        id: p.id,
        text: p.payload?.text,
        metadata: p.payload,
      }));

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                entries,
                next_offset: result.result.next_page_offset,
                collection: config.collection,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
