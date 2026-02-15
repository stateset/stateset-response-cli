import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ShopifyConfig } from '../../integrations/config.js';
import {
  addOrderTags,
  fetchOrdersWithHoldInfo,
  releaseHoldsForOrders,
  type ShopifyOrder,
} from '../../integrations/shopify.js';
import { formatMoney } from '../../integrations/format.js';
import { type IntegrationToolOptions, wrapToolResult } from './helpers.js';

export type ShopifyToolOptions = IntegrationToolOptions;

function getSkipReason(
  order: ShopifyOrder,
  { includeCancelled, includeRefunded }: { includeCancelled: boolean; includeRefunded: boolean },
): string | null {
  if (!includeCancelled && order.cancelledAt) return 'cancelled';
  if (!includeRefunded) {
    const s = order.displayFinancialStatus;
    if (s === 'refunded' || s === 'partially_refunded') return s;
  }
  return null;
}

function summarizeOrders(orders: ShopifyOrder[], { redact = false }: { redact?: boolean } = {}) {
  return orders.map((o) => {
    const holdCount = o.fulfillmentOrders.filter((fo) => fo.status === 'on_hold').length;
    const summary: Record<string, unknown> = {
      id: o.id,
      name: o.name,
      created_at: o.createdAt,
      tags: o.tags,
      hold_count: holdCount,
      total_price: o.totalPrice
        ? `${formatMoney(o.totalPrice.amount)} ${o.totalPrice.currencyCode}`
        : null,
    };
    if (!redact) summary.email = o.email;
    return summary;
  });
}

async function executePreviewOrders(
  shopify: ShopifyConfig,
  input: {
    query: string;
    limit?: number;
    include_cancelled?: boolean;
    include_refunded?: boolean;
  },
  { redact = false }: { redact?: boolean } = {},
) {
  const query = String(input.query || '').trim();
  if (!query) throw new Error('Query is required');

  const limit = Math.min(500, Math.max(1, Number(input.limit) || 50));
  const includeCancelled = Boolean(input.include_cancelled);
  const includeRefunded = Boolean(input.include_refunded);

  const { orders } = await fetchOrdersWithHoldInfo({ shopify, orderQuery: query, limit });

  const skipped: Array<{ id: string; name: string; reason: string }> = [];
  const eligible: ShopifyOrder[] = [];
  for (const order of orders) {
    const reason = getSkipReason(order, { includeCancelled, includeRefunded });
    if (reason) skipped.push({ id: order.id, name: order.name, reason });
    else eligible.push(order);
  }

  const ordersWithHolds = eligible.filter((o) =>
    o.fulfillmentOrders.some((fo) => fo.status === 'on_hold'),
  );

  const totalHolds = ordersWithHolds.reduce(
    (acc, o) => acc + o.fulfillmentOrders.filter((fo) => fo.status === 'on_hold').length,
    0,
  );

  return {
    query,
    limit,
    settings: { includeCancelled, includeRefunded },
    matched_orders: orders.length,
    skipped_orders: skipped.length,
    eligible_orders: eligible.length,
    orders_with_holds: ordersWithHolds.length,
    total_holds: totalHolds,
    orders: summarizeOrders(ordersWithHolds.slice(0, 25), { redact }),
    has_more: ordersWithHolds.length > 25,
  };
}

async function executeReleaseHolds(
  shopify: ShopifyConfig,
  input: {
    query: string;
    limit?: number;
    include_cancelled?: boolean;
    include_refunded?: boolean;
    add_tag?: string;
    concurrency?: number;
  },
  { redact: _redact = false, allowApply = false }: { redact?: boolean; allowApply?: boolean } = {},
) {
  if (!allowApply) {
    return {
      error:
        'Release operation not allowed. The --apply flag or STATESET_ALLOW_APPLY must be set to enable hold releases.',
      hint: 'Run the preview first to see what would be affected.',
    };
  }

  const query = String(input.query || '').trim();
  if (!query) throw new Error('Query is required');

  const limit = Math.min(500, Math.max(1, Number(input.limit) || 50));
  const includeCancelled = Boolean(input.include_cancelled);
  const includeRefunded = Boolean(input.include_refunded);
  const addTag = input.add_tag ? String(input.add_tag).trim() : null;
  const concurrency = Math.max(1, Number(input.concurrency) || 2);

  const { orders } = await fetchOrdersWithHoldInfo({ shopify, orderQuery: query, limit });

  const eligible: ShopifyOrder[] = [];
  for (const order of orders) {
    const reason = getSkipReason(order, { includeCancelled, includeRefunded });
    if (!reason) eligible.push(order);
  }

  const ordersWithHolds = eligible.filter((o) =>
    o.fulfillmentOrders.some((fo) => fo.status === 'on_hold'),
  );

  if (ordersWithHolds.length === 0) {
    return {
      success: true,
      message: 'No orders with holds found matching the query.',
      released: 0,
      tagged: 0,
    };
  }

  const releaseResults = await releaseHoldsForOrders({
    shopify,
    orders: ordersWithHolds,
    concurrency,
  });

  const holdCountByOrderId = new Map<string, number>();
  const orderById = new Map<string, ShopifyOrder>();
  for (const o of ordersWithHolds) {
    const count = o.fulfillmentOrders.filter((fo) => fo.status === 'on_hold').length;
    holdCountByOrderId.set(o.id, count);
    orderById.set(o.id, o);
  }

  const releasedCountByOrderId = new Map<string, number>();
  for (const r of releaseResults.releasedFulfillmentOrders) {
    releasedCountByOrderId.set(r.orderId, (releasedCountByOrderId.get(r.orderId) || 0) + 1);
  }

  const failedCountByOrderId = new Map<string, number>();
  for (const f of releaseResults.failedFulfillmentOrders) {
    failedCountByOrderId.set(f.orderId, (failedCountByOrderId.get(f.orderId) || 0) + 1);
  }

  const ordersWithFullRelease: string[] = [];
  for (const [orderId, expected] of holdCountByOrderId.entries()) {
    const released = releasedCountByOrderId.get(orderId) || 0;
    const failed = failedCountByOrderId.get(orderId) || 0;
    if (expected > 0 && released === expected && failed === 0) {
      ordersWithFullRelease.push(orderId);
    }
  }

  let taggedCount = 0;
  const tagFailures: Array<{ orderId: string; orderName: string; error: string }> = [];
  if (addTag && ordersWithFullRelease.length > 0) {
    for (const orderId of ordersWithFullRelease) {
      const order = orderById.get(orderId);
      if (!order) continue;
      if (order.tags.includes(addTag)) continue;
      try {
        await addOrderTags({ shopify, orderId, tags: [addTag] });
        taggedCount++;
      } catch (error) {
        tagFailures.push({
          orderId,
          orderName: order.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    success: true,
    query,
    orders_processed: ordersWithHolds.length,
    holds_released: releaseResults.releasedFulfillmentOrders.length,
    release_failures: releaseResults.failedFulfillmentOrders.length,
    orders_tagged: taggedCount,
    tag_failures: tagFailures.length,
    tag_added: addTag || null,
  };
}

async function executeAddTags(
  shopify: ShopifyConfig,
  input: { order_ids: string[]; tags: string[] },
  { allowApply = false }: { allowApply?: boolean } = {},
) {
  if (!allowApply) {
    return {
      error: 'Tag operation not allowed. The --apply flag or STATESET_ALLOW_APPLY must be set.',
      hint: 'Preview orders first if you need to verify order IDs.',
    };
  }
  const orderIds = Array.isArray(input.order_ids) ? input.order_ids : [];
  const tags = Array.isArray(input.tags) ? input.tags : [];

  if (orderIds.length === 0) throw new Error('No order IDs provided');
  if (tags.length === 0) throw new Error('No tags provided');

  const results: Array<{ orderId: string; success: true }> = [];
  const failures: Array<{ orderId: string; error: string }> = [];

  for (const orderId of orderIds) {
    try {
      await addOrderTags({ shopify, orderId, tags });
      results.push({ orderId, success: true });
    } catch (error) {
      failures.push({ orderId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    success: failures.length === 0,
    tagged: results.length,
    failed: failures.length,
    failures: failures.length > 0 ? failures : undefined,
  };
}

export function registerShopifyHoldsTools(
  server: McpServer,
  shopify: ShopifyConfig,
  options: ShopifyToolOptions,
) {
  server.tool(
    'shopify_preview_orders',
    'Search for Shopify orders and show which ones have fulfillment holds. Always use this first before any release operation.',
    {
      query: z
        .string()
        .describe(
          'Shopify order search query (e.g., "tag:pre-order -tag:released created_at:<2025-11-27")',
        ),
      limit: z.number().min(1).max(500).optional().describe('Maximum number of orders to fetch'),
      include_cancelled: z.boolean().optional().describe('Include cancelled orders'),
      include_refunded: z.boolean().optional().describe('Include refunded orders'),
    },
    async (args) => {
      const result = await executePreviewOrders(shopify, args, { redact: options.redact });
      return wrapToolResult(result);
    },
  );

  server.tool(
    'shopify_release_holds',
    'Release fulfillment holds on orders. ONLY use after previewing and getting explicit user confirmation.',
    {
      query: z.string().describe('Shopify order search query (same as used in preview)'),
      limit: z.number().min(1).max(500).optional().describe('Maximum number of orders to process'),
      include_cancelled: z.boolean().optional().describe('Include cancelled orders'),
      include_refunded: z.boolean().optional().describe('Include refunded orders'),
      add_tag: z.string().optional().describe('Tag to add to orders after successful hold release'),
      concurrency: z.number().min(1).max(10).optional().describe('Number of concurrent operations'),
    },
    async (args) => {
      const result = await executeReleaseHolds(shopify, args, {
        redact: options.redact,
        allowApply: options.allowApply,
      });
      return wrapToolResult(result);
    },
  );

  server.tool(
    'shopify_add_tags',
    'Add tags to specific orders by ID. Requires --apply or STATESET_ALLOW_APPLY.',
    {
      order_ids: z.array(z.string()).describe('Array of order IDs to tag'),
      tags: z.array(z.string()).describe('Tags to add to the orders'),
    },
    async (args) => {
      const result = await executeAddTags(shopify, args, { allowApply: options.allowApply });
      return wrapToolResult(result);
    },
  );
}
