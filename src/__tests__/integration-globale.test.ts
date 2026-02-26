import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestJsonWithRetry, throwOnHttpError } from '../integrations/http.js';
import { globalERequest } from '../integrations/globale.js';

vi.mock('../integrations/http.js', () => ({
  requestJsonWithRetry: vi.fn(),
  normalizePath: vi.fn((p: string) => (p.startsWith('/') ? p : `/${p}`)),
  applyQueryParams: vi.fn(),
  throwOnHttpError: vi.fn(),
}));

const mockRequestJsonWithRetry = vi.mocked(requestJsonWithRetry);
const mockThrowOnHttpError = vi.mocked(throwOnHttpError);

const config = {
  merchantId: 'merchant-123',
  apiKey: 'globale-api-key',
  channel: 'web-us',
  baseUrl: 'https://api.global-e.com',
};

describe('globalERequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestJsonWithRetry.mockResolvedValue({
      status: 200,
      headers: new Headers(),
      data: { ok: true },
    });
  });

  it('constructs correct URL', async () => {
    await globalERequest({
      globale: config,
      method: 'GET',
      path: '/orders',
    });

    expect(mockRequestJsonWithRetry.mock.calls[0][0]).toBe('https://api.global-e.com/orders');
  });

  it('sets Global-e headers', async () => {
    await globalERequest({
      globale: config,
      method: 'GET',
      path: '/orders',
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.headers).toEqual(
      expect.objectContaining({
        'X-GlobalE-Merchant-Id': 'merchant-123',
        'X-GlobalE-Api-Key': 'globale-api-key',
        'X-GlobalE-Channel': 'web-us',
      }),
    );
  });

  it('throws on empty method', async () => {
    await expect(
      globalERequest({
        globale: config,
        method: '',
        path: '/orders',
      }),
    ).rejects.toThrow('Method is required');
  });

  it('calls throwOnHttpError with status, data, and Global-e', async () => {
    await globalERequest({
      globale: config,
      method: 'GET',
      path: '/orders',
    });

    expect(mockThrowOnHttpError).toHaveBeenCalledWith(200, { ok: true }, 'Global-e');
  });
});
