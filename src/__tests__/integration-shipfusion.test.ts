import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestJsonWithRetry, throwOnHttpError } from '../integrations/http.js';
import { shipfusionRequest } from '../integrations/shipfusion.js';

vi.mock('../integrations/http.js', () => ({
  requestJsonWithRetry: vi.fn(),
  normalizePath: vi.fn((p: string) => (p.startsWith('/') ? p : `/${p}`)),
  applyQueryParams: vi.fn(),
  throwOnHttpError: vi.fn(),
}));

const mockRequestJsonWithRetry = vi.mocked(requestJsonWithRetry);
const mockThrowOnHttpError = vi.mocked(throwOnHttpError);

const config = { apiKey: 'sf-key', clientId: 'sf-client' };

describe('shipfusionRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestJsonWithRetry.mockResolvedValue({
      status: 200,
      headers: new Headers(),
      data: { ok: true },
    });
  });

  it('constructs correct URL', async () => {
    await shipfusionRequest({
      shipfusion: config,
      method: 'GET',
      path: '/orders',
    });

    expect(mockRequestJsonWithRetry.mock.calls[0][0]).toBe('https://api.shipfusion.com/v1/orders');
  });

  it('sets X-API-Key and X-Client-Id headers', async () => {
    await shipfusionRequest({
      shipfusion: config,
      method: 'GET',
      path: '/orders',
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.headers).toEqual(
      expect.objectContaining({
        'X-API-Key': 'sf-key',
        'X-Client-Id': 'sf-client',
      }),
    );
  });

  it('passes JSON body', async () => {
    const body = { sku: 'ITEM-001', quantity: 10 };
    await shipfusionRequest({
      shipfusion: config,
      method: 'POST',
      path: '/inventory',
      body,
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.body).toBe(JSON.stringify(body));
  });

  it('throws on empty method', async () => {
    await expect(
      shipfusionRequest({
        shipfusion: config,
        method: '',
        path: '/orders',
      }),
    ).rejects.toThrow('Method is required');
  });

  it('calls throwOnHttpError with status, data, and ShipFusion', async () => {
    await shipfusionRequest({
      shipfusion: config,
      method: 'GET',
      path: '/orders',
    });

    expect(mockThrowOnHttpError).toHaveBeenCalledWith(200, { ok: true }, 'ShipFusion');
  });
});
