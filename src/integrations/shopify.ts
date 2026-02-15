/**
 * Shopify integration — barrel export.
 *
 * Implementation is split across:
 * - shopify-core.ts    — types, utilities, internal GraphQL helper
 * - shopify-orders.ts  — order fetching, tagging, raw requests
 * - shopify-refund-ops.ts — refund calculation and creation
 * - shopify-hold-ops.ts   — fulfillment hold release
 */

// Types
export type {
  ShopifyMoney,
  ShopifyFulfillmentOrder,
  ShopifyOrder,
  ShopifyOrderSummary,
  ShopifyOrderSortKey,
  ShopifyOrderLineItem,
  ShopifyOrderTransaction,
  ShopifyOrderDetail,
  RefundLineItemInput,
  RefundCalculation,
  RefundResult,
} from './shopify-core.js';

// Utility functions
export { shopifyGidToNumericId, findLineItemsBySku } from './shopify-core.js';

// Order operations
export {
  shopifyGraphqlRaw,
  fetchOrdersWithHoldInfo,
  fetchOrders,
  fetchOrderByName,
  fetchOrderById,
  addOrderTags,
  updateOrderTags,
  shopifyRestRequest,
} from './shopify-orders.js';

// Refund operations
export { calculateRefund, createRefund } from './shopify-refund-ops.js';

// Hold operations
export { releaseHoldsForOrders } from './shopify-hold-ops.js';
