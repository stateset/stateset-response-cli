import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { RechargeConfig } from '../../integrations/config.js';
import { rechargeRequest } from '../../integrations/recharge.js';
import { redactPii } from '../../integrations/redact.js';
import { stringifyToolResult } from './output.js';

export interface RechargeToolOptions {
  allowApply: boolean;
  redact: boolean;
}

function buildQuery(args: { limit?: number; page?: number; query?: Record<string, string | number | boolean> }): Record<string, string | number | boolean> | undefined {
  const query: Record<string, string | number | boolean> = {
    ...(args.query || {}),
  };
  if (args.limit !== undefined) query.limit = args.limit;
  if (args.page !== undefined) query.page = args.page;
  return Object.keys(query).length > 0 ? query : undefined;
}

async function runRechargeRequest(
  recharge: RechargeConfig,
  options: RechargeToolOptions,
  args: {
    method: string;
    path: string;
    query?: Record<string, string | number | boolean>;
    body?: Record<string, unknown>;
    version?: string;
  }
) {
  const response = await rechargeRequest({
    recharge,
    method: args.method,
    path: args.path,
    query: args.query,
    body: args.body,
    version: args.version,
  });

  const data = options.redact ? redactPii(response.data) : response.data;
  return { status: response.status, data };
}

export function registerRechargeTools(server: McpServer, recharge: RechargeConfig, options: RechargeToolOptions) {
  server.tool(
    'recharge_list_customers',
    'List Recharge customers. Pass query params for filters (e.g., email, status, updated_at_min).',
    {
      limit: z.number().min(1).max(250).optional().describe('Maximum number of records to return'),
      page: z.number().min(1).optional().describe('Page number (1-based)'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runRechargeRequest(recharge, options, {
        method: 'GET',
        path: '/customers',
        query: buildQuery(args),
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'recharge_get_customer',
    'Get a Recharge customer by ID.',
    {
      customer_id: z.number().describe('Recharge customer ID'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runRechargeRequest(recharge, options, {
        method: 'GET',
        path: `/customers/${args.customer_id}`,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'recharge_list_subscriptions',
    'List Recharge subscriptions. Pass query params for filters (e.g., customer_id, status, updated_at_min).',
    {
      limit: z.number().min(1).max(250).optional().describe('Maximum number of records to return'),
      page: z.number().min(1).optional().describe('Page number (1-based)'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runRechargeRequest(recharge, options, {
        method: 'GET',
        path: '/subscriptions',
        query: buildQuery(args),
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'recharge_get_subscription',
    'Get a Recharge subscription by ID.',
    {
      subscription_id: z.number().describe('Recharge subscription ID'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runRechargeRequest(recharge, options, {
        method: 'GET',
        path: `/subscriptions/${args.subscription_id}`,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'recharge_list_charges',
    'List Recharge charges. Pass query params for filters (e.g., customer_id, status, updated_at_min).',
    {
      limit: z.number().min(1).max(250).optional().describe('Maximum number of records to return'),
      page: z.number().min(1).optional().describe('Page number (1-based)'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runRechargeRequest(recharge, options, {
        method: 'GET',
        path: '/charges',
        query: buildQuery(args),
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'recharge_get_charge',
    'Get a Recharge charge by ID.',
    {
      charge_id: z.number().describe('Recharge charge ID'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runRechargeRequest(recharge, options, {
        method: 'GET',
        path: `/charges/${args.charge_id}`,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'recharge_list_orders',
    'List Recharge orders. Pass query params for filters (e.g., customer_id, status, updated_at_min).',
    {
      limit: z.number().min(1).max(250).optional().describe('Maximum number of records to return'),
      page: z.number().min(1).optional().describe('Page number (1-based)'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Additional query parameters'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runRechargeRequest(recharge, options, {
        method: 'GET',
        path: '/orders',
        query: buildQuery(args),
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'recharge_get_order',
    'Get a Recharge order by ID.',
    {
      order_id: z.number().describe('Recharge order ID'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const result = await runRechargeRequest(recharge, options, {
        method: 'GET',
        path: `/orders/${args.order_id}`,
      });
      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );

  server.tool(
    'recharge_request',
    'Execute a raw Recharge API request. Non-GET methods require --apply or STATESET_ALLOW_APPLY.',
    {
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).describe('HTTP method'),
      endpoint: z.string().describe('API endpoint path (e.g., /subscriptions, /customers/123)'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('Optional query params'),
      body: z.record(z.any()).optional().describe('Optional JSON body'),
      version: z.string().optional().describe('Override X-Recharge-Version header'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const method = String(args.method || '').toUpperCase();
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

      const result = await runRechargeRequest(recharge, options, {
        method,
        path: args.endpoint as string,
        query: args.query as Record<string, string | number | boolean> | undefined,
        body: args.body as Record<string, unknown> | undefined,
        version: args.version as string | undefined,
      });

      const payload = { success: true, ...result };
      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );
}
