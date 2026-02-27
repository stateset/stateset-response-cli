import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockMcpServer } from './helpers/mocks.js';
import { registerDhlTools } from '../mcp-server/tools/dhl.js';
import { registerGlobalETools } from '../mcp-server/tools/globale.js';
import { registerFedExTools } from '../mcp-server/tools/fedex.js';

vi.mock('../integrations/dhl.js', () => ({
  dhlRequest: vi.fn(),
}));

vi.mock('../integrations/globale.js', () => ({
  globalERequest: vi.fn(),
}));

vi.mock('../integrations/fedex.js', () => ({
  fedexRequest: vi.fn(),
}));

import { dhlRequest } from '../integrations/dhl.js';
import { globalERequest } from '../integrations/globale.js';
import { fedexRequest } from '../integrations/fedex.js';

const dhlRequestMock = vi.mocked(dhlRequest);
const globalERequestMock = vi.mocked(globalERequest);
const fedexRequestMock = vi.mocked(fedexRequest);

const writeEnabledOptions = { allowApply: true, redact: false };

const dhlConfig = {
  apiKey: 'dhl-api-key',
  accessToken: 'dhl-access-token',
  accountNumber: '123456789',
  baseUrl: 'https://api-m.dhl.com',
};

const globaleConfig = {
  merchantId: 'merchant-123',
  apiKey: 'globale-api-key',
  channel: 'web-us',
  baseUrl: 'https://api.global-e.com',
};

const fedexConfig = {
  clientId: 'fedex-client-123456',
  clientSecret: 'fedex-secret-123456',
  accountNumber: '510087000',
  locale: 'en_US',
  baseUrl: 'https://apis.fedex.com',
};

function parseToolPayload(result: unknown): Record<string, unknown> {
  const content = (result as { content: Array<{ text: string }> }).content;
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

describe('shipping MCP tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dhlRequestMock.mockResolvedValue({ status: 200, data: { ok: true } });
    globalERequestMock.mockResolvedValue({ status: 200, data: { ok: true } });
    fedexRequestMock.mockResolvedValue({ status: 200, data: { ok: true } });
  });

  it('builds FedEx-native body for fedex_get_rates', async () => {
    const mockServer = createMockMcpServer();
    registerFedExTools(mockServer as never, fedexConfig, writeEnabledOptions);

    await mockServer._callTool('fedex_get_rates', {
      shipper_postal_code: '10001',
      shipper_country_code: 'US',
      recipient_postal_code: '94105',
      recipient_country_code: 'US',
      weight_kg: 1.75,
      package_type: 'YOUR_PACKAGING',
      service_type: 'FEDEX_GROUND',
      planned_shipping_date: '2026-03-10',
    });

    expect(fedexRequestMock).toHaveBeenCalledTimes(1);
    const requestArgs = fedexRequestMock.mock.calls[0][0];
    expect(requestArgs.method).toBe('POST');
    expect(requestArgs.path).toBe('/rate/v1/rates/quotes');
    expect(requestArgs.body).toEqual({
      accountNumber: { value: '510087000' },
      requestedShipment: {
        shipper: { address: { postalCode: '10001', countryCode: 'US' } },
        recipient: { address: { postalCode: '94105', countryCode: 'US' } },
        pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
        rateRequestType: ['LIST'],
        requestedPackageLineItems: [{ weight: { units: 'KG', value: 1.75 } }],
        packagingType: 'YOUR_PACKAGING',
        serviceType: 'FEDEX_GROUND',
        shipDateStamp: '2026-03-10',
      },
    });
  });

  it('requires explicit endpoint and payload for globale_get_rates', async () => {
    const mockServer = createMockMcpServer();
    registerGlobalETools(mockServer as never, globaleConfig, writeEnabledOptions);

    await expect(
      mockServer._callTool('globale_get_rates', {
        rate_payload: { quote: true },
      }),
    ).rejects.toThrow('endpoint_override is required for globale_get_rates');

    await expect(
      mockServer._callTool('globale_get_rates', {
        endpoint_override: '/merchant/rates',
      }),
    ).rejects.toThrow('rate_payload is required for globale_get_rates');
  });

  it('uses merchant endpoint and payload for Global-e tracking/rates actions', async () => {
    const mockServer = createMockMcpServer();
    registerGlobalETools(mockServer as never, globaleConfig, writeEnabledOptions);

    await mockServer._callTool('globale_track_shipment', {
      tracking_number: 'TRACK-123',
      endpoint_override: '/merchant/tracking/search',
    });

    await mockServer._callTool('globale_get_rates', {
      endpoint_override: '/merchant/rates/quote',
      rate_payload: {
        destinationCountry: 'US',
        basketValue: 42.5,
      },
    });

    expect(globalERequestMock).toHaveBeenCalledTimes(2);
    expect(globalERequestMock.mock.calls[0][0]).toMatchObject({
      method: 'GET',
      path: '/merchant/tracking/search',
      query: { trackingNumber: 'TRACK-123' },
    });
    expect(globalERequestMock.mock.calls[1][0]).toMatchObject({
      method: 'POST',
      path: '/merchant/rates/quote',
      body: { destinationCountry: 'US', basketValue: 42.5 },
    });
  });

  it('scopes DHL idempotency by operation (same key across actions is not deduped)', async () => {
    const mockServer = createMockMcpServer();
    registerDhlTools(mockServer as never, dhlConfig, writeEnabledOptions);

    dhlRequestMock
      .mockResolvedValueOnce({ status: 200, data: { shipmentId: 's1' } })
      .mockResolvedValueOnce({ status: 200, data: { cancelled: true } });

    await mockServer._callTool('dhl_create_shipment', {
      shipment_payload: { orderId: '1001' },
      idempotency_key: 'shared-op-key',
    });
    const cancelResult = await mockServer._callTool('dhl_cancel_shipment', {
      shipment_id: 's1',
      idempotency_key: 'shared-op-key',
    });

    expect(dhlRequestMock).toHaveBeenCalledTimes(2);
    const parsed = parseToolPayload(cancelResult);
    expect(parsed.deduplicated).toBe(false);
  });

  it('still deduplicates repeated DHL calls within the same operation', async () => {
    const mockServer = createMockMcpServer();
    registerDhlTools(mockServer as never, dhlConfig, writeEnabledOptions);

    dhlRequestMock.mockResolvedValueOnce({ status: 200, data: { shipmentId: 's2' } });

    await mockServer._callTool('dhl_create_shipment', {
      shipment_payload: { orderId: '1002' },
      idempotency_key: 'same-op-key',
    });
    const second = await mockServer._callTool('dhl_create_shipment', {
      shipment_payload: { orderId: '1002' },
      idempotency_key: 'same-op-key',
    });

    expect(dhlRequestMock).toHaveBeenCalledTimes(1);
    const parsed = parseToolPayload(second);
    expect(parsed.deduplicated).toBe(true);
  });
});
