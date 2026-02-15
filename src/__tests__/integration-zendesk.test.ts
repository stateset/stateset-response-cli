import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestJsonWithRetry, applyQueryParams, throwOnHttpError } from '../integrations/http.js';
import { zendeskRequest } from '../integrations/zendesk.js';

vi.mock('../integrations/http.js', () => ({
  requestJsonWithRetry: vi.fn(),
  normalizePath: vi.fn((p: string) => (p.startsWith('/') ? p : `/${p}`)),
  applyQueryParams: vi.fn(),
  throwOnHttpError: vi.fn(),
}));

const mockRequestJsonWithRetry = vi.mocked(requestJsonWithRetry);
const mockApplyQueryParams = vi.mocked(applyQueryParams);
const mockThrowOnHttpError = vi.mocked(throwOnHttpError);

const config = { subdomain: 'test', email: 'a@b.com', apiToken: 'tok' };

describe('zendeskRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestJsonWithRetry.mockResolvedValue({
      status: 200,
      headers: new Headers(),
      data: { ok: true },
    });
  });

  it('constructs correct URL with subdomain', async () => {
    await zendeskRequest({
      zendesk: config,
      method: 'GET',
      path: '/tickets/123.json',
    });

    expect(mockRequestJsonWithRetry.mock.calls[0][0]).toBe(
      'https://test.zendesk.com/api/v2/tickets/123.json',
    );
  });

  it('sets Basic auth header with email/token:apiToken', async () => {
    await zendeskRequest({
      zendesk: config,
      method: 'GET',
      path: '/tickets.json',
    });

    const expectedAuth = Buffer.from('a@b.com/token:tok').toString('base64');
    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.headers).toEqual(
      expect.objectContaining({
        Authorization: `Basic ${expectedAuth}`,
      }),
    );
  });

  it('passes query params via applyQueryParams', async () => {
    await zendeskRequest({
      zendesk: config,
      method: 'GET',
      path: '/tickets.json',
      query: { status: 'open' },
    });

    expect(mockApplyQueryParams).toHaveBeenCalledTimes(1);
    expect(mockApplyQueryParams.mock.calls[0][1]).toEqual({ status: 'open' });
  });

  it('passes JSON body for POST', async () => {
    const body = { ticket: { subject: 'Help' } };
    await zendeskRequest({
      zendesk: config,
      method: 'POST',
      path: '/tickets.json',
      body,
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.body).toBe(JSON.stringify(body));
  });

  it('throws on empty method', async () => {
    await expect(
      zendeskRequest({
        zendesk: config,
        method: '',
        path: '/tickets.json',
      }),
    ).rejects.toThrow('Method is required');
  });

  it('calls throwOnHttpError with status, data, and Zendesk', async () => {
    await zendeskRequest({
      zendesk: config,
      method: 'GET',
      path: '/tickets.json',
    });

    expect(mockThrowOnHttpError).toHaveBeenCalledWith(200, { ok: true }, 'Zendesk');
  });
});
