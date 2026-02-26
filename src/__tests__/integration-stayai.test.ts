import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestJsonWithRetry, throwOnHttpError } from '../integrations/http.js';
import { stayAiRequest } from '../integrations/stayai.js';

vi.mock('../integrations/http.js', () => ({
  requestJsonWithRetry: vi.fn(),
  normalizePath: vi.fn((p: string) => (p.startsWith('/') ? p : `/${p}`)),
  applyQueryParams: vi.fn(),
  throwOnHttpError: vi.fn(),
}));

const mockRequestJsonWithRetry = vi.mocked(requestJsonWithRetry);
const mockThrowOnHttpError = vi.mocked(throwOnHttpError);

const baseConfig = { apiKey: 'stayai-key', baseUrl: 'https://api.stay.ai/v1', apiVersion: '' };
const configWithVersion = {
  apiKey: 'stayai-key',
  baseUrl: 'https://api.stay.ai/v1',
  apiVersion: '2024-01',
};

describe('stayAiRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestJsonWithRetry.mockResolvedValue({
      status: 200,
      headers: new Headers(),
      data: { ok: true },
    });
  });

  it('constructs correct URL from configured base URL', async () => {
    await stayAiRequest({
      stayai: baseConfig,
      method: 'GET',
      path: '/subscriptions',
    });

    expect(mockRequestJsonWithRetry.mock.calls[0][0]).toBe('https://api.stay.ai/v1/subscriptions');
  });

  it('sets Bearer auth header', async () => {
    await stayAiRequest({
      stayai: baseConfig,
      method: 'GET',
      path: '/subscriptions',
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer stayai-key',
      }),
    );
  });

  it('sets X-StayAI-Version from options.version', async () => {
    await stayAiRequest({
      stayai: baseConfig,
      method: 'GET',
      path: '/subscriptions',
      version: '2025-03',
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.headers).toEqual(
      expect.objectContaining({
        'X-StayAI-Version': '2025-03',
      }),
    );
  });

  it('sets X-StayAI-Version from config.apiVersion when options.version absent', async () => {
    await stayAiRequest({
      stayai: configWithVersion,
      method: 'GET',
      path: '/subscriptions',
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.headers).toEqual(
      expect.objectContaining({
        'X-StayAI-Version': '2024-01',
      }),
    );
  });

  it('throws on empty method', async () => {
    await expect(
      stayAiRequest({
        stayai: baseConfig,
        method: '',
        path: '/subscriptions',
      }),
    ).rejects.toThrow('Method is required');
  });

  it('calls throwOnHttpError with status, data, and Stay.ai', async () => {
    await stayAiRequest({
      stayai: baseConfig,
      method: 'GET',
      path: '/subscriptions',
    });

    expect(mockThrowOnHttpError).toHaveBeenCalledWith(200, { ok: true }, 'Stay.ai');
  });
});
