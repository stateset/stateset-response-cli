import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestJsonWithRetry, throwOnHttpError } from '../integrations/http.js';
import { shipstationRequest } from '../integrations/shipstation.js';

vi.mock('../integrations/http.js', () => ({
  requestJsonWithRetry: vi.fn(),
  normalizePath: vi.fn((p: string) => (p.startsWith('/') ? p : `/${p}`)),
  applyQueryParams: vi.fn(),
  throwOnHttpError: vi.fn(),
}));

const mockRequestJsonWithRetry = vi.mocked(requestJsonWithRetry);
const mockThrowOnHttpError = vi.mocked(throwOnHttpError);

const config = { apiKey: 'ss-key', apiSecret: 'ss-secret' };

describe('shipstationRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestJsonWithRetry.mockResolvedValue({
      status: 200,
      headers: new Headers(),
      data: { ok: true },
    });
  });

  it('constructs correct URL', async () => {
    await shipstationRequest({
      shipstation: config,
      method: 'GET',
      path: '/orders',
    });

    expect(mockRequestJsonWithRetry.mock.calls[0][0]).toBe('https://ssapi.shipstation.com/orders');
  });

  it('sets Basic auth header with apiKey:apiSecret', async () => {
    await shipstationRequest({
      shipstation: config,
      method: 'GET',
      path: '/orders',
    });

    const expectedAuth = Buffer.from('ss-key:ss-secret').toString('base64');
    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.headers).toEqual(
      expect.objectContaining({
        Authorization: `Basic ${expectedAuth}`,
      }),
    );
  });

  it('passes JSON body', async () => {
    const body = { orderId: 456 };
    await shipstationRequest({
      shipstation: config,
      method: 'POST',
      path: '/orders',
      body,
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.body).toBe(JSON.stringify(body));
  });

  it('throws on empty method', async () => {
    await expect(
      shipstationRequest({
        shipstation: config,
        method: '',
        path: '/orders',
      }),
    ).rejects.toThrow('Method is required');
  });

  it('calls throwOnHttpError with status, data, and ShipStation', async () => {
    await shipstationRequest({
      shipstation: config,
      method: 'GET',
      path: '/orders',
    });

    expect(mockThrowOnHttpError).toHaveBeenCalledWith(200, { ok: true }, 'ShipStation');
  });
});
