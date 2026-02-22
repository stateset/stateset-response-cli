import { describe, it, expect, vi } from 'vitest';

// Mock the HTTP layer so we never make real API calls
vi.mock('../integrations/http.js', () => ({
  requestJson: vi.fn(),
  requestText: vi.fn(),
  requestJsonWithRetry: vi.fn(),
}));

import {
  shopifyGidToNumericId,
  findLineItemsBySku,
  orderIdToGid,
  toMoney,
  getGraphqlUrl,
  getRestBaseUrl,
  buildOrderDetail,
  type ShopifyOrderDetail,
  type ShopifyOrderNode,
} from '../integrations/shopify-core.js';
import { formatMoney } from '../integrations/format.js';

// =============================================================================
// formatMoney
// =============================================================================

describe('formatMoney', () => {
  it('formats a valid number to 2 decimal places', () => {
    expect(formatMoney(19.99)).toBe('19.99');
    expect(formatMoney(100)).toBe('100.00');
    expect(formatMoney(0)).toBe('0.00');
  });

  it('formats string numbers', () => {
    expect(formatMoney('42.5')).toBe('42.50');
    expect(formatMoney('0.1')).toBe('0.10');
  });

  it('returns string for non-numeric input', () => {
    expect(formatMoney('not-a-number')).toBe('not-a-number');
    expect(formatMoney(undefined)).toBe('undefined');
    // Number(null) === 0, so it formats as '0.00'
    expect(formatMoney(null)).toBe('0.00');
  });

  it('handles negative numbers', () => {
    expect(formatMoney(-5.5)).toBe('-5.50');
  });

  it('handles very large numbers', () => {
    expect(formatMoney(999999.999)).toBe('1000000.00');
  });

  it('handles Infinity as non-finite', () => {
    expect(formatMoney(Infinity)).toBe('Infinity');
    expect(formatMoney(-Infinity)).toBe('-Infinity');
    expect(formatMoney(NaN)).toBe('NaN');
  });
});

// =============================================================================
// shopifyGidToNumericId
// =============================================================================

describe('shopifyGidToNumericId', () => {
  it('extracts numeric ID from GID', () => {
    expect(shopifyGidToNumericId('gid://shopify/Order/123456')).toBe('123456');
  });

  it('extracts from different resource types', () => {
    expect(shopifyGidToNumericId('gid://shopify/LineItem/789')).toBe('789');
    expect(shopifyGidToNumericId('gid://shopify/Product/42')).toBe('42');
    expect(shopifyGidToNumericId('gid://shopify/FulfillmentOrder/999')).toBe('999');
  });

  it('returns original string if not a GID', () => {
    expect(shopifyGidToNumericId('123456')).toBe('123456');
    expect(shopifyGidToNumericId('not-a-gid')).toBe('not-a-gid');
  });

  it('returns string for non-string input', () => {
    expect(shopifyGidToNumericId(null as unknown as string)).toBe('null');
    expect(shopifyGidToNumericId(42 as unknown as string)).toBe('42');
  });

  it('handles empty string', () => {
    expect(shopifyGidToNumericId('')).toBe('');
  });
});

// =============================================================================
// orderIdToGid
// =============================================================================

describe('orderIdToGid', () => {
  it('converts numeric ID to GID', () => {
    expect(orderIdToGid('123456')).toBe('gid://shopify/Order/123456');
  });

  it('passes through existing GIDs', () => {
    expect(orderIdToGid('gid://shopify/Order/123')).toBe('gid://shopify/Order/123');
  });

  it('throws on empty ID', () => {
    expect(() => orderIdToGid('')).toThrow('Missing orderId');
  });

  it('trims whitespace', () => {
    expect(orderIdToGid('  456  ')).toBe('gid://shopify/Order/456');
  });
});

// =============================================================================
// getGraphqlUrl / getRestBaseUrl
// =============================================================================

describe('getGraphqlUrl', () => {
  it('builds correct GraphQL URL', () => {
    const config = { shop: 'mystore.myshopify.com', accessToken: 'tok', apiVersion: '2024-04' };
    expect(getGraphqlUrl(config)).toBe(
      'https://mystore.myshopify.com/admin/api/2024-04/graphql.json',
    );
  });
});

describe('getRestBaseUrl', () => {
  it('builds correct REST URL', () => {
    const config = { shop: 'mystore.myshopify.com', accessToken: 'tok', apiVersion: '2024-04' };
    expect(getRestBaseUrl(config)).toBe('https://mystore.myshopify.com/admin/api/2024-04');
  });
});

// =============================================================================
// toMoney
// =============================================================================

describe('toMoney', () => {
  it('returns null for undefined input', () => {
    expect(toMoney(undefined)).toBeNull();
  });

  it('returns null for empty shopMoney', () => {
    expect(toMoney({ shopMoney: {} as { amount: string; currencyCode: string } })).toBeNull();
  });

  it('returns money object for valid input', () => {
    const result = toMoney({
      shopMoney: { amount: '19.99', currencyCode: 'USD' },
    });
    expect(result).toEqual({ amount: '19.99', currencyCode: 'USD' });
  });

  it('coerces currencyCode to string', () => {
    const result = toMoney({
      shopMoney: { amount: '10.00', currencyCode: '' },
    });
    expect(result).toEqual({ amount: '10.00', currencyCode: '' });
  });
});

// =============================================================================
// findLineItemsBySku
// =============================================================================

describe('findLineItemsBySku', () => {
  const makeOrder = (lineItems: Array<{ id: string; sku: string }>): ShopifyOrderDetail => ({
    id: '1',
    gid: 'gid://shopify/Order/1',
    name: '#1001',
    email: null,
    tags: [],
    cancelledAt: null,
    createdAt: null,
    displayFinancialStatus: null,
    displayFulfillmentStatus: null,
    totalPrice: null,
    subtotalPrice: null,
    totalShipping: null,
    totalTax: null,
    hasRefunds: false,
    lineItems: lineItems.map((li) => ({
      ...li,
      gid: `gid://shopify/LineItem/${li.id}`,
      name: `Item ${li.id}`,
      quantity: 1,
      currentQuantity: 1,
      fulfillableQuantity: 1,
      unitPrice: null,
      totalPrice: null,
      variantId: null,
      variantTitle: null,
      productTitle: null,
    })),
    transactions: [],
  });

  it('finds line items by exact SKU match', () => {
    const order = makeOrder([
      { id: '1', sku: 'SY-MIR-004' },
      { id: '2', sku: 'MINI-BAG' },
    ]);
    const result = findLineItemsBySku(order, 'SY-MIR-004');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('finds line items by partial SKU match', () => {
    const order = makeOrder([
      { id: '1', sku: 'SY-MIR-004-BLK' },
      { id: '2', sku: 'SY-MIR-004-WHT' },
      { id: '3', sku: 'MINI-BAG' },
    ]);
    const result = findLineItemsBySku(order, 'SY-MIR');
    expect(result).toHaveLength(2);
  });

  it('is case-insensitive', () => {
    const order = makeOrder([{ id: '1', sku: 'ABC-123' }]);
    const result = findLineItemsBySku(order, 'abc-123');
    expect(result).toHaveLength(1);
  });

  it('returns empty array when no match', () => {
    const order = makeOrder([{ id: '1', sku: 'ABC' }]);
    expect(findLineItemsBySku(order, 'XYZ')).toHaveLength(0);
  });

  it('handles empty lineItems', () => {
    const order = makeOrder([]);
    expect(findLineItemsBySku(order, 'ABC')).toHaveLength(0);
  });

  it('handles empty SKU on line items', () => {
    const order = makeOrder([{ id: '1', sku: '' }]);
    expect(findLineItemsBySku(order, 'ABC')).toHaveLength(0);
  });
});

// =============================================================================
// buildOrderDetail
// =============================================================================

describe('buildOrderDetail', () => {
  it('builds order detail from minimal node', () => {
    const node: ShopifyOrderNode = {
      id: 'gid://shopify/Order/123',
      name: '#1001',
    };
    const detail = buildOrderDetail(node);
    expect(detail.id).toBe('123');
    expect(detail.gid).toBe('gid://shopify/Order/123');
    expect(detail.name).toBe('#1001');
    expect(detail.email).toBeNull();
    expect(detail.tags).toEqual([]);
    expect(detail.lineItems).toEqual([]);
    expect(detail.transactions).toEqual([]);
    expect(detail.hasRefunds).toBe(false);
  });

  it('extracts numeric ID from GID', () => {
    const node: ShopifyOrderNode = {
      id: 'gid://shopify/Order/456789',
    };
    const detail = buildOrderDetail(node);
    expect(detail.id).toBe('456789');
  });

  it('maps line items from node', () => {
    const node: ShopifyOrderNode = {
      id: 'gid://shopify/Order/1',
      name: '#1001',
      lineItems: {
        edges: [
          {
            node: {
              id: 'gid://shopify/LineItem/100',
              name: 'Widget',
              sku: 'WDG-001',
              quantity: 2,
              currentQuantity: 2,
              fulfillableQuantity: 2,
            },
          },
        ],
      },
    };
    const detail = buildOrderDetail(node);
    expect(detail.lineItems).toHaveLength(1);
    expect(detail.lineItems[0].id).toBe('100');
    expect(detail.lineItems[0].name).toBe('Widget');
    expect(detail.lineItems[0].sku).toBe('WDG-001');
    expect(detail.lineItems[0].quantity).toBe(2);
  });

  it('maps transactions from node', () => {
    const node: ShopifyOrderNode = {
      id: 'gid://shopify/Order/1',
      transactions: [
        {
          id: 'gid://shopify/Transaction/50',
          kind: 'sale',
          status: 'success',
          gateway: 'stripe',
          amountSet: { shopMoney: { amount: '25.00', currencyCode: 'USD' } },
        },
      ],
    };
    const detail = buildOrderDetail(node);
    expect(detail.transactions).toHaveLength(1);
    expect(detail.transactions[0].id).toBe('50');
    expect(detail.transactions[0].kind).toBe('sale');
    expect(detail.transactions[0].amount).toEqual({ amount: '25.00', currencyCode: 'USD' });
  });

  it('detects refunds', () => {
    const node: ShopifyOrderNode = {
      id: 'gid://shopify/Order/1',
      refunds: [{ id: 'refund1' }],
    };
    const detail = buildOrderDetail(node);
    expect(detail.hasRefunds).toBe(true);
  });

  it('maps price fields', () => {
    const node: ShopifyOrderNode = {
      id: 'gid://shopify/Order/1',
      totalPriceSet: { shopMoney: { amount: '100.00', currencyCode: 'USD' } },
      subtotalPriceSet: { shopMoney: { amount: '90.00', currencyCode: 'USD' } },
      totalShippingPriceSet: { shopMoney: { amount: '5.00', currencyCode: 'USD' } },
      totalTaxSet: { shopMoney: { amount: '5.00', currencyCode: 'USD' } },
    };
    const detail = buildOrderDetail(node);
    expect(detail.totalPrice).toEqual({ amount: '100.00', currencyCode: 'USD' });
    expect(detail.subtotalPrice).toEqual({ amount: '90.00', currencyCode: 'USD' });
    expect(detail.totalShipping).toEqual({ amount: '5.00', currencyCode: 'USD' });
    expect(detail.totalTax).toEqual({ amount: '5.00', currencyCode: 'USD' });
  });

  it('handles missing optional fields gracefully', () => {
    const node: ShopifyOrderNode = {};
    const detail = buildOrderDetail(node);
    expect(detail.id).toBe('');
    expect(detail.name).toBe('');
    expect(detail.email).toBeNull();
    expect(detail.cancelledAt).toBeNull();
    expect(detail.totalPrice).toBeNull();
    expect(detail.hasRefunds).toBe(false);
  });

  it('extracts sku from variant when lineItem sku is empty', () => {
    const node: ShopifyOrderNode = {
      id: 'gid://shopify/Order/1',
      lineItems: {
        edges: [
          {
            node: {
              id: 'gid://shopify/LineItem/1',
              name: 'Test',
              sku: '',
              quantity: 1,
              currentQuantity: 1,
              fulfillableQuantity: 1,
              variant: { sku: 'VAR-SKU-001' },
            },
          },
        ],
      },
    };
    const detail = buildOrderDetail(node);
    expect(detail.lineItems[0].sku).toBe('VAR-SKU-001');
  });

  it('preserves tags array', () => {
    const node: ShopifyOrderNode = {
      id: 'gid://shopify/Order/1',
      tags: ['pre-order', 'vip'],
    };
    const detail = buildOrderDetail(node);
    expect(detail.tags).toEqual(['pre-order', 'vip']);
  });

  it('maps variant info from line items', () => {
    const node: ShopifyOrderNode = {
      id: 'gid://shopify/Order/1',
      lineItems: {
        edges: [
          {
            node: {
              id: 'gid://shopify/LineItem/1',
              name: 'Widget',
              quantity: 1,
              currentQuantity: 1,
              fulfillableQuantity: 1,
              variant: {
                id: 'gid://shopify/ProductVariant/200',
                title: 'Large / Blue',
                product: { title: 'Cool Widget' },
              },
            },
          },
        ],
      },
    };
    const detail = buildOrderDetail(node);
    expect(detail.lineItems[0].variantId).toBe('200');
    expect(detail.lineItems[0].variantTitle).toBe('Large / Blue');
    expect(detail.lineItems[0].productTitle).toBe('Cool Widget');
  });
});
