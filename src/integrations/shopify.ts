import { requestJsonWithRetry } from './http.js';
import { createLimiter } from './limit.js';
import type { ShopifyConfig } from './config.js';

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

export function shopifyGidToNumericId(gid: string): string {
  if (typeof gid !== 'string') return String(gid);
  const match = gid.match(/gid:\/\/shopify\/\w+\/(\d+)/);
  return match?.[1] || gid;
}

function getGraphqlUrl({ shop, apiVersion }: ShopifyConfig): string {
  return `https://${shop}/admin/api/${apiVersion}/graphql.json`;
}

function getRestBaseUrl({ shop, apiVersion }: ShopifyConfig): string {
  return `https://${shop}/admin/api/${apiVersion}`;
}

async function shopifyGraphql({
  shopify,
  query,
  variables,
}: {
  shopify: ShopifyConfig;
  query: string;
  variables?: Record<string, unknown>;
}): Promise<Record<string, any>> {
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
  const dataObj = data as { errors?: unknown; data?: Record<string, any> };
  if (Array.isArray(dataObj.errors) && dataObj.errors.length) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(dataObj.errors)}`);
  }
  return dataObj.data || {};
}

export async function shopifyGraphqlRaw(args: {
  shopify: ShopifyConfig;
  query: string;
  variables?: Record<string, unknown>;
}): Promise<Record<string, any>> {
  return shopifyGraphql(args);
}

function orderIdToGid(orderId: string): string {
  const id = String(orderId || '').trim();
  if (!id) throw new Error('Missing orderId');
  if (id.startsWith('gid://')) return id;
  return `gid://shopify/Order/${id}`;
}

export async function addOrderTags({
  shopify,
  orderId,
  tags,
}: {
  shopify: ShopifyConfig;
  orderId: string;
  tags: string[] | string;
}): Promise<{ orderId: string; tagsAdded: string[] }> {
  const tagsArray = Array.isArray(tags) ? tags.map((t) => String(t)) : [String(tags)];
  const cleanedTags = tagsArray.map((t) => t.trim()).filter(Boolean);
  if (cleanedTags.length === 0) throw new Error('No tags provided.');

  const mutation = `
    mutation AddTags($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) {
        node { id }
        userErrors { field message }
      }
    }
  `;

  const data = await shopifyGraphql({
    shopify,
    query: mutation,
    variables: { id: orderIdToGid(orderId), tags: cleanedTags },
  });

  const result = (data as { tagsAdd?: { userErrors?: Array<{ field?: string[]; message?: string }> } })
    .tagsAdd;
  const userErrors = Array.isArray(result?.userErrors) ? result?.userErrors : [];
  if (userErrors.length) {
    throw new Error(`tagsAdd failed for order ${orderId}: ${JSON.stringify(userErrors)}`);
  }

  return { orderId: String(orderId), tagsAdded: cleanedTags };
}

export async function fetchOrdersWithHoldInfo({
  shopify,
  orderQuery,
  limit,
}: {
  shopify: ShopifyConfig;
  orderQuery: string;
  limit: number;
}): Promise<{ orders: ShopifyOrder[] }> {
  const pageSize = Math.min(100, Math.max(1, Number(limit) || 50));
  const queryDoc = `
    query OrdersWithFulfillmentHolds($first: Int!, $after: String, $query: String!) {
      orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: false) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            name
            email
            tags
            cancelledAt
            createdAt
            updatedAt
            displayFinancialStatus
            displayFulfillmentStatus
            totalPriceSet { shopMoney { amount currencyCode } }
            fulfillmentOrders(first: 25) {
              edges { node { id status } }
            }
          }
        }
      }
    }
  `;

  const orders: ShopifyOrder[] = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage && orders.length < limit) {
    const data = await shopifyGraphql({
      shopify,
      query: queryDoc,
      variables: { first: pageSize, after, query: orderQuery },
    });

    const connection = (data as { orders?: any }).orders;
    const edges = Array.isArray(connection?.edges) ? connection.edges : [];

    for (const edge of edges) {
      const node = edge?.node;
      if (!node) continue;

      const fulfillmentOrders = (node.fulfillmentOrders?.edges || [])
        .map((e: { node?: { id?: string; status?: string } }) => e?.node)
        .filter(Boolean)
        .map((fo: { id?: string; status?: string }) => ({
          id: shopifyGidToNumericId(String(fo.id || '')),
          status: String(fo.status || '').toLowerCase(),
        }));

      orders.push({
        id: shopifyGidToNumericId(String(node.id || '')),
        name: node.name,
        email: node.email ?? null,
        tags: Array.isArray(node.tags) ? node.tags : [],
        cancelledAt: node.cancelledAt ?? null,
        createdAt: node.createdAt ?? null,
        updatedAt: node.updatedAt ?? null,
        displayFinancialStatus: node.displayFinancialStatus
          ? String(node.displayFinancialStatus).toLowerCase()
          : null,
        displayFulfillmentStatus: node.displayFulfillmentStatus
          ? String(node.displayFulfillmentStatus).toLowerCase()
          : null,
        totalPrice: node.totalPriceSet?.shopMoney
          ? {
              amount: node.totalPriceSet.shopMoney.amount,
              currencyCode: node.totalPriceSet.shopMoney.currencyCode,
            }
          : null,
        fulfillmentOrders,
      });

      if (orders.length >= limit) break;
    }

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor || null;
  }

  return { orders };
}

async function releaseHoldForFulfillmentOrder({
  shopify,
  fulfillmentOrderId,
}: {
  shopify: ShopifyConfig;
  fulfillmentOrderId: string;
}): Promise<{ fulfillmentOrderId: string; newStatus: string | null }> {
  const base = getRestBaseUrl(shopify);
  const url = `${base}/fulfillment_orders/${fulfillmentOrderId}/release_hold.json`;
  const { status, data } = await requestJsonWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': shopify.accessToken,
    },
    body: JSON.stringify({}),
    timeoutMs: 30_000,
  });

  if (status >= 400) {
    const msg = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(
      `Release hold failed for fulfillment order ${fulfillmentOrderId} (${status}): ${msg}`
    );
  }

  const dataObj = data as { fulfillment_order?: { status?: string } };

  return {
    fulfillmentOrderId,
    newStatus: dataObj.fulfillment_order?.status
      ? String(dataObj.fulfillment_order.status).toLowerCase()
      : null,
  };
}

export async function releaseHoldsForOrders({
  shopify,
  orders,
  concurrency,
}: {
  shopify: ShopifyConfig;
  orders: ShopifyOrder[];
  concurrency: number;
}): Promise<{
  releasedFulfillmentOrders: Array<{ orderId: string; orderName: string; fulfillmentOrderId: string; newStatus: string | null }>;
  failedFulfillmentOrders: Array<{ orderId: string; orderName: string; fulfillmentOrderId: string; error: string }>;
  ordersWithAnyRelease: string[];
}> {
  const limit = createLimiter(Math.max(1, Number(concurrency) || 2));

  const releasedFulfillmentOrders: Array<{ orderId: string; orderName: string; fulfillmentOrderId: string; newStatus: string | null }> = [];
  const failedFulfillmentOrders: Array<{ orderId: string; orderName: string; fulfillmentOrderId: string; error: string }> = [];
  const ordersWithAnyRelease = new Set<string>();

  const tasks: Array<Promise<unknown>> = [];
  for (const order of orders) {
    const onHold = order.fulfillmentOrders.filter((fo) => fo.status === 'on_hold');
    for (const fulfillmentOrder of onHold) {
      tasks.push(
        limit(async () => {
          try {
            const result = await releaseHoldForFulfillmentOrder({
              shopify,
              fulfillmentOrderId: fulfillmentOrder.id,
            });
            releasedFulfillmentOrders.push({
              orderId: order.id,
              orderName: order.name,
              fulfillmentOrderId: result.fulfillmentOrderId,
              newStatus: result.newStatus,
            });
            ordersWithAnyRelease.add(order.id);
          } catch (error) {
            failedFulfillmentOrders.push({
              orderId: order.id,
              orderName: order.name,
              fulfillmentOrderId: fulfillmentOrder.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        })
      );
    }
  }

  await Promise.all(tasks);

  return {
    releasedFulfillmentOrders,
    failedFulfillmentOrders,
    ordersWithAnyRelease: Array.from(ordersWithAnyRelease),
  };
}

export async function updateOrderTags({
  shopify,
  orderId,
  tags,
}: {
  shopify: ShopifyConfig;
  orderId: string;
  tags: string[] | string;
}): Promise<{ orderId: string; tags: string }>
{
  const base = getRestBaseUrl(shopify);
  const url = `${base}/orders/${orderId}.json`;

  const tagString = Array.isArray(tags) ? tags.join(', ') : String(tags || '');

  const { status, data } = await requestJsonWithRetry(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': shopify.accessToken,
    },
    body: JSON.stringify({ order: { id: orderId, tags: tagString } }),
    timeoutMs: 30_000,
  });

  if (status >= 400) {
    const msg = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`Update order tags failed for order ${orderId} (${status}): ${msg}`);
  }

  const dataObj = data as { order?: { tags?: string } };
  return { orderId, tags: dataObj.order?.tags || tagString };
}

// ============================================================================
// Refund-related functions
// ============================================================================

export async function fetchOrderByName({
  shopify,
  orderName,
}: {
  shopify: ShopifyConfig;
  orderName: string;
}): Promise<ShopifyOrderDetail> {
  const name = String(orderName).replace(/^#/, '').trim();
  if (!name) throw new Error('Order name is required');

  const query = `name:${name}`;
  const queryDoc = `
    query OrderByName($query: String!) {
      orders(first: 5, query: $query) {
        edges {
          node {
            id
            name
            email
            tags
            cancelledAt
            createdAt
            displayFinancialStatus
            displayFulfillmentStatus
            totalPriceSet { shopMoney { amount currencyCode } }
            subtotalPriceSet { shopMoney { amount currencyCode } }
            totalShippingPriceSet { shopMoney { amount currencyCode } }
            totalTaxSet { shopMoney { amount currencyCode } }
            refunds { id }
            lineItems(first: 50) {
              edges {
                node {
                  id
                  name
                  sku
                  quantity
                  nonFulfillableQuantity
                  fulfillableQuantity
                  currentQuantity
                  originalUnitPriceSet { shopMoney { amount currencyCode } }
                  discountedUnitPriceSet { shopMoney { amount currencyCode } }
                  originalTotalSet { shopMoney { amount currencyCode } }
                  discountedTotalSet { shopMoney { amount currencyCode } }
                  variant {
                    id
                    sku
                    title
                    product { id title }
                  }
                }
              }
            }
            transactions(first: 20) {
              id
              kind
              status
              gateway
              amountSet { shopMoney { amount currencyCode } }
            }
          }
        }
      }
    }
  `;

  const data = await shopifyGraphql({ shopify, query: queryDoc, variables: { query } });
  const edges = (data as { orders?: { edges?: Array<{ node?: any }> } }).orders?.edges || [];

  const targetName = `#${name}`;
  const match = edges.find((e) => e?.node?.name === targetName);

  if (!match || !match.node) {
    throw new Error(`Order ${targetName} not found`);
  }

  const node = match.node;
  return {
    id: shopifyGidToNumericId(String(node.id || '')),
    gid: String(node.id || ''),
    name: node.name,
    email: node.email ?? null,
    tags: Array.isArray(node.tags) ? node.tags : [],
    cancelledAt: node.cancelledAt ?? null,
    createdAt: node.createdAt ?? null,
    displayFinancialStatus: node.displayFinancialStatus ?? null,
    displayFulfillmentStatus: node.displayFulfillmentStatus ?? null,
    totalPrice: node.totalPriceSet?.shopMoney || null,
    subtotalPrice: node.subtotalPriceSet?.shopMoney || null,
    totalShipping: node.totalShippingPriceSet?.shopMoney || null,
    totalTax: node.totalTaxSet?.shopMoney || null,
    hasRefunds: (node.refunds || []).length > 0,
    lineItems: (node.lineItems?.edges || []).map((e: { node: any }) => ({
      id: shopifyGidToNumericId(String(e.node.id || '')),
      gid: String(e.node.id || ''),
      name: e.node.name,
      sku: e.node.sku || e.node.variant?.sku || '',
      quantity: e.node.quantity,
      currentQuantity: e.node.currentQuantity,
      fulfillableQuantity: e.node.fulfillableQuantity,
      unitPrice: e.node.discountedUnitPriceSet?.shopMoney || null,
      totalPrice: e.node.discountedTotalSet?.shopMoney || null,
      variantId: e.node.variant?.id ? shopifyGidToNumericId(String(e.node.variant.id)) : null,
      variantTitle: e.node.variant?.title || null,
      productTitle: e.node.variant?.product?.title || null,
    })),
    transactions: (node.transactions || []).map((t: any) => ({
      id: shopifyGidToNumericId(String(t.id || '')),
      kind: t.kind ?? null,
      status: t.status ?? null,
      gateway: t.gateway ?? null,
      amount: t.amountSet?.shopMoney || null,
    })),
  };
}

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

  const refund = (data as { refund?: any }).refund;
  if (!refund) throw new Error('Invalid response from calculate refund');

  return {
    orderId,
    transactions: (refund.transactions || []).map((t: any) => ({
      amount: t.amount,
      kind: t.kind ?? null,
      gateway: t.gateway ?? null,
      parentId: t.parent_id ?? null,
    })),
    refundLineItems: (refund.refund_line_items || []).map((rli: any) => ({
      lineItemId: rli.line_item_id,
      quantity: rli.quantity,
      subtotal: rli.subtotal,
      totalTax: rli.total_tax,
    })),
    shipping: refund.shipping
      ? {
          amount: refund.shipping.amount,
          tax: refund.shipping.tax,
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

  const refund = (data as { refund?: any }).refund;
  if (!refund) throw new Error('Invalid response from create refund');

  return {
    refundId: refund.id,
    orderId,
    note: refund.note ?? null,
    createdAt: refund.created_at ?? null,
    transactions: (refund.transactions || []).map((t: any) => ({
      id: t.id,
      amount: t.amount,
      kind: t.kind ?? null,
      status: t.status ?? null,
      gateway: t.gateway ?? null,
    })),
    refundLineItems: (refund.refund_line_items || []).map((rli: any) => ({
      lineItemId: rli.line_item_id,
      quantity: rli.quantity,
      subtotal: rli.subtotal,
      totalTax: rli.total_tax,
    })),
  };
}

export function findLineItemsBySku(order: ShopifyOrderDetail, skuPattern: string): ShopifyOrderLineItem[] {
  const pattern = String(skuPattern).toLowerCase();
  return order.lineItems.filter((li) => {
    const sku = String(li.sku || '').toLowerCase();
    return sku.includes(pattern) || sku === pattern;
  });
}

export async function shopifyRestRequest({
  shopify,
  method,
  path,
  query,
  body,
}: {
  shopify: ShopifyConfig;
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined> | null;
  body?: Record<string, unknown> | null;
}): Promise<{ status: number; data: unknown }> {
  let normalizedPath = String(path || '').trim();
  if (!normalizedPath) {
    throw new Error('Path is required');
  }
  if (normalizedPath.startsWith('http://') || normalizedPath.startsWith('https://')) {
    throw new Error('Path must be relative (e.g., /orders/123.json)');
  }
  if (!normalizedPath.startsWith('/')) {
    normalizedPath = `/${normalizedPath}`;
  }

  const base = getRestBaseUrl(shopify);
  const url = new URL(`${base}${normalizedPath}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  const { status, data } = await requestJsonWithRetry(url.toString(), {
    method: method.toUpperCase(),
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': shopify.accessToken,
    },
    body: body ? JSON.stringify(body) : undefined,
    timeoutMs: 30_000,
  });

  return { status, data };
}
