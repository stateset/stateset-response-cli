import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { RechargeConfig } from '../../integrations/config.js';
import { rechargeRequest } from '../../integrations/recharge.js';
import {
  type IntegrationToolOptions,
  createRequestRunner,
  wrapToolResult,
  MaxCharsSchema,
  buildQuery,
  registerRawRequestTool,
} from './helpers.js';

export type RechargeToolOptions = IntegrationToolOptions;

const runRequest = createRequestRunner<RechargeConfig>((config, args) =>
  rechargeRequest({ recharge: config, ...args }),
);

export function registerRechargeTools(
  server: McpServer,
  recharge: RechargeConfig,
  options: RechargeToolOptions,
) {
  server.tool(
    'recharge_list_customers',
    'List Recharge customers. Pass query params for filters (e.g., email, status, updated_at_min).',
    {
      limit: z.number().min(1).max(250).optional().describe('Maximum number of records to return'),
      page: z.number().min(1).optional().describe('Page number (1-based)'),
      query: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe('Additional query parameters'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(recharge, options, {
        method: 'GET',
        path: '/customers',
        query: buildQuery({ ...args.query, limit: args.limit, page: args.page }),
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'recharge_get_customer',
    'Get a Recharge customer by ID.',
    {
      customer_id: z.number().describe('Recharge customer ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(recharge, options, {
        method: 'GET',
        path: `/customers/${args.customer_id}`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'recharge_list_subscriptions',
    'List Recharge subscriptions. Pass query params for filters (e.g., customer_id, status, updated_at_min).',
    {
      limit: z.number().min(1).max(250).optional().describe('Maximum number of records to return'),
      page: z.number().min(1).optional().describe('Page number (1-based)'),
      query: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe('Additional query parameters'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(recharge, options, {
        method: 'GET',
        path: '/subscriptions',
        query: buildQuery({ ...args.query, limit: args.limit, page: args.page }),
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'recharge_get_subscription',
    'Get a Recharge subscription by ID.',
    {
      subscription_id: z.number().describe('Recharge subscription ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(recharge, options, {
        method: 'GET',
        path: `/subscriptions/${args.subscription_id}`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'recharge_list_charges',
    'List Recharge charges. Pass query params for filters (e.g., customer_id, status, updated_at_min).',
    {
      limit: z.number().min(1).max(250).optional().describe('Maximum number of records to return'),
      page: z.number().min(1).optional().describe('Page number (1-based)'),
      query: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe('Additional query parameters'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(recharge, options, {
        method: 'GET',
        path: '/charges',
        query: buildQuery({ ...args.query, limit: args.limit, page: args.page }),
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'recharge_get_charge',
    'Get a Recharge charge by ID.',
    {
      charge_id: z.number().describe('Recharge charge ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(recharge, options, {
        method: 'GET',
        path: `/charges/${args.charge_id}`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'recharge_list_orders',
    'List Recharge orders. Pass query params for filters (e.g., customer_id, status, updated_at_min).',
    {
      limit: z.number().min(1).max(250).optional().describe('Maximum number of records to return'),
      page: z.number().min(1).optional().describe('Page number (1-based)'),
      query: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe('Additional query parameters'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(recharge, options, {
        method: 'GET',
        path: '/orders',
        query: buildQuery({ ...args.query, limit: args.limit, page: args.page }),
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  server.tool(
    'recharge_get_order',
    'Get a Recharge order by ID.',
    {
      order_id: z.number().describe('Recharge order ID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const result = await runRequest(recharge, options, {
        method: 'GET',
        path: `/orders/${args.order_id}`,
      });
      return wrapToolResult({ success: true, ...result }, args.max_chars);
    },
  );

  registerRawRequestTool(
    server,
    'recharge_request',
    'Execute a raw Recharge API request.',
    runRequest,
    recharge,
    options,
    { version: z.string().optional().describe('Override X-Recharge-Version header') },
  );
}
