import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestJsonWithRetry, throwOnHttpError } from '../integrations/http.js';
import { rechargeRequest } from '../integrations/recharge.js';

vi.mock('../integrations/http.js', () => ({
  requestJsonWithRetry: vi.fn(),
  normalizePath: vi.fn((p: string) => (p.startsWith('/') ? p : `/${p}`)),
  applyQueryParams: vi.fn(),
  throwOnHttpError: vi.fn(),
}));

const mockRequestJsonWithRetry = vi.mocked(requestJsonWithRetry);
const mockThrowOnHttpError = vi.mocked(throwOnHttpError);

const baseConfig = { accessToken: 'rc-tok', apiVersion: '' };
const configWithVersion = { accessToken: 'rc-tok', apiVersion: '2021-11' };

describe('rechargeRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestJsonWithRetry.mockResolvedValue({
      status: 200,
      headers: new Headers(),
      data: { ok: true },
    });
  });

  it('sets X-Recharge-Access-Token header', async () => {
    await rechargeRequest({
      recharge: baseConfig,
      method: 'GET',
      path: '/subscriptions',
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.headers).toEqual(
      expect.objectContaining({
        'X-Recharge-Access-Token': 'rc-tok',
      }),
    );
  });

  it('sets X-Recharge-Version from options.version', async () => {
    await rechargeRequest({
      recharge: baseConfig,
      method: 'GET',
      path: '/subscriptions',
      version: '2023-06',
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.headers).toEqual(
      expect.objectContaining({
        'X-Recharge-Version': '2023-06',
      }),
    );
  });

  it('sets X-Recharge-Version from config.apiVersion when options.version absent', async () => {
    await rechargeRequest({
      recharge: configWithVersion,
      method: 'GET',
      path: '/subscriptions',
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.headers).toEqual(
      expect.objectContaining({
        'X-Recharge-Version': '2021-11',
      }),
    );
  });

  it('omits X-Recharge-Version when neither set', async () => {
    await rechargeRequest({
      recharge: baseConfig,
      method: 'GET',
      path: '/subscriptions',
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    const headers = opts?.headers as Record<string, string>;
    expect(headers).not.toHaveProperty('X-Recharge-Version');
  });

  it('throws on empty method', async () => {
    await expect(
      rechargeRequest({
        recharge: baseConfig,
        method: '',
        path: '/subscriptions',
      }),
    ).rejects.toThrow('Method is required');
  });

  it('calls throwOnHttpError with status, data, and Recharge', async () => {
    await rechargeRequest({
      recharge: baseConfig,
      method: 'GET',
      path: '/subscriptions',
    });

    expect(mockThrowOnHttpError).toHaveBeenCalledWith(200, { ok: true }, 'Recharge');
  });
});
