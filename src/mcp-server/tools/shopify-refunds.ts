import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ShopifyConfig } from '../../integrations/config.js';
import {
  fetchOrderByName,
  calculateRefund,
  createRefund,
  findLineItemsBySku,
  addOrderTags,
  type ShopifyOrderDetail,
} from '../../integrations/shopify.js';
import { formatMoney } from '../../integrations/format.js';

export interface ShopifyRefundToolOptions {
  allowApply: boolean;
  redact: boolean;
}

function formatOrderSummary(order: ShopifyOrderDetail, { redact = false }: { redact?: boolean } = {}) {
  const summary: Record<string, unknown> = {
    id: order.id,
    name: order.name,
    created_at: order.createdAt,
    status: order.displayFinancialStatus,
    fulfillment_status: order.displayFulfillmentStatus,
    total_price: order.totalPrice
      ? `${formatMoney(order.totalPrice.amount)} ${order.totalPrice.currencyCode}`
      : null,
    has_existing_refunds: order.hasRefunds,
    tags: order.tags,
    line_items: order.lineItems.map((li) => ({
      id: li.id,
      name: li.name,
      sku: li.sku,
      quantity: li.quantity,
      current_quantity: li.currentQuantity,
      unit_price: li.unitPrice ? `${formatMoney(li.unitPrice.amount)} ${li.unitPrice.currencyCode}` : null,
      total_price: li.totalPrice ? `${formatMoney(li.totalPrice.amount)} ${li.totalPrice.currencyCode}` : null,
    })),
  };

  if (!redact) {
    summary.email = order.email;
  }

  return summary;
}

async function executeLookupOrder(
  shopify: ShopifyConfig,
  input: { order_number: string },
  { redact = false }: { redact?: boolean } = {}
) {
  const orderNumber = String(input.order_number || '').trim();
  if (!orderNumber) throw new Error('Order number is required');

  const order = await fetchOrderByName({ shopify, orderName: orderNumber });
  return {
    success: true,
    order: formatOrderSummary(order, { redact }),
  };
}

async function executePreviewRefund(
  shopify: ShopifyConfig,
  input: {
    order_number: string;
    sku_pattern?: string;
    line_item_ids?: string[];
    quantity?: number;
  },
  { redact = false }: { redact?: boolean } = {}
) {
  const orderNumber = String(input.order_number || '').trim();
  if (!orderNumber) throw new Error('Order number is required');

  const order = await fetchOrderByName({ shopify, orderName: orderNumber });

  let lineItemsToRefund = [] as typeof order.lineItems;

  if (input.sku_pattern) {
    const matches = findLineItemsBySku(order, input.sku_pattern);
    if (matches.length === 0) {
      return {
        success: false,
        error: `No line items found matching SKU pattern "${input.sku_pattern}"`,
        order: formatOrderSummary(order, { redact }),
      };
    }
    lineItemsToRefund = matches;
  } else if (input.line_item_ids && input.line_item_ids.length > 0) {
    const idSet = new Set(input.line_item_ids.map(String));
    lineItemsToRefund = order.lineItems.filter((li) => idSet.has(String(li.id)));
    if (lineItemsToRefund.length === 0) {
      return {
        success: false,
        error: 'No matching line items found for provided IDs',
        order: formatOrderSummary(order, { redact }),
      };
    }
  } else {
    return {
      success: false,
      error: 'Must provide either sku_pattern or line_item_ids',
      order: formatOrderSummary(order, { redact }),
    };
  }

  const refundItems = lineItemsToRefund.map((li) => ({
    lineItemId: li.id,
    quantity: input.quantity || li.currentQuantity || li.quantity,
  }));

  const calculation = await calculateRefund({
    shopify,
    orderId: order.id,
    lineItems: refundItems,
  });

  const totalRefund = calculation.transactions.reduce(
    (sum, t) => sum + parseFloat(t.amount || '0'),
    0
  );

  return {
    success: true,
    order_name: order.name,
    order_id: order.id,
    line_items_to_refund: lineItemsToRefund.map((li) => ({
      id: li.id,
      name: li.name,
      sku: li.sku,
      quantity_to_refund: input.quantity || li.currentQuantity || li.quantity,
      unit_price: li.unitPrice ? `${formatMoney(li.unitPrice.amount)} ${li.unitPrice.currencyCode}` : null,
    })),
    calculated_refund: {
      total_amount: formatMoney(totalRefund),
      currency: order.totalPrice?.currencyCode || 'USD',
      line_items: calculation.refundLineItems.map((rli) => ({
        line_item_id: rli.lineItemId,
        quantity: rli.quantity,
        subtotal: formatMoney(rli.subtotal),
        tax: formatMoney(rli.totalTax),
      })),
    },
    warning: order.hasRefunds ? 'This order already has existing refunds' : null,
  };
}

async function executeProcessRefund(
  shopify: ShopifyConfig,
  input: {
    order_number: string;
    sku_pattern?: string;
    line_item_ids?: string[];
    quantity?: number;
    notify_customer?: boolean;
    note?: string;
    add_tag?: string;
  },
  { allowApply = false }: { allowApply?: boolean } = {}
) {
  if (!allowApply) {
    return {
      error: 'Refund operation not allowed. The --apply flag or STATESET_ALLOW_APPLY must be set to enable refunds.',
      hint: 'Run preview_refund first to see what would be refunded.',
    };
  }

  const orderNumber = String(input.order_number || '').trim();
  if (!orderNumber) throw new Error('Order number is required');

  const order = await fetchOrderByName({ shopify, orderName: orderNumber });

  let lineItemsToRefund = [] as typeof order.lineItems;

  if (input.sku_pattern) {
    lineItemsToRefund = findLineItemsBySku(order, input.sku_pattern);
    if (lineItemsToRefund.length === 0) {
      return {
        success: false,
        error: `No line items found matching SKU pattern "${input.sku_pattern}"`,
      };
    }
  } else if (input.line_item_ids && input.line_item_ids.length > 0) {
    const idSet = new Set(input.line_item_ids.map(String));
    lineItemsToRefund = order.lineItems.filter((li) => idSet.has(String(li.id)));
    if (lineItemsToRefund.length === 0) {
      return {
        success: false,
        error: 'No matching line items found for provided IDs',
      };
    }
  } else {
    return {
      success: false,
      error: 'Must provide either sku_pattern or line_item_ids',
    };
  }

  const refundItems = lineItemsToRefund.map((li) => ({
    lineItemId: li.id,
    quantity: input.quantity || li.currentQuantity || li.quantity,
  }));

  const refund = await createRefund({
    shopify,
    orderId: order.id,
    lineItems: refundItems,
    notify: Boolean(input.notify_customer),
    note: input.note || `Partial refund for SKU: ${input.sku_pattern || 'specified items'}`,
  });

  let tagResult: { success: boolean; tag: string; error?: string } | null = null;
  if (input.add_tag) {
    try {
      await addOrderTags({ shopify, orderId: order.id, tags: [input.add_tag] });
      tagResult = { success: true, tag: input.add_tag };
    } catch (error) {
      tagResult = {
        success: false,
        tag: input.add_tag,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const totalRefunded = refund.transactions.reduce((sum, t) => sum + parseFloat(t.amount || '0'), 0);

  return {
    success: true,
    refund_id: refund.refundId,
    order_name: order.name,
    order_id: order.id,
    amount_refunded: formatMoney(totalRefunded),
    currency: order.totalPrice?.currencyCode || 'USD',
    line_items_refunded: refund.refundLineItems.length,
    customer_notified: Boolean(input.notify_customer),
    tag_result: tagResult,
  };
}

async function executeBatchPreviewRefunds(
  shopify: ShopifyConfig,
  input: { order_numbers: string[]; sku_pattern: string },
  { redact = false }: { redact?: boolean } = {}
) {
  const orderNumbers = input.order_numbers || [];
  const skuPattern = String(input.sku_pattern || '').trim();

  if (orderNumbers.length === 0) throw new Error('Order numbers are required');
  if (!skuPattern) throw new Error('SKU pattern is required');

  const results: Array<Record<string, unknown>> = [];
  const errors: Array<Record<string, unknown>> = [];
  let totalRefundAmount = 0;

  for (const orderNumber of orderNumbers) {
    try {
      const order = await fetchOrderByName({ shopify, orderName: orderNumber });
      const matches = findLineItemsBySku(order, skuPattern);

      if (matches.length === 0) {
        errors.push({
          order_number: orderNumber,
          error: `No items matching SKU "${skuPattern}"`,
        });
        continue;
      }

      const refundItems = matches.map((li) => ({
        lineItemId: li.id,
        quantity: li.currentQuantity || li.quantity,
      }));

      const calculation = await calculateRefund({
        shopify,
        orderId: order.id,
        lineItems: refundItems,
      });

      const refundAmount = calculation.transactions.reduce(
        (sum, t) => sum + parseFloat(t.amount || '0'),
        0
      );
      totalRefundAmount += refundAmount;

      results.push({
        order_number: order.name,
        order_id: order.id,
        items_to_refund: matches.length,
        refund_amount: formatMoney(refundAmount),
        has_existing_refunds: order.hasRefunds,
      });
    } catch (error) {
      errors.push({
        order_number: orderNumber,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    success: true,
    sku_pattern: skuPattern,
    summary: {
      total_orders: orderNumbers.length,
      orders_with_matches: results.length,
      orders_with_errors: errors.length,
      total_refund_amount: formatMoney(totalRefundAmount),
    },
    orders: results.slice(0, 50),
    has_more_orders: results.length > 50,
    errors: errors.slice(0, 20),
    has_more_errors: errors.length > 20,
  };
}

async function executeBatchProcessRefunds(
  shopify: ShopifyConfig,
  input: {
    order_numbers: string[];
    sku_pattern: string;
    notify_customer?: boolean;
    note?: string;
    add_tag?: string;
  },
  { allowApply = false }: { allowApply?: boolean } = {}
) {
  if (!allowApply) {
    return {
      error: 'Refund operation not allowed. The --apply flag or STATESET_ALLOW_APPLY must be set to enable refunds.',
      hint: 'Run batch_preview_refunds first to see what would be refunded.',
    };
  }

  const orderNumbers = input.order_numbers || [];
  const skuPattern = String(input.sku_pattern || '').trim();

  if (orderNumbers.length === 0) throw new Error('Order numbers are required');
  if (!skuPattern) throw new Error('SKU pattern is required');

  const results: Array<Record<string, unknown>> = [];
  const errors: Array<Record<string, unknown>> = [];
  let totalRefunded = 0;

  for (const orderNumber of orderNumbers) {
    try {
      const order = await fetchOrderByName({ shopify, orderName: orderNumber });
      const matches = findLineItemsBySku(order, skuPattern);

      if (matches.length === 0) {
        errors.push({
          order_number: orderNumber,
          error: `No items matching SKU "${skuPattern}"`,
        });
        continue;
      }

      const refundItems = matches.map((li) => ({
        lineItemId: li.id,
        quantity: li.currentQuantity || li.quantity,
      }));

      const refund = await createRefund({
        shopify,
        orderId: order.id,
        lineItems: refundItems,
        notify: Boolean(input.notify_customer),
        note: input.note || `Batch partial refund for SKU: ${skuPattern}`,
      });

      const refundAmount = refund.transactions.reduce(
        (sum, t) => sum + parseFloat(t.amount || '0'),
        0
      );
      totalRefunded += refundAmount;

      if (input.add_tag) {
        try {
          await addOrderTags({ shopify, orderId: order.id, tags: [input.add_tag] });
        } catch {
          // Tag failure doesn't fail the refund
        }
      }

      results.push({
        order_number: order.name,
        order_id: order.id,
        refund_id: refund.refundId,
        amount_refunded: formatMoney(refundAmount),
      });
    } catch (error) {
      errors.push({
        order_number: orderNumber,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    success: true,
    sku_pattern: skuPattern,
    summary: {
      total_orders: orderNumbers.length,
      orders_refunded: results.length,
      orders_failed: errors.length,
      total_amount_refunded: formatMoney(totalRefunded),
    },
    results: results.slice(0, 50),
    has_more_results: results.length > 50,
    errors: errors.slice(0, 20),
    has_more_errors: errors.length > 20,
    tag_added: input.add_tag || null,
    customers_notified: Boolean(input.notify_customer),
  };
}

export function registerShopifyRefundTools(
  server: McpServer,
  shopify: ShopifyConfig,
  options: ShopifyRefundToolOptions
) {
  server.tool(
    'shopify_lookup_order',
    'Look up a Shopify order by order number to see its details and line items. Use this to find the line items available for refund.',
    {
      order_number: z.string().describe('Order number (e.g., "#26417" or "26417")'),
    },
    async (args) => {
      const result = await executeLookupOrder(shopify, args, { redact: options.redact });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'shopify_preview_refund',
    'Preview a partial refund for an order without actually processing it. Shows the calculated refund amount.',
    {
      order_number: z.string().describe('Order number (e.g., "#26417" or "26417")'),
      sku_pattern: z.string().optional().describe('SKU pattern to match for refund (e.g., "SY-MIR-004" or "MINI-BAG")'),
      line_item_ids: z.array(z.string()).optional().describe('Specific line item IDs to refund (alternative to sku_pattern)'),
      quantity: z.number().optional().describe('Quantity to refund per line item (default: full quantity)'),
    },
    async (args) => {
      const result = await executePreviewRefund(shopify, args, { redact: options.redact });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'shopify_process_refund',
    'Process a partial refund for an order. ONLY use after previewing and getting explicit user confirmation.',
    {
      order_number: z.string().describe('Order number (e.g., "#26417" or "26417")'),
      sku_pattern: z.string().optional().describe('SKU pattern to match for refund'),
      line_item_ids: z.array(z.string()).optional().describe('Specific line item IDs to refund'),
      quantity: z.number().optional().describe('Quantity to refund per line item'),
      notify_customer: z.boolean().optional().describe('Send refund notification email'),
      note: z.string().optional().describe('Internal note for the refund'),
      add_tag: z.string().optional().describe('Tag to add to order after refund'),
    },
    async (args) => {
      const result = await executeProcessRefund(shopify, args, { allowApply: options.allowApply });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'shopify_batch_preview_refunds',
    'Preview refunds for multiple orders at once. Useful for processing a list of order numbers.',
    {
      order_numbers: z.array(z.string()).describe('Array of order numbers to preview'),
      sku_pattern: z.string().describe('SKU pattern to match for refund in each order'),
    },
    async (args) => {
      const result = await executeBatchPreviewRefunds(shopify, args, { redact: options.redact });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'shopify_batch_process_refunds',
    'Process refunds for multiple orders at once. ONLY use after batch preview and explicit user confirmation.',
    {
      order_numbers: z.array(z.string()).describe('Array of order numbers to refund'),
      sku_pattern: z.string().describe('SKU pattern to match for refund'),
      notify_customer: z.boolean().optional().describe('Send refund notification emails'),
      note: z.string().optional().describe('Internal note for refunds'),
      add_tag: z.string().optional().describe('Tag to add to orders after refund'),
    },
    async (args) => {
      const result = await executeBatchProcessRefunds(shopify, args, { allowApply: options.allowApply });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}
