import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ShopifyConfig } from '../../integrations/config.js';
import { shopifyGraphqlRaw, shopifyRestRequest } from '../../integrations/shopify.js';
import { redactPii } from '../../integrations/redact.js';
import { stringifyToolResult } from './output.js';

export interface ShopifyAdvancedToolOptions {
  allowApply: boolean;
  redact: boolean;
}

function isMutation(query: string): boolean {
  return /\bmutation\b/i.test(query);
}

export function registerShopifyAdvancedTools(
  server: McpServer,
  shopify: ShopifyConfig,
  options: ShopifyAdvancedToolOptions
) {
  server.tool(
    'shopify_graphql',
    'Execute a raw Shopify Admin GraphQL query or mutation. Mutations require --apply or STATESET_ALLOW_APPLY.',
    {
      query: z.string().describe('GraphQL query or mutation string'),
      variables: z.record(z.any()).optional().describe('Optional GraphQL variables object'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = String(args.query || '').trim();
      if (!query) throw new Error('Query is required');
      if (isMutation(query) && !options.allowApply) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Mutation not allowed. The --apply flag or STATESET_ALLOW_APPLY must be set.',
              hint: 'Use query operations when writes are disabled.',
            }, null, 2),
          }],
        };
      }

      const data = await shopifyGraphqlRaw({
        shopify,
        query,
        variables: args.variables as Record<string, unknown> | undefined,
      });

      const result = options.redact ? redactPii(data) : data;
      const payload = { success: true, data: result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'shopify_rest',
    'Execute a raw Shopify Admin REST request. Non-GET methods require --apply or STATESET_ALLOW_APPLY.',
    {
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).describe('HTTP method'),
      path: z.string().describe('REST path relative to /admin/api/{version}, e.g. /orders/123.json'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Optional query params'),
      body: z.record(z.any()).optional().describe('Optional JSON body'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const method = String(args.method || '').toUpperCase();
      if (!method) throw new Error('Method is required');
      if (method !== 'GET' && !options.allowApply) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Write operation not allowed. The --apply flag or STATESET_ALLOW_APPLY must be set.',
              hint: 'Use GET requests when writes are disabled.',
            }, null, 2),
          }],
        };
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
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );
}
