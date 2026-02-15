/**
 * Shopify integration — order fetching, tagging, and raw request functions.
 */
import { requestJsonWithRetry, normalizePath, applyQueryParams } from './http.js';
import type { ShopifyConfig } from './config.js';
import {
  shopifyGidToNumericId,
  buildOrderDetail,
  orderIdToGid,
  getRestBaseUrl,
  shopifyGraphql,
} from './shopify-core.js';
import type {
  ShopifyOrder,
  ShopifyOrderSummary,
  ShopifyOrderSortKey,
  ShopifyOrderDetail,
  ShopifyGraphQLConnection,
  ShopifyOrderNode,
} from './shopify-core.js';

export async function shopifyGraphqlRaw(args: {
  shopify: ShopifyConfig;
  query: string;
  variables?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  return shopifyGraphql(args);
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

    const connection = (data as { orders?: ShopifyGraphQLConnection }).orders;
    const edges = Array.isArray(connection?.edges) ? connection.edges : [];

    for (const edge of edges) {
      const node = edge?.node;
      if (!node) continue;

      const fulfillmentOrders = (node.fulfillmentOrders?.edges || [])
        .map((e) => e?.node)
        .filter((n): n is { id?: string; status?: string } => Boolean(n))
        .map((fo) => ({
          id: shopifyGidToNumericId(String(fo.id || '')),
          status: String(fo.status || '').toLowerCase(),
        }));

      orders.push({
        id: shopifyGidToNumericId(String(node.id || '')),
        name: String(node.name || ''),
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
              amount: String(node.totalPriceSet.shopMoney.amount || ''),
              currencyCode: String(node.totalPriceSet.shopMoney.currencyCode || ''),
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

export async function fetchOrders({
  shopify,
  orderQuery,
  limit,
  sortKey = 'CREATED_AT',
  reverse = true,
}: {
  shopify: ShopifyConfig;
  orderQuery: string;
  limit: number;
  sortKey?: ShopifyOrderSortKey;
  reverse?: boolean;
}): Promise<{ orders: ShopifyOrderSummary[]; hasMore: boolean }> {
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 50));
  const pageSize = Math.min(250, safeLimit);
  const queryDoc = `
    query Orders($first: Int!, $after: String, $query: String!, $sortKey: OrderSortKeys, $reverse: Boolean) {
      orders(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) {
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
          }
        }
      }
    }
  `;

  const orders: ShopifyOrderSummary[] = [];
  let after: string | null = null;
  let hasNextPage = true;
  let hitLimit = false;

  while (hasNextPage && orders.length < safeLimit) {
    const first = Math.min(pageSize, safeLimit - orders.length);
    const data = await shopifyGraphql({
      shopify,
      query: queryDoc,
      variables: { first, after, query: orderQuery, sortKey, reverse },
    });

    const connection = (data as { orders?: ShopifyGraphQLConnection }).orders;
    const edges = Array.isArray(connection?.edges) ? connection.edges : [];

    for (const edge of edges) {
      const node = edge?.node;
      if (!node) continue;

      orders.push({
        id: shopifyGidToNumericId(String(node.id || '')),
        name: String(node.name || ''),
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
              amount: String(node.totalPriceSet.shopMoney.amount || ''),
              currencyCode: String(node.totalPriceSet.shopMoney.currencyCode || ''),
            }
          : null,
      });

      if (orders.length >= safeLimit) {
        hitLimit = true;
        break;
      }
    }

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor || null;
  }

  return { orders, hasMore: hasNextPage || hitLimit };
}

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
  const edges = (data as { orders?: ShopifyGraphQLConnection }).orders?.edges || [];

  const targetName = `#${name}`;
  const match = edges.find((e) => e?.node?.name === targetName);

  if (!match || !match.node) {
    throw new Error(`Order ${targetName} not found`);
  }

  const node = match.node;
  return buildOrderDetail(node);
}

export async function fetchOrderById({
  shopify,
  orderId,
}: {
  shopify: ShopifyConfig;
  orderId: string;
}): Promise<ShopifyOrderDetail> {
  const id = String(orderId).trim();
  if (!id) throw new Error('Order ID is required');

  const gid = id.startsWith('gid://') ? id : `gid://shopify/Order/${id}`;
  const queryDoc = `
    query OrderById($id: ID!) {
      node(id: $id) {
        ... on Order {
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
  `;

  const data = await shopifyGraphql({ shopify, query: queryDoc, variables: { id: gid } });
  const node = (data as { node?: ShopifyOrderNode }).node;

  if (!node || !node.id) {
    throw new Error(`Order ${id} not found`);
  }

  return buildOrderDetail(node);
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

  const result = (
    data as { tagsAdd?: { userErrors?: Array<{ field?: string[]; message?: string }> } }
  ).tagsAdd;
  const userErrors = Array.isArray(result?.userErrors) ? result?.userErrors : [];
  if (userErrors.length) {
    throw new Error(`tagsAdd failed for order ${orderId}: ${JSON.stringify(userErrors)}`);
  }

  return { orderId: String(orderId), tagsAdded: cleanedTags };
}

export async function updateOrderTags({
  shopify,
  orderId,
  tags,
}: {
  shopify: ShopifyConfig;
  orderId: string;
  tags: string[] | string;
}): Promise<{ orderId: string; tags: string }> {
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
  const normalizedPath = normalizePath(path, '/orders/123.json');

  const base = getRestBaseUrl(shopify);
  const url = new URL(`${base}${normalizedPath}`);

  applyQueryParams(url, query);

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
