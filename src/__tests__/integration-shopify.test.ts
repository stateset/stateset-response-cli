/**
 * Tests for Shopify pure utility functions: shopifyGidToNumericId, findLineItemsBySku
 */
import { describe, it, expect } from 'vitest';
import { shopifyGidToNumericId, findLineItemsBySku } from '../integrations/shopify.js';
import type { ShopifyOrderDetail } from '../integrations/shopify.js';

const mockOrder: ShopifyOrderDetail = {
  id: '123',
  gid: 'gid://shopify/Order/123',
  name: '#1001',
  email: 'test@example.com',
  tags: [],
  cancelledAt: null,
  createdAt: '2026-01-01',
  displayFinancialStatus: 'paid',
  displayFulfillmentStatus: 'fulfilled',
  totalPrice: { amount: '100.00', currencyCode: 'USD' },
  subtotalPrice: { amount: '90.00', currencyCode: 'USD' },
  totalShipping: { amount: '10.00', currencyCode: 'USD' },
  totalTax: { amount: '0.00', currencyCode: 'USD' },
  hasRefunds: false,
  lineItems: [
    {
      id: '1',
      gid: 'gid://shopify/LineItem/1',
      name: 'Widget A',
      sku: 'SKU-WIDGET-A',
      quantity: 2,
      currentQuantity: 2,
      fulfillableQuantity: 2,
      unitPrice: null,
      totalPrice: null,
      variantId: null,
      variantTitle: null,
      productTitle: null,
    },
    {
      id: '2',
      gid: 'gid://shopify/LineItem/2',
      name: 'Widget B',
      sku: 'SKU-WIDGET-B',
      quantity: 1,
      currentQuantity: 1,
      fulfillableQuantity: 1,
      unitPrice: null,
      totalPrice: null,
      variantId: null,
      variantTitle: null,
      productTitle: null,
    },
    {
      id: '3',
      gid: 'gid://shopify/LineItem/3',
      name: 'Gadget',
      sku: 'GAD-001',
      quantity: 3,
      currentQuantity: 3,
      fulfillableQuantity: 3,
      unitPrice: null,
      totalPrice: null,
      variantId: null,
      variantTitle: null,
      productTitle: null,
    },
  ],
  transactions: [],
};

describe('shopifyGidToNumericId', () => {
  it('extracts numeric ID from Order GID', () => {
    expect(shopifyGidToNumericId('gid://shopify/Order/12345')).toBe('12345');
  });

  it('extracts numeric ID from LineItem GID', () => {
    expect(shopifyGidToNumericId('gid://shopify/LineItem/99')).toBe('99');
  });

  it('passes through plain numeric string', () => {
    expect(shopifyGidToNumericId('12345')).toBe('12345');
  });

  it('passes through empty string', () => {
    expect(shopifyGidToNumericId('')).toBe('');
  });

  it('handles non-matching gid format', () => {
    expect(shopifyGidToNumericId('gid://other/Foo/123')).toBe('gid://other/Foo/123');
  });
});

describe('findLineItemsBySku', () => {
  it('finds items by exact SKU match', () => {
    const result = findLineItemsBySku(mockOrder, 'SKU-WIDGET-A');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Widget A');
  });

  it('finds items by partial SKU match', () => {
    const result = findLineItemsBySku(mockOrder, 'WIDGET');
    expect(result).toHaveLength(2);
    expect(result.map((li) => li.name)).toEqual(['Widget A', 'Widget B']);
  });

  it('returns empty array for non-existent SKU', () => {
    const result = findLineItemsBySku(mockOrder, 'NONEXISTENT');
    expect(result).toEqual([]);
  });

  it('performs case-insensitive matching', () => {
    const result = findLineItemsBySku(mockOrder, 'sku-widget-a');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Widget A');
  });

  it('handles order with empty lineItems', () => {
    const emptyOrder: ShopifyOrderDetail = {
      ...mockOrder,
      lineItems: [],
    };
    const result = findLineItemsBySku(emptyOrder, 'SKU-WIDGET-A');
    expect(result).toEqual([]);
  });
});
