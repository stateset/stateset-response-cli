import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ShopifyConfig } from '../../integrations/config.js';
import { shopifyGraphqlRaw, shopifyRestRequest } from '../../integrations/shopify.js';
import { redactPii } from '../../integrations/redact.js';
import {
  type IntegrationToolOptions,
  MaxCharsSchema,
  QueryParamsSchema,
  BodySchema,
  HttpMethodSchema,
  writeNotAllowed,
  wrapToolResult,
} from './helpers.js';

export type ShopifyAdvancedToolOptions = IntegrationToolOptions;

function isMutation(query: string): boolean {
  return /\bmutation\b/i.test(query);
}

export function registerShopifyAdvancedTools(
  server: McpServer,
  shopify: ShopifyConfig,
  options: ShopifyAdvancedToolOptions,
) {
  server.tool(
    'shopify_graphql',
    'Execute a raw Shopify Admin GraphQL query or mutation. Mutations require --apply or STATESET_ALLOW_APPLY.',
    {
      query: z.string().describe('GraphQL query or mutation string'),
      variables: z.record(z.unknown()).optional().describe('Optional GraphQL variables object'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const query = String(args.query || '').trim();
      if (!query) throw new Error('Query is required');
      if (isMutation(query) && !options.allowApply) {
        return writeNotAllowed();
      }

      const data = await shopifyGraphqlRaw({
        shopify,
        query,
        variables: args.variables as Record<string, unknown> | undefined,
      });

      const result = options.redact ? redactPii(data) : data;
      const payload = { success: true, data: result };
      return wrapToolResult(payload, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shopify_rest',
    'Execute a raw Shopify Admin REST request. Non-GET methods require --apply or STATESET_ALLOW_APPLY.',
    {
      method: HttpMethodSchema,
      path: z
        .string()
        .describe('REST path relative to /admin/api/{version}, e.g. /orders/123.json'),
      query: QueryParamsSchema,
      body: BodySchema,
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const method = String(args.method || '').toUpperCase();
      if (!method) throw new Error('Method is required');
      if (method !== 'GET' && !options.allowApply) {
        return writeNotAllowed();
      }

      const result = await shopifyRestRequest({
        shopify,
        method,
        path: args.path as string,
        query: args.query as Record<string, string | number | boolean> | undefined,
        body: args.body as Record<string, unknown> | undefined,
      });

      const data = options.redact ? redactPii(result.data) : result.data;
      const payload = { success: true, status: result.status, data };
      return wrapToolResult(payload, args.max_chars as number | undefined);
    },
  );
}
