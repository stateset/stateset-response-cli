import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GraphQLClient } from 'graphql-request';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { executeQuery } from '../graphql-client.js';

const EMBEDDING_MODEL = 'text-embedding-ada-002';
const SIMILARITY_THRESHOLD = 0.95;
const MAX_KB_LIMIT = 1000;
const COLLECTION_NAME_RE = /^[A-Za-z0-9._-]+$/;

interface KBConfig {
  collection: string;
  apiKey: string;
  openaiApiKey: string;
}

function resolveOpenAIKey(): string {
  const explicit = process.env.OPENAI_API_KEY?.trim();
  if (explicit) return explicit;
  return process.env.OPEN_AI?.trim() || '';
}

function resolveQdrantHost(): string {
  return (process.env.STATESET_KB_HOST || '').trim().replace(/\/+$/, '');
}

function normalizeTopK(topK: number | undefined, defaultValue: number): number {
  if (topK === undefined) return defaultValue;
  if (!Number.isFinite(topK)) {
    throw new Error('top_k must be a finite integer');
  }
  if (topK <= 0 || !Number.isInteger(topK)) {
    throw new Error('top_k must be a positive integer');
  }
  if (topK > MAX_KB_LIMIT) {
    throw new Error(`top_k cannot exceed ${MAX_KB_LIMIT}`);
  }
  return topK;
}

function normalizeCollectionName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Knowledge Base collection name is required');
  }
  if (!COLLECTION_NAME_RE.test(trimmed)) {
    throw new Error('Knowledge Base collection name contains invalid characters');
  }
  if (trimmed.length > 255) {
    throw new Error('Knowledge Base collection name is too long');
  }
  return trimmed;
}

function normalizeTextValue(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} cannot be empty`);
  }
  return trimmed;
}

function normalizeScoreThreshold(value: number | undefined, field: string): number {
  if (value === undefined) return SIMILARITY_THRESHOLD;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${field} must be between 0 and 1`);
  }
  return value;
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

  const stateset_kb_collection = data.access_tokens[0].stateset_kb_collection?.trim();
  const stateset_kb_api_key = data.access_tokens[0].stateset_kb_api_key?.trim();
  if (!stateset_kb_collection || !stateset_kb_api_key) {
    throw new Error(
      'Knowledge Base not configured — missing collection or API key in access_tokens',
    );
  }

  const openaiApiKey = resolveOpenAIKey();
  if (!openaiApiKey) {
    throw new Error(
      'No OpenAI API key found. Set OPENAI_API_KEY (or OPEN_AI) environment variable.',
    );
  }

  const collection = normalizeCollectionName(stateset_kb_collection);

  return { collection, apiKey: stateset_kb_api_key, openaiApiKey };
}

function getCollectionPath(collection: string): string {
  return encodeURIComponent(collection);
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
  const host = resolveQdrantHost();
  if (!host) {
    throw new Error(
      'STATESET_KB_HOST environment variable is required for Knowledge Base operations.',
    );
  }
  const collectionPath = getCollectionPath(config.collection);
  const url = `${host}/collections/${collectionPath}${path}`;
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
      question: z.string().min(1).describe('The question or text to search for'),
      top_k: z.number().optional().describe('Number of results to return (default 5)'),
      score_threshold: z
        .number()
        .optional()
        .describe('Minimum similarity score 0-1 (default: no threshold)'),
    },
    async ({ question, top_k, score_threshold }) => {
      const config = await fetchKBConfig(client, orgId);
      const normalizedQuestion = normalizeTextValue(question, 'question');
      const normalizedTopK = normalizeTopK(top_k, 5);
      const normalizedScoreThreshold =
        score_threshold === undefined
          ? undefined
          : normalizeScoreThreshold(score_threshold, 'score_threshold');
      const vector = await createEmbedding(normalizedQuestion, config);

      const searchBody: Record<string, unknown> = {
        vector,
        limit: normalizedTopK,
        with_payload: true,
      };
      if (normalizedScoreThreshold !== undefined) {
        searchBody.score_threshold = normalizedScoreThreshold;
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
      knowledge: z.string().min(1).describe('The text content to store in the knowledge base'),
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
      const normalizedKnowledge = normalizeTextValue(knowledge, 'knowledge');
      const vector = await createEmbedding(normalizedKnowledge, config);
      const threshold = normalizeScoreThreshold(similarity_threshold, 'similarity_threshold');

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
                text: normalizedKnowledge,
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
      knowledge: z.string().min(1).describe('Updated text content'),
      point_id: z
        .string()
        .optional()
        .describe('ID of the point to update (if omitted, finds closest match)'),
      metadata: z.record(z.unknown()).optional().describe('Updated metadata'),
    },
    async ({ knowledge, point_id, metadata }) => {
      const config = await fetchKBConfig(client, orgId);
      const normalizedKnowledge = normalizeTextValue(knowledge, 'knowledge');
      const vector = await createEmbedding(normalizedKnowledge, config);

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
                text: normalizedKnowledge,
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
      ids: z.array(z.string()).min(1).describe('Array of point IDs to delete'),
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
      const host = resolveQdrantHost();
      if (!host) {
        throw new Error(
          'STATESET_KB_HOST environment variable is required for Knowledge Base operations.',
        );
      }

      const url = `${host}/collections/${getCollectionPath(config.collection)}`;
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
      const normalizedLimit = normalizeTopK(limit, 10);

      const scrollBody: Record<string, unknown> = {
        limit: normalizedLimit,
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
