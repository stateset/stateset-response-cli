import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestJsonWithRetry, applyQueryParams, throwOnHttpError } from '../integrations/http.js';
import { klaviyoRequest } from '../integrations/klaviyo.js';

vi.mock('../integrations/http.js', () => ({
  requestJsonWithRetry: vi.fn(),
  normalizePath: vi.fn((p: string) => (p.startsWith('/') ? p : `/${p}`)),
  applyQueryParams: vi.fn(),
  throwOnHttpError: vi.fn(),
}));

const mockRequestJsonWithRetry = vi.mocked(requestJsonWithRetry);
const _mockApplyQueryParams = vi.mocked(applyQueryParams);
const mockThrowOnHttpError = vi.mocked(throwOnHttpError);

const config = { apiKey: 'kl-key', revision: '2026-01-15' };

describe('klaviyoRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestJsonWithRetry.mockResolvedValue({
      status: 200,
      headers: new Headers(),
      data: { ok: true },
    });
  });

  it('sets Klaviyo-API-Key authorization header', async () => {
    await klaviyoRequest({
      klaviyo: config,
      method: 'GET',
      path: '/profiles',
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Klaviyo-API-Key kl-key',
      }),
    );
  });

  it('sets revision header from options.revision', async () => {
    await klaviyoRequest({
      klaviyo: config,
      method: 'GET',
      path: '/profiles',
      revision: '2026-02-01',
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.headers).toEqual(
      expect.objectContaining({
        revision: '2026-02-01',
      }),
    );
  });

  it('sets revision header from config.revision when options.revision absent', async () => {
    await klaviyoRequest({
      klaviyo: config,
      method: 'GET',
      path: '/profiles',
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.headers).toEqual(
      expect.objectContaining({
        revision: '2026-01-15',
      }),
    );
  });

  it('throws when revision missing from both options and config', async () => {
    await expect(
      klaviyoRequest({
        klaviyo: { apiKey: 'kl-key', revision: '' },
        method: 'GET',
        path: '/profiles',
      }),
    ).rejects.toThrow('Klaviyo revision header is required');
  });

  it('throws on empty method', async () => {
    await expect(
      klaviyoRequest({
        klaviyo: config,
        method: '',
        path: '/profiles',
      }),
    ).rejects.toThrow('Method is required');
  });

  it('uses application/vnd.api+json for both Accept and Content-Type', async () => {
    await klaviyoRequest({
      klaviyo: config,
      method: 'POST',
      path: '/profiles',
      body: { data: { type: 'profile' } },
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.headers).toEqual(
      expect.objectContaining({
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
      }),
    );
  });

  it('calls throwOnHttpError with status, data, and Klaviyo', async () => {
    await klaviyoRequest({
      klaviyo: config,
      method: 'GET',
      path: '/profiles',
    });

    expect(mockThrowOnHttpError).toHaveBeenCalledWith(200, { ok: true }, 'Klaviyo');
  });
});
