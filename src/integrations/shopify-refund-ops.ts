/**
 * Shopify integration — refund calculation and creation.
 */
import { requestJsonWithRetry } from './http.js';
import type { ShopifyConfig } from './config.js';
import { shopifyGidToNumericId, getRestBaseUrl } from './shopify-core.js';
import type {
  RefundLineItemInput,
  RefundCalculation,
  RefundResult,
  ShopifyTransactionNode,
} from './shopify-core.js';

// ============================================================================
// Internal type (only used in this module)
// ============================================================================

interface ShopifyRefundResponse {
  id?: string | number;
  note?: string;
  created_at?: string;
  transactions?: ShopifyTransactionNode[];
  refund_line_items?: Array<{
    line_item_id?: string | number;
    quantity?: number;
    subtotal?: string;
    total_tax?: string;
  }>;
  shipping?: { amount?: string; tax?: string };
}

// ============================================================================
// Refund operations
// ============================================================================

export async function calculateRefund({
  shopify,
  orderId,
  lineItems,
  shipping = false,
}: {
  shopify: ShopifyConfig;
  orderId: string;
  lineItems: RefundLineItemInput[];
  shipping?: boolean;
}): Promise<RefundCalculation> {
  const base = getRestBaseUrl(shopify);
  const numericOrderId = shopifyGidToNumericId(orderId);
  const url = `${base}/orders/${numericOrderId}/refunds/calculate.json`;

  const refundLineItems = lineItems.map((li) => ({
    line_item_id: shopifyGidToNumericId(li.lineItemId),
    quantity: li.quantity,
  }));

  const body = {
    refund: {
      refund_line_items: refundLineItems,
      shipping: shipping ? { full_refund: true } : undefined,
    },
  };

  const { status, data } = await requestJsonWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': shopify.accessToken,
    },
    body: JSON.stringify(body),
    timeoutMs: 30_000,
  });

  if (status >= 400) {
    const msg = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`Calculate refund failed for order ${orderId} (${status}): ${msg}`);
  }

  const refund = (data as { refund?: ShopifyRefundResponse }).refund;
  if (!refund) throw new Error('Invalid response from calculate refund');

  return {
    orderId,
    transactions: (refund.transactions || []).map((t) => ({
      amount: String(t.amount || ''),
      kind: t.kind ?? null,
      gateway: t.gateway ?? null,
      parentId: t.parent_id != null ? String(t.parent_id) : null,
    })),
    refundLineItems: (refund.refund_line_items || []).map((rli) => ({
      lineItemId: String(rli.line_item_id || ''),
      quantity: rli.quantity ?? 0,
      subtotal: String(rli.subtotal || ''),
      totalTax: String(rli.total_tax || ''),
    })),
    shipping: refund.shipping
      ? {
          amount: String(refund.shipping.amount || ''),
          tax: String(refund.shipping.tax || ''),
        }
      : null,
  };
}

export async function createRefund({
  shopify,
  orderId,
  lineItems,
  shipping = false,
  notify = false,
  note = null,
}: {
  shopify: ShopifyConfig;
  orderId: string;
  lineItems: RefundLineItemInput[];
  shipping?: boolean;
  notify?: boolean;
  note?: string | null;
}): Promise<RefundResult> {
  const base = getRestBaseUrl(shopify);
  const numericOrderId = shopifyGidToNumericId(orderId);

  const calculation = await calculateRefund({ shopify, orderId, lineItems, shipping });

  const parentTransaction = calculation.transactions.find((t) => t.parentId);
  if (!parentTransaction) {
    throw new Error('Could not determine parent transaction for refund');
  }

  const refundLineItems = lineItems.map((li) => ({
    line_item_id: shopifyGidToNumericId(li.lineItemId),
    quantity: li.quantity,
    restock_type: 'no_restock',
  }));

  const body = {
    refund: {
      notify: Boolean(notify),
      note: note || 'Partial refund via API',
      shipping: shipping ? { full_refund: true } : undefined,
      refund_line_items: refundLineItems,
      transactions: [
        {
          parent_id: parentTransaction.parentId,
          amount: parentTransaction.amount,
          kind: 'refund',
          gateway: parentTransaction.gateway,
        },
      ],
    },
  };

  const url = `${base}/orders/${numericOrderId}/refunds.json`;
  const { status, data } = await requestJsonWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': shopify.accessToken,
    },
    body: JSON.stringify(body),
    timeoutMs: 30_000,
  });

  if (status >= 400) {
    const msg = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`Create refund failed for order ${orderId} (${status}): ${msg}`);
  }

  const refund = (data as { refund?: ShopifyRefundResponse }).refund;
  if (!refund) throw new Error('Invalid response from create refund');

  return {
    refundId: refund.id ?? '',
    orderId,
    note: refund.note ?? null,
    createdAt: refund.created_at ?? null,
    transactions: (refund.transactions || []).map((t) => ({
      id: t.id ?? '',
      amount: String(t.amount || ''),
      kind: t.kind ?? null,
      status: t.status ?? null,
      gateway: t.gateway ?? null,
    })),
    refundLineItems: (refund.refund_line_items || []).map((rli) => ({
      lineItemId: String(rli.line_item_id || ''),
      quantity: rli.quantity ?? 0,
      subtotal: String(rli.subtotal || ''),
      totalTax: String(rli.total_tax || ''),
    })),
  };
}
