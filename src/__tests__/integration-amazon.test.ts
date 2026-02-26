import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestJsonWithRetry, throwOnHttpError } from '../integrations/http.js';
import { amazonRequest } from '../integrations/amazon.js';

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
    lwaClientId: `amzn-client-id-${suffix}`,
    lwaClientSecret: `amzn-client-secret-${suffix}`,
    lwaRefreshToken: `amzn-refresh-token-${suffix}`,
    awsAccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    awsSecretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    awsRegion: 'us-east-1',
    endpoint: 'https://sellingpartnerapi-na.amazon.com',
    marketplaceId: 'ATVPDKIKX0DER',
  };
}

describe('amazonRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches LWA token then calls SP-API endpoint with signed headers', async () => {
    mockRequestJsonWithRetry
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        data: { access_token: 'lwa-token', expires_in: 3600 },
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        data: { payload: true },
      });

    const result = await amazonRequest({
      amazon: makeConfig('basic'),
      method: 'GET',
      path: '/orders/v0/orders',
      query: { MarketplaceIds: 'ATVPDKIKX0DER' },
    });

    expect(result.status).toBe(200);
    expect(mockRequestJsonWithRetry).toHaveBeenCalledTimes(2);
    expect(mockRequestJsonWithRetry.mock.calls[0][0]).toBe('https://api.amazon.com/auth/o2/token');

    const apiCall = mockRequestJsonWithRetry.mock.calls[1];
    expect(apiCall[0]).toContain('https://sellingpartnerapi-na.amazon.com/orders/v0/orders');
    const apiHeaders = apiCall[1]?.headers as Record<string, string>;
    expect(apiHeaders).toEqual(
      expect.objectContaining({
        'x-amz-access-token': 'lwa-token',
      }),
    );
    expect(apiHeaders.Authorization).toContain('AWS4-HMAC-SHA256');
    expect(apiHeaders).toHaveProperty('x-amz-date');
    expect(apiHeaders).toHaveProperty('x-amz-content-sha256');
  });

  it('reuses cached LWA token for repeated calls with same credentials', async () => {
    const config = makeConfig('cache');

    mockRequestJsonWithRetry
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        data: { access_token: 'cached-lwa-token', expires_in: 3600 },
      })
      .mockResolvedValueOnce({ status: 200, headers: new Headers(), data: { first: true } })
      .mockResolvedValueOnce({ status: 200, headers: new Headers(), data: { second: true } });

    await amazonRequest({
      amazon: config,
      method: 'GET',
      path: '/orders/v0/orders',
      query: { MarketplaceIds: 'ATVPDKIKX0DER' },
    });

    await amazonRequest({
      amazon: config,
      method: 'GET',
      path: '/orders/v0/orders',
      query: { MarketplaceIds: 'ATVPDKIKX0DER' },
    });

    expect(mockRequestJsonWithRetry).toHaveBeenCalledTimes(3);
    expect(mockRequestJsonWithRetry.mock.calls[0][0]).toBe('https://api.amazon.com/auth/o2/token');
  });

  it('throws on empty method', async () => {
    await expect(
      amazonRequest({
        amazon: makeConfig('empty-method'),
        method: '',
        path: '/orders/v0/orders',
      }),
    ).rejects.toThrow('Method is required');
  });

  it('throws when LWA response is missing access_token', async () => {
    mockRequestJsonWithRetry.mockResolvedValueOnce({
      status: 200,
      headers: new Headers(),
      data: {},
    });

    await expect(
      amazonRequest({
        amazon: makeConfig('missing-token'),
        method: 'GET',
        path: '/orders/v0/orders',
      }),
    ).rejects.toThrow('missing access_token');
  });

  it('calls throwOnHttpError for SP-API response', async () => {
    mockRequestJsonWithRetry
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        data: { access_token: 'lwa-token', expires_in: 3600 },
      })
      .mockResolvedValueOnce({ status: 200, headers: new Headers(), data: { ok: true } });

    await amazonRequest({
      amazon: makeConfig('http-error-hook'),
      method: 'GET',
      path: '/orders/v0/orders',
      query: { MarketplaceIds: 'ATVPDKIKX0DER' },
    });

    expect(mockThrowOnHttpError).toHaveBeenCalledWith(200, { ok: true }, 'Amazon SP-API');
  });
});
