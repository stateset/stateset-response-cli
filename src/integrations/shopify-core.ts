/**
 * Shopify integration — core types, interfaces, utility functions, and internal GraphQL helper.
 */
import { requestJsonWithRetry } from './http.js';
import type { ShopifyConfig } from './config.js';

// ============================================================================
// Exported types / interfaces
// ============================================================================

export interface ShopifyMoney {
  amount: string;
  currencyCode: string;
}

export interface ShopifyFulfillmentOrder {
  id: string;
  status: string;
}

export interface ShopifyOrder {
  id: string;
  name: string;
  email: string | null;
  tags: string[];
  cancelledAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  totalPrice: ShopifyMoney | null;
  fulfillmentOrders: ShopifyFulfillmentOrder[];
}

export interface ShopifyOrderSummary {
  id: string;
  name: string;
  email: string | null;
  tags: string[];
  cancelledAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  totalPrice: ShopifyMoney | null;
}

export type ShopifyOrderSortKey = 'CREATED_AT' | 'UPDATED_AT';

export interface ShopifyOrderLineItem {
  id: string;
  gid: string;
  name: string;
  sku: string;
  quantity: number;
  currentQuantity: number;
  fulfillableQuantity: number;
  unitPrice: ShopifyMoney | null;
  totalPrice: ShopifyMoney | null;
  variantId: string | null;
  variantTitle: string | null;
  productTitle: string | null;
}

export interface ShopifyOrderTransaction {
  id: string;
  kind: string | null;
  status: string | null;
  gateway: string | null;
  amount: ShopifyMoney | null;
}

export interface ShopifyOrderDetail {
  id: string;
  gid: string;
  name: string;
  email: string | null;
  tags: string[];
  cancelledAt: string | null;
  createdAt: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  totalPrice: ShopifyMoney | null;
  subtotalPrice: ShopifyMoney | null;
  totalShipping: ShopifyMoney | null;
  totalTax: ShopifyMoney | null;
  hasRefunds: boolean;
  lineItems: ShopifyOrderLineItem[];
  transactions: ShopifyOrderTransaction[];
}

export interface RefundLineItemInput {
  lineItemId: string;
  quantity: number;
}

export interface RefundCalculation {
  orderId: string;
  transactions: Array<{
    amount: string;
    kind: string | null;
    gateway: string | null;
    parentId: string | null;
  }>;
  refundLineItems: Array<{
    lineItemId: string;
    quantity: number;
    subtotal: string;
    totalTax: string;
  }>;
  shipping: { amount: string; tax: string } | null;
}

export interface RefundResult {
  refundId: string | number;
  orderId: string;
  note: string | null;
  createdAt: string | null;
  transactions: Array<{
    id: string | number;
    amount: string;
    kind: string | null;
    status: string | null;
    gateway: string | null;
  }>;
  refundLineItems: Array<{
    lineItemId: string | number;
    quantity: number;
    subtotal: string;
    totalTax: string;
  }>;
}

// ============================================================================
// Internal types (exported for sibling modules)
// ============================================================================

export interface ShopifyMoneyNode {
  amount?: string;
  currencyCode?: string;
}

export interface ShopifyMoneySet {
  shopMoney?: ShopifyMoneyNode;
}

export interface ShopifyOrderNode {
  id?: string;
  name?: string;
  email?: string;
  tags?: string[];
  cancelledAt?: string;
  createdAt?: string;
  updatedAt?: string;
  displayFinancialStatus?: string;
  displayFulfillmentStatus?: string;
  totalPriceSet?: ShopifyMoneySet;
  subtotalPriceSet?: ShopifyMoneySet;
  totalShippingPriceSet?: ShopifyMoneySet;
  totalTaxSet?: ShopifyMoneySet;
  refunds?: unknown[];
  lineItems?: { edges?: Array<{ node?: ShopifyLineItemNode }> };
  transactions?: ShopifyTransactionNode[];
  fulfillmentOrders?: { edges?: Array<{ node?: { id?: string; status?: string } }> };
}

export interface ShopifyGraphQLConnection {
  pageInfo?: { hasNextPage?: boolean; endCursor?: string };
  edges?: Array<{ node?: ShopifyOrderNode }>;
}

export interface ShopifyLineItemNode {
  id?: string;
  name?: string;
  sku?: string;
  quantity?: number;
  currentQuantity?: number;
  fulfillableQuantity?: number;
  discountedUnitPriceSet?: ShopifyMoneySet;
  discountedTotalSet?: ShopifyMoneySet;
  variant?: { id?: string; sku?: string; title?: string; product?: { title?: string } };
}

export interface ShopifyTransactionNode {
  id?: string;
  kind?: string;
  status?: string;
  gateway?: string;
  amount?: string;
  amountSet?: ShopifyMoneySet;
  parent_id?: string | number;
}

// ============================================================================
// Utility functions
// ============================================================================

export function shopifyGidToNumericId(gid: string): string {
  if (typeof gid !== 'string') return String(gid);
  const match = gid.match(/gid:\/\/shopify\/\w+\/(\d+)/);
  return match?.[1] || gid;
}

export function getGraphqlUrl({ shop, apiVersion }: ShopifyConfig): string {
  return `https://${shop}/admin/api/${apiVersion}/graphql.json`;
}

export function getRestBaseUrl({ shop, apiVersion }: ShopifyConfig): string {
  return `https://${shop}/admin/api/${apiVersion}`;
}

export function orderIdToGid(orderId: string): string {
  const id = String(orderId || '').trim();
  if (!id) throw new Error('Missing orderId');
  if (id.startsWith('gid://')) return id;
  return `gid://shopify/Order/${id}`;
}

export function toMoney(set?: ShopifyMoneySet): ShopifyMoney | null {
  if (!set?.shopMoney?.amount) return null;
  return { amount: set.shopMoney.amount, currencyCode: String(set.shopMoney.currencyCode || '') };
}

export function buildOrderDetail(node: ShopifyOrderNode): ShopifyOrderDetail {
  return {
    id: shopifyGidToNumericId(String(node.id || '')),
    gid: String(node.id || ''),
    name: String(node.name || ''),
    email: node.email ?? null,
    tags: Array.isArray(node.tags) ? node.tags : [],
    cancelledAt: node.cancelledAt ?? null,
    createdAt: node.createdAt ?? null,
    displayFinancialStatus: node.displayFinancialStatus ?? null,
    displayFulfillmentStatus: node.displayFulfillmentStatus ?? null,
    totalPrice: toMoney(node.totalPriceSet),
    subtotalPrice: toMoney(node.subtotalPriceSet),
    totalShipping: toMoney(node.totalShippingPriceSet),
    totalTax: toMoney(node.totalTaxSet),
    hasRefunds: (node.refunds || []).length > 0,
    lineItems: (node.lineItems?.edges || []).map((e) => ({
      id: shopifyGidToNumericId(String(e.node?.id || '')),
      gid: String(e.node?.id || ''),
      name: String(e.node?.name || ''),
      sku: e.node?.sku || e.node?.variant?.sku || '',
      quantity: e.node?.quantity ?? 0,
      currentQuantity: e.node?.currentQuantity ?? 0,
      fulfillableQuantity: e.node?.fulfillableQuantity ?? 0,
      unitPrice: toMoney(e.node?.discountedUnitPriceSet),
      totalPrice: toMoney(e.node?.discountedTotalSet),
      variantId: e.node?.variant?.id ? shopifyGidToNumericId(String(e.node.variant.id)) : null,
      variantTitle: e.node?.variant?.title || null,
      productTitle: e.node?.variant?.product?.title || null,
    })),
    transactions: (node.transactions || []).map((t) => ({
      id: shopifyGidToNumericId(String(t.id || '')),
      kind: t.kind ?? null,
      status: t.status ?? null,
      gateway: t.gateway ?? null,
      amount: toMoney(t.amountSet),
    })),
  };
}

export function findLineItemsBySku(
  order: ShopifyOrderDetail,
  skuPattern: string,
): ShopifyOrderLineItem[] {
  const pattern = String(skuPattern).toLowerCase();
  return order.lineItems.filter((li) => {
    const sku = String(li.sku || '').toLowerCase();
    return sku.includes(pattern) || sku === pattern;
  });
}

// ============================================================================
// Internal GraphQL helper (exported for sibling modules)
// ============================================================================

export async function shopifyGraphql({
  shopify,
  query,
  variables,
}: {
  shopify: ShopifyConfig;
  query: string;
  variables?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const url = getGraphqlUrl(shopify);
  const { status, data } = await requestJsonWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': shopify.accessToken,
    },
    body: JSON.stringify({ query, variables }),
    timeoutMs: 30_000,
  });

  if (status >= 400) throw new Error(`Shopify GraphQL HTTP ${status}`);
  if (!data || typeof data !== 'object') throw new Error('Shopify GraphQL response invalid');
  const dataObj = data as { errors?: unknown; data?: Record<string, unknown> };
  if (Array.isArray(dataObj.errors) && dataObj.errors.length) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(dataObj.errors)}`);
  }
  return dataObj.data || {};
}
