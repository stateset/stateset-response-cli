import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockMcpServer } from './helpers/mocks.js';

// ---------------------------------------------------------------------------
// Mock integration modules
// ---------------------------------------------------------------------------

const mockGorgiasApi = {
  listTickets: vi.fn(),
  getTicket: vi.fn(),
  updateTicket: vi.fn(),
  addMessage: vi.fn(),
  getTicketMessages: vi.fn(),
  listMacros: vi.fn(),
  getMacro: vi.fn(),
  applyMacro: vi.fn(),
  mergeTickets: vi.fn(),
  listUsers: vi.fn(),
  listTeams: vi.fn(),
  requestRaw: vi.fn(),
};

vi.mock('../integrations/gorgias.js', () => ({
  createGorgiasApi: vi.fn(() => mockGorgiasApi),
}));

vi.mock('../integrations/recharge.js', () => ({
  rechargeRequest: vi.fn(),
}));

vi.mock('../integrations/shopify.js', () => ({
  fetchOrders: vi.fn(),
  fetchOrderById: vi.fn(),
  fetchOrderByName: vi.fn(),
  fetchOrdersWithHoldInfo: vi.fn(),
  releaseHoldsForOrders: vi.fn(),
  addOrderTags: vi.fn(),
  calculateRefund: vi.fn(),
  createRefund: vi.fn(),
  findLineItemsBySku: vi.fn(),
  shopifyGraphqlRaw: vi.fn(),
  shopifyRestRequest: vi.fn(),
}));

vi.mock('../integrations/loop.js', () => ({
  loopRequest: vi.fn(),
}));

vi.mock('../integrations/shipstation.js', () => ({
  shipstationRequest: vi.fn(),
}));

vi.mock('../integrations/shiphero.js', () => ({
  shipheroGraphql: vi.fn(),
}));

vi.mock('../integrations/shipfusion.js', () => ({
  shipfusionRequest: vi.fn(),
}));

vi.mock('../integrations/shiphawk.js', () => ({
  shiphawkRequest: vi.fn(),
}));

vi.mock('../integrations/zendesk.js', () => ({
  zendeskRequest: vi.fn(),
}));

vi.mock('../integrations/amazon.js', () => ({
  amazonRequest: vi.fn(),
}));

vi.mock('../integrations/skio.js', () => ({
  skioRequest: vi.fn(),
}));

vi.mock('../integrations/stayai.js', () => ({
  stayAiRequest: vi.fn(),
}));

vi.mock('../integrations/redact.js', () => ({
  redactPii: vi.fn((v: unknown) => v),
}));

vi.mock('../integrations/format.js', () => ({
  formatMoney: vi.fn((v: unknown) => String(v)),
}));

// ---------------------------------------------------------------------------
// Import the register functions and mocked request functions
// ---------------------------------------------------------------------------

import { registerGorgiasTools } from '../mcp-server/tools/gorgias.js';
import { registerRechargeTools } from '../mcp-server/tools/recharge.js';
import { registerShopifyOrderTools } from '../mcp-server/tools/shopify-orders.js';
import { registerShopifyHoldsTools } from '../mcp-server/tools/shopify-holds.js';
import { registerShopifyRefundTools } from '../mcp-server/tools/shopify-refunds.js';
import { registerShopifyAdvancedTools } from '../mcp-server/tools/shopify-advanced.js';
import { registerLoopTools } from '../mcp-server/tools/loop.js';
import { registerShipStationTools } from '../mcp-server/tools/shipstation.js';
import { registerShipHeroTools } from '../mcp-server/tools/shiphero.js';
import { registerShipFusionTools } from '../mcp-server/tools/shipfusion.js';
import { registerShipHawkTools } from '../mcp-server/tools/shiphawk.js';
import { registerZendeskTools } from '../mcp-server/tools/zendesk.js';
import { registerAmazonTools } from '../mcp-server/tools/amazon.js';
import { registerSkioTools } from '../mcp-server/tools/skio.js';
import { registerStayAiTools } from '../mcp-server/tools/stayai.js';

import { rechargeRequest } from '../integrations/recharge.js';
import {
  fetchOrders,
  fetchOrderById,
  fetchOrderByName,
  fetchOrdersWithHoldInfo,
  releaseHoldsForOrders,
  addOrderTags,
  calculateRefund,
  createRefund,
  findLineItemsBySku,
  shopifyGraphqlRaw,
  shopifyRestRequest,
} from '../integrations/shopify.js';
import { loopRequest } from '../integrations/loop.js';
import { shipstationRequest } from '../integrations/shipstation.js';
import { shipheroGraphql } from '../integrations/shiphero.js';
import { shipfusionRequest } from '../integrations/shipfusion.js';
import { shiphawkRequest } from '../integrations/shiphawk.js';
import { zendeskRequest } from '../integrations/zendesk.js';
import { amazonRequest } from '../integrations/amazon.js';
import { skioRequest } from '../integrations/skio.js';
import { stayAiRequest } from '../integrations/stayai.js';

const rechargeRequestMock = vi.mocked(rechargeRequest);
const fetchOrdersMock = vi.mocked(fetchOrders);
const fetchOrderByIdMock = vi.mocked(fetchOrderById);
const fetchOrderByNameMock = vi.mocked(fetchOrderByName);
const fetchOrdersWithHoldInfoMock = vi.mocked(fetchOrdersWithHoldInfo);
const releaseHoldsForOrdersMock = vi.mocked(releaseHoldsForOrders);
const addOrderTagsMock = vi.mocked(addOrderTags);
const calculateRefundMock = vi.mocked(calculateRefund);
const createRefundMock = vi.mocked(createRefund);
const findLineItemsBySkuMock = vi.mocked(findLineItemsBySku);
const shopifyGraphqlRawMock = vi.mocked(shopifyGraphqlRaw);
const shopifyRestRequestMock = vi.mocked(shopifyRestRequest);
const loopRequestMock = vi.mocked(loopRequest);
const shipstationRequestMock = vi.mocked(shipstationRequest);
const shipheroGraphqlMock = vi.mocked(shipheroGraphql);
const shipfusionRequestMock = vi.mocked(shipfusionRequest);
const shiphawkRequestMock = vi.mocked(shiphawkRequest);
const zendeskRequestMock = vi.mocked(zendeskRequest);
const amazonRequestMock = vi.mocked(amazonRequest);
const skioRequestMock = vi.mocked(skioRequest);
const stayAiRequestMock = vi.mocked(stayAiRequest);

// ---------------------------------------------------------------------------
// Common configs and helpers
// ---------------------------------------------------------------------------

const writeEnabled = { allowApply: true, redact: false };
const writeDisabled = { allowApply: false, redact: false };

const gorgiasConfig = { domain: 'test-domain', apiKey: 'gorgias-key', email: 'test@test.com' };
const rechargeConfig = { accessToken: 'recharge-token', apiVersion: '2021-01' };
const shopifyConfig = {
  shop: 'test-shop.myshopify.com',
  accessToken: 'shopify-token',
  apiVersion: '2025-01',
};
const loopConfig = { apiKey: 'loop-key', baseUrl: 'https://api.loopreturns.com/api/v1' };
const shipstationConfig = {
  apiKey: 'ss-key',
  apiSecret: 'ss-secret',
  baseUrl: 'https://ssapi.shipstation.com',
};
const shipheroConfig = { accessToken: 'shiphero-token' };
const shipfusionConfig = { apiKey: 'sf-key', clientId: 'sf-client' };
const shiphawkConfig = { apiKey: 'shawk-key', baseUrl: 'https://api.shiphawk.com/v4' };
const zendeskConfig = { subdomain: 'test', email: 'test@test.com', apiToken: 'zd-token' };
const amazonConfig = {
  lwaClientId: 'amz-client',
  lwaClientSecret: 'amz-secret',
  lwaRefreshToken: 'amz-refresh',
  awsAccessKeyId: 'AKIA_TEST',
  awsSecretAccessKey: 'aws-secret-test',
  awsRegion: 'us-east-1',
  marketplaceId: 'ATVPDKIKX0DER',
  endpoint: 'https://sellingpartnerapi-na.amazon.com',
};
const skioConfig = { apiKey: 'skio-key', baseUrl: 'https://api.skio.com', apiVersion: '2024-01' };
const stayaiConfig = {
  apiKey: 'stayai-key',
  baseUrl: 'https://api.stay.ai',
  apiVersion: '2024-01',
};

function parseToolPayload(result: unknown): Record<string, unknown> {
  const content = (result as { content: Array<{ text: string }> }).content;
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

function parseToolText(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================== GORGIAS ==============================

describe('gorgias MCP tools', () => {
  beforeEach(() => {
    mockGorgiasApi.listTickets.mockResolvedValue({
      data: [
        {
          id: 1,
          subject: 'Test',
          status: 'open',
          channel: 'email',
          tags: [{ name: 'vip' }],
        },
      ],
    });
    mockGorgiasApi.getTicket.mockResolvedValue({
      id: 1,
      subject: 'Test',
      status: 'open',
      tags: [{ name: 'existing' }],
    });
    mockGorgiasApi.getTicketMessages.mockResolvedValue({ data: [] });
    mockGorgiasApi.updateTicket.mockResolvedValue({});
    mockGorgiasApi.addMessage.mockResolvedValue({});
    mockGorgiasApi.mergeTickets.mockResolvedValue({});
    mockGorgiasApi.listMacros.mockResolvedValue({ data: [{ id: 10, name: 'Welcome' }] });
    mockGorgiasApi.getMacro.mockResolvedValue({ id: 10, name: 'Welcome' });
    mockGorgiasApi.applyMacro.mockResolvedValue({});
    mockGorgiasApi.listUsers.mockResolvedValue({
      data: [{ id: 101, email: 'agent@test.com' }],
    });
    mockGorgiasApi.listTeams.mockResolvedValue({
      data: [{ id: 201, name: 'Support' }],
    });
    mockGorgiasApi.requestRaw.mockResolvedValue({ ok: true });
  });

  it('lists tickets with tag filtering', async () => {
    const server = createMockMcpServer();
    registerGorgiasTools(server as never, gorgiasConfig, writeEnabled);

    const result = await server._callTool('gorgias_list_tickets', {
      status: 'open',
      tags: ['vip'],
    });
    const payload = parseToolPayload(result);
    expect(payload.success).toBe(true);
    expect(payload.total_tickets).toBe(1);
    expect(mockGorgiasApi.listTickets).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'open' }),
    );
  });

  it('blocks close_ticket when allowApply is false', async () => {
    const server = createMockMcpServer();
    registerGorgiasTools(server as never, gorgiasConfig, writeDisabled);

    const result = await server._callTool('gorgias_close_ticket', { ticket_id: 1 });
    const payload = parseToolPayload(result);
    expect(payload.error).toBeDefined();
    expect(mockGorgiasApi.updateTicket).not.toHaveBeenCalled();
  });

  it('closes ticket with internal note when allowApply is true', async () => {
    const server = createMockMcpServer();
    registerGorgiasTools(server as never, gorgiasConfig, writeEnabled);

    const result = await server._callTool('gorgias_close_ticket', {
      ticket_id: 42,
      internal_note: 'Resolved by agent',
    });
    const payload = parseToolPayload(result);
    expect(payload.success).toBe(true);
    expect(payload.action).toBe('closed');
    expect(mockGorgiasApi.addMessage).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ body_text: 'Resolved by agent', internal: true }),
    );
    expect(mockGorgiasApi.updateTicket).toHaveBeenCalledWith(42, { status: 'closed' });
  });

  it('escalates ticket to a team', async () => {
    const server = createMockMcpServer();
    registerGorgiasTools(server as never, gorgiasConfig, writeEnabled);

    const result = await server._callTool('gorgias_escalate_ticket', {
      ticket_id: 5,
      team: 'Support',
      priority: 'high',
    });
    const payload = parseToolPayload(result);
    expect(payload.success).toBe(true);
    expect(payload.team).toBe('Support');
    expect(payload.team_id).toBe(201);
    expect(mockGorgiasApi.updateTicket).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        assignee_team: { id: 201 },
        priority: 2,
      }),
    );
  });

  it('merges tickets', async () => {
    const server = createMockMcpServer();
    registerGorgiasTools(server as never, gorgiasConfig, writeEnabled);

    const result = await server._callTool('gorgias_merge_tickets', {
      primary_ticket_id: 1,
      secondary_ticket_ids: [2, 3],
    });
    const payload = parseToolPayload(result);
    expect(payload.success).toBe(true);
    expect(payload.total_merged).toBe(2);
    expect(mockGorgiasApi.mergeTickets).toHaveBeenCalledWith(1, [2, 3]);
  });

  it('blocks raw non-GET gorgias_request when allowApply is false', async () => {
    const server = createMockMcpServer();
    registerGorgiasTools(server as never, gorgiasConfig, writeDisabled);

    const result = await server._callTool('gorgias_request', {
      method: 'POST',
      endpoint: '/tickets',
      body: { subject: 'New' },
    });
    const payload = parseToolPayload(result);
    expect(payload.error).toBeDefined();
    expect(mockGorgiasApi.requestRaw).not.toHaveBeenCalled();
  });
});

// ============================== RECHARGE ==============================

describe('recharge MCP tools', () => {
  beforeEach(() => {
    rechargeRequestMock.mockResolvedValue({ status: 200, data: { ok: true } });
  });

  it('lists customers with pagination', async () => {
    const server = createMockMcpServer();
    registerRechargeTools(server as never, rechargeConfig, writeEnabled);

    await server._callTool('recharge_list_customers', { limit: 10, page: 2 });
    expect(rechargeRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/customers',
        query: expect.objectContaining({ limit: 10, page: 2 }),
      }),
    );
  });

  it('previews subscription cancel without making request', async () => {
    const server = createMockMcpServer();
    registerRechargeTools(server as never, rechargeConfig, writeEnabled);

    const result = await server._callTool('recharge_preview_subscription_change', {
      subscription_id: 100,
      action: 'cancel',
      reason: 'Customer request',
    });
    const payload = parseToolPayload(result);
    expect(payload.dry_run).toBe(true);
    expect(payload.request).toEqual(
      expect.objectContaining({
        method: 'POST',
        path: '/subscriptions/100/cancel',
        body: { cancellation_reason: 'Customer request' },
      }),
    );
    expect(rechargeRequestMock).not.toHaveBeenCalled();
  });

  it('blocks confirm_subscription_change when allowApply is false', async () => {
    const server = createMockMcpServer();
    registerRechargeTools(server as never, rechargeConfig, writeDisabled);

    const result = await server._callTool('recharge_confirm_subscription_change', {
      subscription_id: 100,
      action: 'resume',
    });
    const text = parseToolText(result);
    expect(text).toContain('Write operation not allowed');
    expect(rechargeRequestMock).not.toHaveBeenCalled();
  });

  it('executes subscription swap with idempotency', async () => {
    const server = createMockMcpServer();
    registerRechargeTools(server as never, rechargeConfig, writeEnabled);

    await server._callTool('recharge_confirm_subscription_change', {
      subscription_id: 100,
      action: 'swap',
      swap_variant_id: 999,
      quantity: 2,
      idempotency_key: 'swap-key-1',
    });
    expect(rechargeRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PUT',
        path: '/subscriptions/100',
        body: {
          subscription: { shopify_variant_id: 999, quantity: 2 },
        },
      }),
    );
  });
});

// ============================== SHOPIFY ORDERS ==============================

describe('shopify-orders MCP tools', () => {
  it('lists orders with default query', async () => {
    fetchOrdersMock.mockResolvedValue({
      orders: [
        {
          id: 'gid://shopify/Order/1',
          name: '#1001',
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-02T00:00:00Z',
          cancelledAt: null,
          displayFinancialStatus: 'paid',
          displayFulfillmentStatus: 'unfulfilled',
          totalPrice: { amount: '100.00', currencyCode: 'USD' },
          tags: [],
          email: 'cust@test.com',
        },
      ],
      hasMore: false,
    } as never);

    const server = createMockMcpServer();
    registerShopifyOrderTools(server as never, shopifyConfig, writeEnabled);

    const result = await server._callTool('shopify_list_orders', {});
    const payload = parseToolPayload(result);
    expect(payload.success).toBe(true);
    expect(payload.returned).toBe(1);
    expect(fetchOrdersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderQuery: 'status:any',
        sortKey: 'CREATED_AT',
        reverse: true,
      }),
    );
  });

  it('gets order by ID', async () => {
    fetchOrderByIdMock.mockResolvedValue({
      id: 'gid://shopify/Order/1',
      name: '#1001',
      createdAt: '2025-01-01T00:00:00Z',
      cancelledAt: null,
      displayFinancialStatus: 'paid',
      displayFulfillmentStatus: 'unfulfilled',
      totalPrice: { amount: '100.00', currencyCode: 'USD' },
      subtotalPrice: { amount: '90.00', currencyCode: 'USD' },
      totalShipping: { amount: '10.00', currencyCode: 'USD' },
      totalTax: { amount: '0.00', currencyCode: 'USD' },
      hasRefunds: false,
      tags: [],
      email: 'cust@test.com',
      lineItems: [],
      transactions: [],
    } as never);

    const server = createMockMcpServer();
    registerShopifyOrderTools(server as never, shopifyConfig, writeEnabled);

    const result = await server._callTool('shopify_get_order', { order_id: '6072438726949' });
    const payload = parseToolPayload(result);
    expect(payload.success).toBe(true);
    expect(fetchOrderByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: '6072438726949' }),
    );
  });
});

// ============================== SHOPIFY HOLDS ==============================

describe('shopify-holds MCP tools', () => {
  it('previews orders with holds', async () => {
    fetchOrdersWithHoldInfoMock.mockResolvedValue({
      orders: [
        {
          id: 'gid://shopify/Order/1',
          name: '#1001',
          createdAt: '2025-01-01',
          cancelledAt: null,
          displayFinancialStatus: 'paid',
          email: 'a@test.com',
          tags: ['pre-order'],
          totalPrice: { amount: '50.00', currencyCode: 'USD' },
          fulfillmentOrders: [{ id: 'fo1', status: 'on_hold' }],
        },
      ],
    } as never);

    const server = createMockMcpServer();
    registerShopifyHoldsTools(server as never, shopifyConfig, writeEnabled);

    const result = await server._callTool('shopify_preview_orders', {
      query: 'tag:pre-order',
    });
    const payload = parseToolPayload(result);
    expect(payload.orders_with_holds).toBe(1);
    expect(payload.total_holds).toBe(1);
  });

  it('blocks release_holds when allowApply is false', async () => {
    const server = createMockMcpServer();
    registerShopifyHoldsTools(server as never, shopifyConfig, writeDisabled);

    const result = await server._callTool('shopify_release_holds', {
      query: 'tag:pre-order',
    });
    const payload = parseToolPayload(result);
    expect(payload.error).toBeDefined();
    expect(releaseHoldsForOrdersMock).not.toHaveBeenCalled();
  });

  it('blocks add_tags when allowApply is false', async () => {
    const server = createMockMcpServer();
    registerShopifyHoldsTools(server as never, shopifyConfig, writeDisabled);

    const result = await server._callTool('shopify_add_tags', {
      order_ids: ['gid://shopify/Order/1'],
      tags: ['released'],
    });
    const payload = parseToolPayload(result);
    expect(payload.error).toBeDefined();
    expect(addOrderTagsMock).not.toHaveBeenCalled();
  });
});

// ============================== SHOPIFY REFUNDS ==============================

describe('shopify-refunds MCP tools', () => {
  const mockOrder = {
    id: 'gid://shopify/Order/1',
    name: '#26417',
    createdAt: '2025-01-01',
    cancelledAt: null,
    displayFinancialStatus: 'paid',
    displayFulfillmentStatus: 'fulfilled',
    totalPrice: { amount: '100.00', currencyCode: 'USD' },
    hasRefunds: false,
    tags: [],
    email: 'cust@test.com',
    lineItems: [
      {
        id: 'li1',
        name: 'Widget',
        sku: 'WDG-001',
        quantity: 2,
        currentQuantity: 2,
        fulfillableQuantity: 0,
        unitPrice: { amount: '25.00', currencyCode: 'USD' },
        totalPrice: { amount: '50.00', currencyCode: 'USD' },
      },
    ],
    transactions: [],
  };

  beforeEach(() => {
    fetchOrderByNameMock.mockResolvedValue(mockOrder as never);
    findLineItemsBySkuMock.mockReturnValue([mockOrder.lineItems[0]] as never);
    calculateRefundMock.mockResolvedValue({
      transactions: [{ amount: '50.00' }],
      refundLineItems: [{ lineItemId: 'li1', quantity: 2, subtotal: '50.00', totalTax: '0.00' }],
    } as never);
    createRefundMock.mockResolvedValue({
      refundId: 'refund-1',
      transactions: [{ amount: '50.00' }],
      refundLineItems: [{ lineItemId: 'li1', quantity: 2 }],
    } as never);
    addOrderTagsMock.mockResolvedValue(undefined as never);
  });

  it('looks up order by number', async () => {
    const server = createMockMcpServer();
    registerShopifyRefundTools(server as never, shopifyConfig, writeEnabled);

    const result = await server._callTool('shopify_lookup_order', { order_number: '#26417' });
    const payload = parseToolPayload(result);
    expect(payload.success).toBe(true);
    expect(fetchOrderByNameMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderName: '#26417' }),
    );
  });

  it('previews refund by SKU pattern', async () => {
    const server = createMockMcpServer();
    registerShopifyRefundTools(server as never, shopifyConfig, writeEnabled);

    const result = await server._callTool('shopify_preview_refund', {
      order_number: '#26417',
      sku_pattern: 'WDG-001',
    });
    const payload = parseToolPayload(result);
    expect(payload.success).toBe(true);
    expect(payload.calculated_refund).toBeDefined();
    expect(calculateRefundMock).toHaveBeenCalled();
  });

  it('blocks process_refund when allowApply is false', async () => {
    const server = createMockMcpServer();
    registerShopifyRefundTools(server as never, shopifyConfig, writeDisabled);

    const result = await server._callTool('shopify_process_refund', {
      order_number: '#26417',
      sku_pattern: 'WDG-001',
    });
    const payload = parseToolPayload(result);
    expect(payload.error).toBeDefined();
    expect(createRefundMock).not.toHaveBeenCalled();
  });
});

// ============================== SHOPIFY ADVANCED ==============================

describe('shopify-advanced MCP tools', () => {
  beforeEach(() => {
    shopifyGraphqlRawMock.mockResolvedValue({ data: { orders: [] } } as never);
    shopifyRestRequestMock.mockResolvedValue({ status: 200, data: { ok: true } } as never);
  });

  it('blocks GraphQL mutations when allowApply is false', async () => {
    const server = createMockMcpServer();
    registerShopifyAdvancedTools(server as never, shopifyConfig, writeDisabled);

    const result = await server._callTool('shopify_graphql', {
      query: 'mutation { orderCancel(orderId: "123") { order { id } } }',
    });
    const payload = parseToolPayload(result);
    expect(payload.error).toBeDefined();
    expect(shopifyGraphqlRawMock).not.toHaveBeenCalled();
  });

  it('allows GraphQL queries without apply', async () => {
    const server = createMockMcpServer();
    registerShopifyAdvancedTools(server as never, shopifyConfig, writeDisabled);

    await server._callTool('shopify_graphql', {
      query: '{ orders(first: 10) { edges { node { id } } } }',
    });
    expect(shopifyGraphqlRawMock).toHaveBeenCalled();
  });

  it('previews cancel_order operation as dry_run', async () => {
    const server = createMockMcpServer();
    registerShopifyAdvancedTools(server as never, shopifyConfig, writeEnabled);

    const result = await server._callTool('shopify_preview_fulfillment_operation', {
      operation: 'cancel_order',
      order_id: '12345',
    });
    const payload = parseToolPayload(result);
    expect(payload.dry_run).toBe(true);
    expect(payload.request).toEqual(
      expect.objectContaining({
        method: 'POST',
        path: '/orders/12345/cancel.json',
      }),
    );
  });

  it('blocks confirm_fulfillment_operation when allowApply is false', async () => {
    const server = createMockMcpServer();
    registerShopifyAdvancedTools(server as never, shopifyConfig, writeDisabled);

    const result = await server._callTool('shopify_confirm_fulfillment_operation', {
      operation: 'cancel_order',
      order_id: '12345',
    });
    const payload = parseToolPayload(result);
    expect(payload.error).toBeDefined();
  });
});

// ============================== LOOP ==============================

describe('loop MCP tools', () => {
  beforeEach(() => {
    loopRequestMock.mockResolvedValue({ status: 200, data: { returns: [] } });
  });

  it('lists returns with filters mapped to query', async () => {
    const server = createMockMcpServer();
    registerLoopTools(server as never, loopConfig, writeEnabled);

    await server._callTool('loop_list_returns', {
      status: 'pending',
      outcome: 'refund',
      created_after: '2025-01-01',
    });
    expect(loopRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/returns',
        query: expect.objectContaining({
          status: 'pending',
          outcome: 'refund',
          created_at_min: '2025-01-01',
        }),
      }),
    );
  });

  it('blocks approve_return when allowApply is false', async () => {
    const server = createMockMcpServer();
    registerLoopTools(server as never, loopConfig, writeDisabled);

    const result = await server._callTool('loop_approve_return', { return_id: 'ret-1' });
    const payload = parseToolPayload(result);
    expect(payload.error).toBeDefined();
    expect(loopRequestMock).not.toHaveBeenCalled();
  });

  it('issues refund with store credit bonus', async () => {
    const server = createMockMcpServer();
    registerLoopTools(server as never, loopConfig, writeEnabled);

    await server._callTool('loop_issue_refund', {
      return_id: 'ret-1',
      refund_type: 'store_credit',
      store_credit_bonus_percent: 10,
    });
    expect(loopRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/returns/ret-1/refund',
        body: expect.objectContaining({
          refund_type: 'store_credit',
          bonus_percent: 10,
        }),
      }),
    );
  });
});

// ============================== SHIPSTATION ==============================

describe('shipstation MCP tools', () => {
  beforeEach(() => {
    shipstationRequestMock.mockResolvedValue({ status: 200, data: { ok: true } });
  });

  it('lists orders with query params', async () => {
    const server = createMockMcpServer();
    registerShipStationTools(server as never, shipstationConfig, writeEnabled);

    await server._callTool('shipstation_list_orders', {
      order_status: 'awaiting_shipment',
      store_id: 42,
    });
    expect(shipstationRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/orders',
        query: expect.objectContaining({
          orderStatus: 'awaiting_shipment',
          storeId: 42,
        }),
      }),
    );
  });

  it('blocks create_label when allowApply is false', async () => {
    const server = createMockMcpServer();
    registerShipStationTools(server as never, shipstationConfig, writeDisabled);

    const result = await server._callTool('shipstation_create_label', {
      order_id: 100,
      carrier_code: 'usps',
      service_code: 'usps_priority_mail',
    });
    const payload = parseToolPayload(result);
    expect(payload.error).toBeDefined();
    expect(shipstationRequestMock).not.toHaveBeenCalled();
  });

  it('creates label with correct payload', async () => {
    const server = createMockMcpServer();
    registerShipStationTools(server as never, shipstationConfig, writeEnabled);

    await server._callTool('shipstation_create_label', {
      order_id: 100,
      carrier_code: 'usps',
      service_code: 'usps_priority_mail',
      weight_oz: 16,
    });
    expect(shipstationRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/orders/createlabelfororder',
        body: expect.objectContaining({
          orderId: 100,
          carrierCode: 'usps',
          serviceCode: 'usps_priority_mail',
          weight: { value: 16, units: 'ounces' },
        }),
      }),
    );
  });
});

// ============================== SHIPHERO ==============================

describe('shiphero MCP tools', () => {
  beforeEach(() => {
    shipheroGraphqlMock.mockResolvedValue({ status: 200, data: { orders: { edges: [] } } });
  });

  it('lists orders via GraphQL', async () => {
    const server = createMockMcpServer();
    registerShipHeroTools(server as never, shipheroConfig, writeEnabled);

    await server._callTool('shiphero_list_orders', {
      order_status: 'pending',
      limit: 10,
    });
    expect(shipheroGraphqlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          order_status: 'pending',
          first: 10,
        }),
      }),
    );
  });

  it('blocks update_order when allowApply is false', async () => {
    const server = createMockMcpServer();
    registerShipHeroTools(server as never, shipheroConfig, writeDisabled);

    const result = await server._callTool('shiphero_update_order', {
      order_id: 'ord-1',
      priority: 'high',
    });
    const payload = parseToolPayload(result);
    expect(payload.error).toBeDefined();
    expect(shipheroGraphqlMock).not.toHaveBeenCalled();
  });

  it('gets inventory for a SKU', async () => {
    const server = createMockMcpServer();
    registerShipHeroTools(server as never, shipheroConfig, writeEnabled);

    await server._callTool('shiphero_get_inventory', {
      sku: 'WIDGET-001',
      warehouse_id: 'wh-1',
    });
    expect(shipheroGraphqlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          sku: 'WIDGET-001',
          warehouse_id: 'wh-1',
        }),
      }),
    );
  });
});

// ============================== SHIPFUSION ==============================

describe('shipfusion MCP tools', () => {
  beforeEach(() => {
    shipfusionRequestMock.mockResolvedValue({ status: 200, data: { ok: true } });
  });

  it('lists orders with filters', async () => {
    const server = createMockMcpServer();
    registerShipFusionTools(server as never, shipfusionConfig, writeEnabled);

    await server._callTool('shipfusion_list_orders', { status: 'processing', limit: 25 });
    expect(shipfusionRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/orders',
        query: expect.objectContaining({ status: 'processing', limit: 25 }),
      }),
    );
  });

  it('blocks cancel_order when allowApply is false', async () => {
    const server = createMockMcpServer();
    registerShipFusionTools(server as never, shipfusionConfig, writeDisabled);

    const result = await server._callTool('shipfusion_cancel_order', { order_id: 'ord-1' });
    const payload = parseToolPayload(result);
    expect(payload.error).toBeDefined();
    expect(shipfusionRequestMock).not.toHaveBeenCalled();
  });

  it('gets tracking by shipment_id', async () => {
    const server = createMockMcpServer();
    registerShipFusionTools(server as never, shipfusionConfig, writeEnabled);

    await server._callTool('shipfusion_get_tracking', { shipment_id: 'shp-1' });
    expect(shipfusionRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/shipments/shp-1',
      }),
    );
  });

  it('resolves exception with dry_run', async () => {
    const server = createMockMcpServer();
    registerShipFusionTools(server as never, shipfusionConfig, writeEnabled);

    const result = await server._callTool('shipfusion_resolve_exception', {
      exception_target: 'order',
      target_id: 'ord-99',
      resolution: 'release_hold',
      dry_run: true,
    });
    const payload = parseToolPayload(result);
    expect(payload.dry_run).toBe(true);
    expect(payload.request).toEqual(
      expect.objectContaining({
        method: 'POST',
        path: '/orders/ord-99/exceptions/resolve',
        body: { resolution: 'release_hold' },
      }),
    );
    expect(shipfusionRequestMock).not.toHaveBeenCalled();
  });
});

// ============================== SHIPHAWK ==============================

describe('shiphawk MCP tools', () => {
  beforeEach(() => {
    shiphawkRequestMock.mockResolvedValue({ status: 200, data: { rates: [] } });
  });

  it('gets shipping rates with correct payload', async () => {
    const server = createMockMcpServer();
    registerShipHawkTools(server as never, shiphawkConfig, writeEnabled);

    await server._callTool('shiphawk_get_rates', {
      origin_zip: '10001',
      destination_zip: '90210',
      weight_lbs: 5,
    });
    expect(shiphawkRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/rates',
        body: expect.objectContaining({
          origin: { zip: '10001', country: 'US' },
          destination: expect.objectContaining({ zip: '90210' }),
          packages: [expect.objectContaining({ weight: 5 })],
        }),
      }),
    );
  });

  it('blocks create_shipment when allowApply is false', async () => {
    const server = createMockMcpServer();
    registerShipHawkTools(server as never, shiphawkConfig, writeDisabled);

    const result = await server._callTool('shiphawk_create_shipment', {
      rate_id: 'rate-1',
      origin: {
        name: 'Sender',
        address1: '123 Main St',
        city: 'New York',
        state: 'NY',
        zip: '10001',
      },
      destination: {
        name: 'Receiver',
        address1: '456 Oak Ave',
        city: 'Los Angeles',
        state: 'CA',
        zip: '90210',
      },
    });
    const payload = parseToolPayload(result);
    expect(payload.error).toBeDefined();
    expect(shiphawkRequestMock).not.toHaveBeenCalled();
  });

  it('throws when track_shipment has no shipment_id or tracking_number', async () => {
    const server = createMockMcpServer();
    registerShipHawkTools(server as never, shiphawkConfig, writeEnabled);

    await expect(server._callTool('shiphawk_track_shipment', {})).rejects.toThrow(
      'Provide shipment_id or tracking_number',
    );
  });
});

// ============================== ZENDESK ==============================

describe('zendesk MCP tools', () => {
  beforeEach(() => {
    zendeskRequestMock.mockResolvedValue({
      status: 200,
      data: { tickets: [{ id: 1, subject: 'Test', status: 'open' }] },
    });
  });

  it('lists tickets via search', async () => {
    const server = createMockMcpServer();
    registerZendeskTools(server as never, zendeskConfig, writeEnabled);

    await server._callTool('zendesk_list_tickets', { status: 'open', limit: 5 });
    expect(zendeskRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('gets a single ticket', async () => {
    zendeskRequestMock.mockResolvedValue({
      status: 200,
      data: { ticket: { id: 42, subject: 'Help', status: 'open', tags: [] } },
    });
    const server = createMockMcpServer();
    registerZendeskTools(server as never, zendeskConfig, writeEnabled);

    const result = await server._callTool('zendesk_get_ticket', { ticket_id: 42 });
    const payload = parseToolPayload(result);
    expect(payload.success).toBe(true);
    expect(zendeskRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/tickets/42.json',
      }),
    );
  });

  it('blocks close_ticket when allowApply is false', async () => {
    const server = createMockMcpServer();
    registerZendeskTools(server as never, zendeskConfig, writeDisabled);

    const result = await server._callTool('zendesk_close_ticket', { ticket_id: 1 });
    const payload = parseToolPayload(result);
    expect(payload.error).toBeDefined();
  });
});

// ============================== AMAZON ==============================

describe('amazon MCP tools', () => {
  beforeEach(() => {
    amazonRequestMock.mockResolvedValue({ status: 200, data: { payload: { Orders: [] } } });
  });

  it('lists orders with marketplace fallback', async () => {
    const server = createMockMcpServer();
    registerAmazonTools(server as never, amazonConfig, writeEnabled);

    await server._callTool('amazon_list_orders', {
      created_after: '2025-01-01T00:00:00Z',
    });
    expect(amazonRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/orders/v0/orders',
        query: expect.objectContaining({
          CreatedAfter: '2025-01-01T00:00:00Z',
          MarketplaceIds: 'ATVPDKIKX0DER',
        }),
      }),
    );
  });

  it('gets order by ID', async () => {
    const server = createMockMcpServer();
    registerAmazonTools(server as never, amazonConfig, writeEnabled);

    await server._callTool('amazon_get_order', { order_id: '111-2222222-3333333' });
    expect(amazonRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/orders/v0/orders/111-2222222-3333333',
      }),
    );
  });

  it('blocks cancel_fulfillment_order when allowApply is false', async () => {
    const server = createMockMcpServer();
    registerAmazonTools(server as never, amazonConfig, writeDisabled);

    const result = await server._callTool('amazon_cancel_fulfillment_order', {
      seller_fulfillment_order_id: 'sfo-1',
    });
    const payload = parseToolPayload(result);
    expect(payload.error).toBeDefined();
    expect(amazonRequestMock).not.toHaveBeenCalled();
  });

  it('previews create_fulfillment_order without applying', async () => {
    const server = createMockMcpServer();
    registerAmazonTools(server as never, amazonConfig, writeEnabled);

    const result = await server._callTool('amazon_preview_create_fulfillment_order', {
      seller_fulfillment_order_id: 'sfo-1',
      displayable_order_id: 'DO-1',
      displayable_order_date: '2025-01-01T00:00:00Z',
      destination_address: {
        name: 'John',
        address_line1: '123 Main',
        postal_code: '10001',
        country_code: 'US',
      },
      items: [{ seller_sku: 'SKU-1', quantity: 1 }],
    });
    const payload = parseToolPayload(result);
    expect(payload.dry_run).toBe(true);
    expect(payload.request).toBeDefined();
    expect(amazonRequestMock).not.toHaveBeenCalled();
  });
});

// ============================== SKIO ==============================

describe('skio MCP tools', () => {
  beforeEach(() => {
    skioRequestMock.mockResolvedValue({ status: 200, data: { ok: true } });
  });

  it('lists subscriptions with pagination', async () => {
    const server = createMockMcpServer();
    registerSkioTools(server as never, skioConfig, writeEnabled);

    await server._callTool('skio_list_subscriptions', { limit: 20, page: 1 });
    expect(skioRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/subscriptions',
        query: expect.objectContaining({ limit: 20, page: 1 }),
      }),
    );
  });

  it('previews subscription cancel', async () => {
    const server = createMockMcpServer();
    registerSkioTools(server as never, skioConfig, writeEnabled);

    const result = await server._callTool('skio_preview_subscription_change', {
      subscription_id: 50,
      action: 'cancel',
      reason: 'Not needed',
    });
    const payload = parseToolPayload(result);
    expect(payload.dry_run).toBe(true);
    expect(payload.request).toEqual(
      expect.objectContaining({
        method: 'POST',
        path: '/subscriptions/50/cancel',
        body: { cancellation_reason: 'Not needed' },
      }),
    );
    expect(skioRequestMock).not.toHaveBeenCalled();
  });

  it('blocks skip_charge when allowApply is false', async () => {
    const server = createMockMcpServer();
    registerSkioTools(server as never, skioConfig, writeDisabled);

    const result = await server._callTool('skio_skip_charge', { charge_id: 10 });
    const payload = parseToolPayload(result);
    expect(payload.error).toBeDefined();
    expect(skioRequestMock).not.toHaveBeenCalled();
  });
});

// ============================== STAYAI ==============================

describe('stayai MCP tools', () => {
  beforeEach(() => {
    stayAiRequestMock.mockResolvedValue({ status: 200, data: { ok: true } });
  });

  it('lists customers', async () => {
    const server = createMockMcpServer();
    registerStayAiTools(server as never, stayaiConfig, writeEnabled);

    await server._callTool('stayai_list_customers', { limit: 50 });
    expect(stayAiRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/customers',
        query: expect.objectContaining({ limit: 50 }),
      }),
    );
  });

  it('previews subscription resume', async () => {
    const server = createMockMcpServer();
    registerStayAiTools(server as never, stayaiConfig, writeEnabled);

    const result = await server._callTool('stayai_preview_subscription_change', {
      subscription_id: 75,
      action: 'resume',
    });
    const payload = parseToolPayload(result);
    expect(payload.dry_run).toBe(true);
    expect(payload.request).toEqual(
      expect.objectContaining({
        method: 'PUT',
        path: '/subscriptions/75',
        body: { subscription: { status: 'active' } },
      }),
    );
    expect(stayAiRequestMock).not.toHaveBeenCalled();
  });

  it('blocks issue_refund when allowApply is false', async () => {
    const server = createMockMcpServer();
    registerStayAiTools(server as never, stayaiConfig, writeDisabled);

    const result = await server._callTool('stayai_issue_refund', {
      charge_id: 99,
      amount: 25.0,
    });
    const payload = parseToolPayload(result);
    expect(payload.error).toBeDefined();
    expect(stayAiRequestMock).not.toHaveBeenCalled();
  });

  it('executes confirm_subscription_change with swap', async () => {
    const server = createMockMcpServer();
    registerStayAiTools(server as never, stayaiConfig, writeEnabled);

    await server._callTool('stayai_confirm_subscription_change', {
      subscription_id: 75,
      action: 'swap',
      swap_variant_id: 888,
      quantity: 3,
    });
    expect(stayAiRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PUT',
        path: '/subscriptions/75',
        body: {
          subscription: { shopify_variant_id: 888, quantity: 3 },
        },
      }),
    );
  });
});
