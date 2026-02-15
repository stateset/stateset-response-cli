import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ShopifyConfig } from '../../integrations/config.js';
import {
  fetchOrders,
  fetchOrderById,
  type ShopifyOrderSummary,
  type ShopifyOrderDetail,
} from '../../integrations/shopify.js';
import { formatMoney } from '../../integrations/format.js';
import { type IntegrationToolOptions, MaxCharsSchema, wrapToolResult } from './helpers.js';

export type ShopifyOrderToolOptions = IntegrationToolOptions;

function summarizeOrders(
  orders: ShopifyOrderSummary[],
  { redact = false }: { redact?: boolean } = {},
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

function formatOrderDetail(
  order: ShopifyOrderDetail,
  { redact = false }: { redact?: boolean } = {},
) {
  const detail: Record<string, unknown> = {
    id: order.id,
    name: order.name,
    created_at: order.createdAt,
    cancelled_at: order.cancelledAt,
    financial_status: order.displayFinancialStatus,
    fulfillment_status: order.displayFulfillmentStatus,
    total_price: order.totalPrice
      ? `${formatMoney(order.totalPrice.amount)} ${order.totalPrice.currencyCode}`
      : null,
    subtotal_price: order.subtotalPrice
      ? `${formatMoney(order.subtotalPrice.amount)} ${order.subtotalPrice.currencyCode}`
      : null,
    total_shipping: order.totalShipping
      ? `${formatMoney(order.totalShipping.amount)} ${order.totalShipping.currencyCode}`
      : null,
    total_tax: order.totalTax
      ? `${formatMoney(order.totalTax.amount)} ${order.totalTax.currencyCode}`
      : null,
    has_refunds: order.hasRefunds,
    tags: order.tags,
    line_items: order.lineItems.map((li) => ({
      id: li.id,
      name: li.name,
      sku: li.sku,
      quantity: li.quantity,
      current_quantity: li.currentQuantity,
      fulfillable_quantity: li.fulfillableQuantity,
      unit_price: li.unitPrice
        ? `${formatMoney(li.unitPrice.amount)} ${li.unitPrice.currencyCode}`
        : null,
      total_price: li.totalPrice
        ? `${formatMoney(li.totalPrice.amount)} ${li.totalPrice.currencyCode}`
        : null,
      variant_title: li.variantTitle,
      product_title: li.productTitle,
    })),
    transactions: order.transactions.map((t) => ({
      id: t.id,
      kind: t.kind,
      status: t.status,
      gateway: t.gateway,
      amount: t.amount ? `${formatMoney(t.amount.amount)} ${t.amount.currencyCode}` : null,
    })),
  };

  if (!redact) detail.email = order.email;
  return detail;
}

export function registerShopifyOrderTools(
  server: McpServer,
  shopify: ShopifyConfig,
  options: ShopifyOrderToolOptions,
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
      sort_by: z
        .enum(['created_at', 'updated_at'])
        .optional()
        .describe('Sort key (default created_at)'),
      order: z.enum(['asc', 'desc']).optional().describe('Sort direction (default desc)'),
      max_chars: MaxCharsSchema,
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

      return wrapToolResult(payload, args.max_chars as number | undefined);
    },
  );

  server.tool(
    'shopify_get_order',
    'Get full details of a single Shopify order by its numeric ID, including line items, transactions, and pricing breakdown.',
    {
      order_id: z.string().describe('Shopify order numeric ID (e.g., "6072438726949") or GID'),
      max_chars: MaxCharsSchema,
    },
    async (args) => {
      const order = await fetchOrderById({ shopify, orderId: args.order_id });
      const payload = {
        success: true,
        order: formatOrderDetail(order, { redact: options.redact }),
      };
      return wrapToolResult(payload, args.max_chars as number | undefined);
    },
  );
}
