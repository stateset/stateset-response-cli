import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestJsonWithRetry, throwOnHttpError } from '../integrations/http.js';
import { shiphawkRequest } from '../integrations/shiphawk.js';

vi.mock('../integrations/http.js', () => ({
  requestJsonWithRetry: vi.fn(),
  normalizePath: vi.fn((p: string) => (p.startsWith('/') ? p : `/${p}`)),
  applyQueryParams: vi.fn(),
  throwOnHttpError: vi.fn(),
}));

const mockRequestJsonWithRetry = vi.mocked(requestJsonWithRetry);
const mockThrowOnHttpError = vi.mocked(throwOnHttpError);

const config = { apiKey: 'sh-key' };

describe('shiphawkRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestJsonWithRetry.mockResolvedValue({
      status: 200,
      headers: new Headers(),
      data: { ok: true },
    });
  });

  it('constructs correct URL', async () => {
    await shiphawkRequest({
      shiphawk: config,
      method: 'GET',
      path: '/shipments',
    });

    expect(mockRequestJsonWithRetry.mock.calls[0][0]).toBe('https://api.shiphawk.com/v4/shipments');
  });

  it('sets X-Api-Key header', async () => {
    await shiphawkRequest({
      shiphawk: config,
      method: 'GET',
      path: '/shipments',
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.headers).toEqual(
      expect.objectContaining({
        'X-Api-Key': 'sh-key',
      }),
    );
  });

  it('passes JSON body', async () => {
    const body = { shipment: { origin: 'NY' } };
    await shiphawkRequest({
      shiphawk: config,
      method: 'POST',
      path: '/shipments',
      body,
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.body).toBe(JSON.stringify(body));
  });

  it('throws on empty method', async () => {
    await expect(
      shiphawkRequest({
        shiphawk: config,
        method: '',
        path: '/shipments',
      }),
    ).rejects.toThrow('Method is required');
  });

  it('calls throwOnHttpError with status, data, and ShipHawk', async () => {
    await shiphawkRequest({
      shiphawk: config,
      method: 'GET',
      path: '/shipments',
    });

    expect(mockThrowOnHttpError).toHaveBeenCalledWith(200, { ok: true }, 'ShipHawk');
  });
});
