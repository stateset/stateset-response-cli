import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestJsonWithRetry, throwOnHttpError } from '../integrations/http.js';
import { fedexRequest } from '../integrations/fedex.js';

vi.mock('../integrations/http.js', () => ({
  requestJsonWithRetry: vi.fn(),
  normalizePath: vi.fn((p: string) => (p.startsWith('/') ? p : `/${p}`)),
  applyQueryParams: vi.fn((url: URL, query?: Record<string, string | number | boolean>) => {
    if (!query) return;
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }),
  throwOnHttpError: vi.fn(),
}));

const mockRequestJsonWithRetry = vi.mocked(requestJsonWithRetry);
const mockThrowOnHttpError = vi.mocked(throwOnHttpError);

function makeConfig(suffix: string) {
  return {
    clientId: `fedex-client-${suffix}`,
    clientSecret: `fedex-secret-${suffix}`,
    accountNumber: '123456789',
    locale: 'en_US',
    baseUrl: 'https://apis.fedex.com',
  };
}

describe('fedexRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches OAuth token then calls FedEx API with bearer auth', async () => {
    mockRequestJsonWithRetry
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        data: { access_token: 'fedex-token', expires_in: 3600 },
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        data: { ok: true },
      });

    await fedexRequest({
      fedex: makeConfig('basic'),
      method: 'POST',
      path: '/track/v1/trackingnumbers',
      body: { trackingInfo: [] },
    });

    expect(mockRequestJsonWithRetry).toHaveBeenCalledTimes(2);
    expect(mockRequestJsonWithRetry.mock.calls[0][0]).toBe('https://apis.fedex.com/oauth/token');

    const apiCall = mockRequestJsonWithRetry.mock.calls[1];
    expect(apiCall[0]).toBe('https://apis.fedex.com/track/v1/trackingnumbers');
    const headers = apiCall[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer fedex-token');
    expect(headers['X-locale']).toBe('en_US');
  });

  it('reuses cached OAuth token for repeated requests', async () => {
    const config = makeConfig('cache');

    mockRequestJsonWithRetry
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        data: { access_token: 'cached-fedex-token', expires_in: 3600 },
      })
      .mockResolvedValueOnce({ status: 200, headers: new Headers(), data: { first: true } })
      .mockResolvedValueOnce({ status: 200, headers: new Headers(), data: { second: true } });

    await fedexRequest({ fedex: config, method: 'GET', path: '/track/v1/trackingnumbers' });
    await fedexRequest({ fedex: config, method: 'GET', path: '/track/v1/trackingnumbers' });

    expect(mockRequestJsonWithRetry).toHaveBeenCalledTimes(3);
    expect(mockRequestJsonWithRetry.mock.calls[0][0]).toBe('https://apis.fedex.com/oauth/token');
  });

  it('throws on empty method', async () => {
    await expect(
      fedexRequest({
        fedex: makeConfig('empty-method'),
        method: '',
        path: '/track/v1/trackingnumbers',
      }),
    ).rejects.toThrow('Method is required');
  });

  it('calls throwOnHttpError with status, data, and FedEx', async () => {
    mockRequestJsonWithRetry
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        data: { access_token: 'fedex-token', expires_in: 3600 },
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        data: { ok: true },
      });

    await fedexRequest({
      fedex: makeConfig('http-hook'),
      method: 'GET',
      path: '/track/v1/trackingnumbers',
    });

    expect(mockThrowOnHttpError).toHaveBeenCalledWith(200, { ok: true }, 'FedEx');
  });
});
