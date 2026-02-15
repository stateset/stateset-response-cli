import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { KlaviyoConfig } from '../../integrations/config.js';
import { klaviyoRequest } from '../../integrations/klaviyo.js';
import { redactPii } from '../../integrations/redact.js';
import { stringifyToolResult } from './output.js';

export interface KlaviyoToolOptions {
  allowApply: boolean;
  redact: boolean;
}

export interface ListArgs {
  limit?: number;
  cursor?: string;
  filter?: string;
  sort?: string;
  fields?: string;
  additional_fields?: string;
  query?: Record<string, string | number | boolean>;
}

export function buildQuery(
  args: ListArgs,
  resource: string,
): Record<string, string | number | boolean> | undefined {
  const query: Record<string, string | number | boolean> = {
    ...(args.query || {}),
  };
  if (args.limit !== undefined) query['page[size]'] = args.limit;
  if (args.cursor) query['page[cursor]'] = args.cursor;
  if (args.filter) query['filter'] = args.filter;
  if (args.sort) query['sort'] = args.sort;
  if (args.fields) query[`fields[${resource}]`] = args.fields;
  if (args.additional_fields) query[`additional-fields[${resource}]`] = args.additional_fields;

  return Object.keys(query).length > 0 ? query : undefined;
}

export async function runKlaviyoRequest(
  klaviyo: KlaviyoConfig,
  options: KlaviyoToolOptions,
  args: {
    method: string;
    path: string;
    query?: Record<string, string | number | boolean>;
    body?: Record<string, unknown>;
    revision?: string;
  },
) {
  const response = await klaviyoRequest({
    klaviyo,
    method: args.method,
    path: args.path,
    query: args.query,
    body: args.body,
    revision: args.revision,
  });

  const data = options.redact ? redactPii(response.data) : response.data;
  return { status: response.status, data };
}

export function writeNotAllowed() {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            error:
              'Write operation not allowed. The --apply flag or STATESET_ALLOW_APPLY must be set.',
            hint: 'Use GET requests when writes are disabled.',
          },
          null,
          2,
        ),
      },
    ],
  };
}

export function buildProfileAttributes(
  attributes: Record<string, unknown>,
  properties?: Record<string, unknown>,
) {
  const payload = { ...attributes } as Record<string, unknown>;
  if (properties && payload.properties === undefined) {
    payload.properties = properties;
  }
  return payload;
}

export function buildProfileData(args: {
  profile_id?: string;
  attributes: Record<string, unknown>;
  properties?: Record<string, unknown>;
}) {
  const data: Record<string, unknown> = {
    type: 'profile',
    attributes: buildProfileAttributes(args.attributes, args.properties),
  };
  if (args.profile_id) data.id = args.profile_id;
  return data;
}

export function buildJsonApiData(args: {
  type: string;
  id?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
}) {
  const data: Record<string, unknown> = {
    type: args.type,
  };
  if (args.id) data.id = args.id;
  if (args.attributes && Object.keys(args.attributes).length > 0) {
    data.attributes = args.attributes;
  }
  if (args.relationships && Object.keys(args.relationships).length > 0) {
    data.relationships = args.relationships;
  }
  return data;
}

export function buildJsonApiPayload(args: {
  type: string;
  id?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
}) {
  return { data: buildJsonApiData(args) };
}

export function buildRelationshipPayload(resourceType: string, ids: string[]) {
  return {
    data: ids.map((id) => ({ type: resourceType, id })),
  };
}

export function registerKlaviyoRawRequestTool(
  server: McpServer,
  klaviyo: KlaviyoConfig,
  options: KlaviyoToolOptions,
) {
  server.tool(
    'klaviyo_request',
    'Execute a raw Klaviyo API request. Non-GET methods require --apply or STATESET_ALLOW_APPLY.',
    {
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).describe('HTTP method'),
      endpoint: z.string().describe('API endpoint path (e.g., /profiles, /lists/123)'),
      query: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe('Optional query params'),
      body: z.record(z.unknown()).optional().describe('Optional JSON body'),
      revision: z.string().optional().describe('Override Klaviyo revision header'),
      max_chars: z
        .number()
        .min(2000)
        .max(20000)
        .optional()
        .describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const method = String(args.method || '').toUpperCase();
      if (method !== 'GET' && !options.allowApply) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error:
                    'Write operation not allowed. The --apply flag or STATESET_ALLOW_APPLY must be set.',
                  hint: 'Use GET requests when writes are disabled.',
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const result = await runKlaviyoRequest(klaviyo, options, {
        method,
        path: args.endpoint as string,
        query: args.query as Record<string, string | number | boolean> | undefined,
        body: args.body as Record<string, unknown> | undefined,
        revision: args.revision as string | undefined,
      });

      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
