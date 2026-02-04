import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ShopifyConfig } from '../../integrations/config.js';
import { fetchOrders, type ShopifyOrderSummary } from '../../integrations/shopify.js';
import { formatMoney } from '../../integrations/format.js';
import { stringifyToolResult } from './output.js';

export interface ShopifyOrderToolOptions {
  allowApply: boolean;
  redact: boolean;
}

function summarizeOrders(
  orders: ShopifyOrderSummary[],
  { redact = false }: { redact?: boolean } = {}
) {
  return orders.map((o) => {
    const summary: Record<string, unknown> = {
      id: o.id,
      name: o.name,
      created_at: o.createdAt,
      updated_at: o.updatedAt,
      cancelled_at: o.cancelledAt,
      financial_status: o.displayFinancialStatus,
      fulfillment_status: o.displayFulfillmentStatus,
      total_price: o.totalPrice
        ? `${formatMoney(o.totalPrice.amount)} ${o.totalPrice.currencyCode}`
        : null,
      tags: o.tags,
    };
    if (!redact) summary.email = o.email;
    return summary;
  });
}

export function registerShopifyOrderTools(
  server: McpServer,
  shopify: ShopifyConfig,
  options: ShopifyOrderToolOptions
) {
  server.tool(
    'shopify_list_orders',
    'List Shopify orders with optional search filters. Defaults to newest first.',
    {
      query: z
        .string()
        .optional()
        .describe('Shopify order search query (e.g., "status:any created_at:>=2025-01-01")'),
      limit: z.number().min(1).max(500).optional().describe('Maximum number of orders to return'),
      sort_by: z.enum(['created_at', 'updated_at']).optional().describe('Sort key (default created_at)'),
      order: z.enum(['asc', 'desc']).optional().describe('Sort direction (default desc)'),
      max_chars: z.number().min(2000).max(20000).optional().describe('Max characters in response (default 12000)'),
    },
    async (args) => {
      const query = String(args.query || '').trim() || 'status:any';
      const limit = Math.min(500, Math.max(1, Number(args.limit) || 10));
      const sortBy = args.sort_by === 'updated_at' ? 'UPDATED_AT' : 'CREATED_AT';
      const order = args.order === 'asc' ? 'asc' : 'desc';
      const reverse = order !== 'asc';

      const result = await fetchOrders({
        shopify,
        orderQuery: query,
        limit,
        sortKey: sortBy,
        reverse,
      });

      const payload = {
        success: true,
        query,
        sort: { by: args.sort_by || 'created_at', order },
        limit,
        returned: result.orders.length,
        has_more: result.hasMore,
        orders: summarizeOrders(result.orders, { redact: options.redact }),
      };

      const { text } = stringifyToolResult(payload, args.max_chars as number | undefined);
      return { content: [{ type: 'text' as const, text }] };
    }
  );
}
