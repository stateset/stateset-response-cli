/**
 * Shopify integration — fulfillment hold release operations.
 */
import { requestJsonWithRetry } from './http.js';
import { getErrorMessage } from '../lib/errors.js';
import type { ShopifyConfig } from './config.js';
import { createLimiter } from './limit.js';
import { getRestBaseUrl } from './shopify-core.js';
import type { ShopifyOrder } from './shopify-core.js';

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
      `Release hold failed for fulfillment order ${fulfillmentOrderId} (${status}): ${msg}`,
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
  releasedFulfillmentOrders: Array<{
    orderId: string;
    orderName: string;
    fulfillmentOrderId: string;
    newStatus: string | null;
  }>;
  failedFulfillmentOrders: Array<{
    orderId: string;
    orderName: string;
    fulfillmentOrderId: string;
    error: string;
  }>;
  ordersWithAnyRelease: string[];
}> {
  const limit = createLimiter(Math.max(1, Number(concurrency) || 2));

  const releasedFulfillmentOrders: Array<{
    orderId: string;
    orderName: string;
    fulfillmentOrderId: string;
    newStatus: string | null;
  }> = [];
  const failedFulfillmentOrders: Array<{
    orderId: string;
    orderName: string;
    fulfillmentOrderId: string;
    error: string;
  }> = [];
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
              error: getErrorMessage(error),
            });
          }
        }),
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
