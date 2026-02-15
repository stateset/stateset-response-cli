import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestJsonWithRetry, applyQueryParams, throwOnHttpError } from '../integrations/http.js';
import { loopRequest } from '../integrations/loop.js';

vi.mock('../integrations/http.js', () => ({
  requestJsonWithRetry: vi.fn(),
  normalizePath: vi.fn((p: string) => (p.startsWith('/') ? p : `/${p}`)),
  applyQueryParams: vi.fn(),
  throwOnHttpError: vi.fn(),
}));

const mockRequestJsonWithRetry = vi.mocked(requestJsonWithRetry);
const mockApplyQueryParams = vi.mocked(applyQueryParams);
const mockThrowOnHttpError = vi.mocked(throwOnHttpError);

const config = { apiKey: 'loop-key' };

describe('loopRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestJsonWithRetry.mockResolvedValue({
      status: 200,
      headers: new Headers(),
      data: { ok: true },
    });
  });

  it('constructs correct URL with base + path', async () => {
    await loopRequest({
      loop: config,
      method: 'GET',
      path: '/returns',
    });

    expect(mockRequestJsonWithRetry.mock.calls[0][0]).toBe(
      'https://api.loopreturns.com/api/v1/returns',
    );
  });

  it('sets X-Authorization header', async () => {
    await loopRequest({
      loop: config,
      method: 'GET',
      path: '/returns',
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.headers).toEqual(
      expect.objectContaining({
        'X-Authorization': 'loop-key',
      }),
    );
  });

  it('passes query params via applyQueryParams', async () => {
    await loopRequest({
      loop: config,
      method: 'GET',
      path: '/returns',
      query: { state: 'open', limit: 50 },
    });

    expect(mockApplyQueryParams).toHaveBeenCalledTimes(1);
    expect(mockApplyQueryParams.mock.calls[0][1]).toEqual({ state: 'open', limit: 50 });
  });

  it('passes JSON body', async () => {
    const body = { return_id: 123 };
    await loopRequest({
      loop: config,
      method: 'POST',
      path: '/returns',
      body,
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.body).toBe(JSON.stringify(body));
  });

  it('throws on empty method', async () => {
    await expect(
      loopRequest({
        loop: config,
        method: '',
        path: '/returns',
      }),
    ).rejects.toThrow('Method is required');
  });

  it('calls throwOnHttpError with status, data, and Loop', async () => {
    await loopRequest({
      loop: config,
      method: 'GET',
      path: '/returns',
    });

    expect(mockThrowOnHttpError).toHaveBeenCalledWith(200, { ok: true }, 'Loop');
  });
});
