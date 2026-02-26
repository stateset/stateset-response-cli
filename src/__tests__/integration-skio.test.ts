import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestJsonWithRetry, throwOnHttpError } from '../integrations/http.js';
import { skioRequest } from '../integrations/skio.js';

vi.mock('../integrations/http.js', () => ({
  requestJsonWithRetry: vi.fn(),
  normalizePath: vi.fn((p: string) => (p.startsWith('/') ? p : `/${p}`)),
  applyQueryParams: vi.fn(),
  throwOnHttpError: vi.fn(),
}));

const mockRequestJsonWithRetry = vi.mocked(requestJsonWithRetry);
const mockThrowOnHttpError = vi.mocked(throwOnHttpError);

const baseConfig = { apiKey: 'skio-key', baseUrl: 'https://api.skio.com/v1', apiVersion: '' };
const configWithVersion = {
  apiKey: 'skio-key',
  baseUrl: 'https://api.skio.com/v1',
  apiVersion: '2024-01',
};

describe('skioRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestJsonWithRetry.mockResolvedValue({
      status: 200,
      headers: new Headers(),
      data: { ok: true },
    });
  });

  it('constructs correct URL from configured base URL', async () => {
    await skioRequest({
      skio: baseConfig,
      method: 'GET',
      path: '/subscriptions',
    });

    expect(mockRequestJsonWithRetry.mock.calls[0][0]).toBe('https://api.skio.com/v1/subscriptions');
  });

  it('sets Bearer auth header', async () => {
    await skioRequest({
      skio: baseConfig,
      method: 'GET',
      path: '/subscriptions',
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer skio-key',
      }),
    );
  });

  it('sets X-Skio-Version from options.version', async () => {
    await skioRequest({
      skio: baseConfig,
      method: 'GET',
      path: '/subscriptions',
      version: '2025-03',
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.headers).toEqual(
      expect.objectContaining({
        'X-Skio-Version': '2025-03',
      }),
    );
  });

  it('sets X-Skio-Version from config.apiVersion when options.version absent', async () => {
    await skioRequest({
      skio: configWithVersion,
      method: 'GET',
      path: '/subscriptions',
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.headers).toEqual(
      expect.objectContaining({
        'X-Skio-Version': '2024-01',
      }),
    );
  });

  it('throws on empty method', async () => {
    await expect(
      skioRequest({
        skio: baseConfig,
        method: '',
        path: '/subscriptions',
      }),
    ).rejects.toThrow('Method is required');
  });

  it('calls throwOnHttpError with status, data, and Skio', async () => {
    await skioRequest({
      skio: baseConfig,
      method: 'GET',
      path: '/subscriptions',
    });

    expect(mockThrowOnHttpError).toHaveBeenCalledWith(200, { ok: true }, 'Skio');
  });
});
