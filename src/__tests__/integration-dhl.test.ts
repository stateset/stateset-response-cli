import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestJsonWithRetry, throwOnHttpError } from '../integrations/http.js';
import { dhlRequest } from '../integrations/dhl.js';

vi.mock('../integrations/http.js', () => ({
  requestJsonWithRetry: vi.fn(),
  normalizePath: vi.fn((p: string) => (p.startsWith('/') ? p : `/${p}`)),
  applyQueryParams: vi.fn(),
  throwOnHttpError: vi.fn(),
}));

const mockRequestJsonWithRetry = vi.mocked(requestJsonWithRetry);
const mockThrowOnHttpError = vi.mocked(throwOnHttpError);

const config = {
  apiKey: 'dhl-api-key',
  accessToken: 'dhl-access-token',
  accountNumber: '123456789',
  baseUrl: 'https://api-m.dhl.com',
};

describe('dhlRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestJsonWithRetry.mockResolvedValue({
      status: 200,
      headers: new Headers(),
      data: { ok: true },
    });
  });

  it('constructs correct URL', async () => {
    await dhlRequest({
      dhl: config,
      method: 'GET',
      path: '/track/shipments',
    });

    expect(mockRequestJsonWithRetry.mock.calls[0][0]).toBe('https://api-m.dhl.com/track/shipments');
  });

  it('sets DHL headers including API key and bearer token', async () => {
    await dhlRequest({
      dhl: config,
      method: 'GET',
      path: '/track/shipments',
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.headers).toEqual(
      expect.objectContaining({
        'DHL-API-Key': 'dhl-api-key',
        Authorization: 'Bearer dhl-access-token',
        'DHL-Account-Number': '123456789',
      }),
    );
  });

  it('throws on empty method', async () => {
    await expect(
      dhlRequest({
        dhl: config,
        method: '',
        path: '/track/shipments',
      }),
    ).rejects.toThrow('Method is required');
  });

  it('calls throwOnHttpError with status, data, and DHL', async () => {
    await dhlRequest({
      dhl: config,
      method: 'GET',
      path: '/track/shipments',
    });

    expect(mockThrowOnHttpError).toHaveBeenCalledWith(200, { ok: true }, 'DHL');
  });
});
