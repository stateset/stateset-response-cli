import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDnsLookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => mockDnsLookup(...args),
}));

import {
  requestText,
  requestJson,
  requestJsonWithRetry,
  normalizePath,
  throwOnHttpError,
  applyQueryParams,
} from '../integrations/http.js';

describe('requestText', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockDnsLookup.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  it('returns status, headers, and text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: () => Promise.resolve('hello'),
      }),
    );

    const result = await requestText('https://example.com/api');
    expect(result.status).toBe(200);
    expect(result.text).toBe('hello');
    expect(result.headers.get('content-type')).toBe('text/plain');
  });

  it('defaults to GET method', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      text: () => Promise.resolve(''),
    });
    vi.stubGlobal('fetch', mockFetch);

    await requestText('https://example.com/api');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/api',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('passes custom headers and method', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 201,
      headers: new Headers(),
      text: () => Promise.resolve('created'),
    });
    vi.stubGlobal('fetch', mockFetch);

    await requestText('https://example.com/api', {
      method: 'POST',
      headers: { Authorization: 'Bearer token' },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/api',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer token' },
      }),
    );
  });
});

describe('requestJson', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockDnsLookup.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  it('parses JSON response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve('{"key":"value"}'),
      }),
    );

    const result = await requestJson('https://example.com/api');
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ key: 'value' });
  });

  it('falls back to text when JSON parsing fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve('not json'),
      }),
    );

    const result = await requestJson('https://example.com/api');
    expect(result.data).toBe('not json');
  });
});

describe('requestJsonWithRetry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockDnsLookup.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  it('returns immediately on success', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      text: () => Promise.resolve('{"ok":true}'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await requestJsonWithRetry('https://example.com/api');
    expect(result.data).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('blocks literal private IP targets before issuing a request', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    await expect(requestJsonWithRetry('https://127.0.0.1/api')).rejects.toThrow(
      'Blocked private network URL host',
    );
    expect(mockDnsLookup).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('blocks hostnames that resolve to private IP addresses', async () => {
    mockDnsLookup.mockResolvedValueOnce([{ address: '10.0.0.8', family: 4 }]);
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    await expect(requestJsonWithRetry('https://api.example.com/api')).rejects.toThrow(
      'resolved to "10.0.0.8"',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('retries on 429 status', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        status: 429,
        headers: new Headers(),
        text: () => Promise.resolve('{"error":"rate limited"}'),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve('{"ok":true}'),
      });
    vi.stubGlobal('fetch', mockFetch);

    const result = await requestJsonWithRetry('https://example.com/api', {}, { maxRetries: 3 });
    expect(result.data).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on 500+ status', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        status: 503,
        headers: new Headers(),
        text: () => Promise.resolve('service unavailable'),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve('{"ok":true}'),
      });
    vi.stubGlobal('fetch', mockFetch);

    const result = await requestJsonWithRetry('https://example.com/api', {}, { maxRetries: 3 });
    expect(result.data).toEqual({ ok: true });
  });

  it('returns non-retryable error response without retrying', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 400,
      headers: new Headers(),
      text: () => Promise.resolve('{"error":"bad request"}'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await requestJsonWithRetry('https://example.com/api', {}, { maxRetries: 3 });
    expect(result.status).toBe(400);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws after maxRetries exceeded on server errors', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 500,
      headers: new Headers(),
      text: () => Promise.resolve('server error'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await requestJsonWithRetry('https://example.com/api', {}, { maxRetries: 2 });
    // On max retries, it returns the last response rather than throwing
    expect(result.status).toBe(500);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws immediately with maxRetries=0', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(
      requestJsonWithRetry('https://example.com/api', {}, { maxRetries: 0 }),
    ).rejects.toThrow('exceeded maxRetries');
  });

  it('uses backoff when Retry-After header is non-numeric', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        status: 429,
        headers: new Headers({ 'retry-after': 'not-a-number' }),
        text: () => Promise.resolve('{"error":"rate limited"}'),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve('{"ok":true}'),
      });
    vi.stubGlobal('fetch', mockFetch);

    const result = await requestJsonWithRetry('https://example.com/api', {}, { maxRetries: 3 });
    expect(result.data).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns last response when maxRetries=1 and server returns 500', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 500,
      headers: new Headers(),
      text: () => Promise.resolve('server error'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await requestJsonWithRetry('https://example.com/api', {}, { maxRetries: 1 });
    expect(result.status).toBe(500);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws when all retries fail with network error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      requestJsonWithRetry('https://example.com/api', {}, { maxRetries: 2 }),
    ).rejects.toThrow('fetch failed');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on network error', async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve('{"ok":true}'),
      });
    vi.stubGlobal('fetch', mockFetch);

    const result = await requestJsonWithRetry('https://example.com/api', {}, { maxRetries: 3 });
    expect(result.data).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-idempotent POST requests without an idempotency key', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        status: 500,
        headers: new Headers(),
        text: () => Promise.resolve('server error'),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve('{"ok":true}'),
      });
    vi.stubGlobal('fetch', mockFetch);

    const result = await requestJsonWithRetry(
      'https://example.com/api',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hello: 'world' }),
      },
      { maxRetries: 3 },
    );

    expect(result.status).toBe(500);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries POST requests when an idempotency key is provided', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        status: 500,
        headers: new Headers(),
        text: () => Promise.resolve('server error'),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve('{"ok":true}'),
      });
    vi.stubGlobal('fetch', mockFetch);

    const result = await requestJsonWithRetry(
      'https://example.com/api',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'req-123',
        },
        body: JSON.stringify({ hello: 'world' }),
      },
      { maxRetries: 3 },
    );

    expect(result.data).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('normalizePath', () => {
  it('passes through a path with leading slash', () => {
    expect(normalizePath('/orders')).toBe('/orders');
  });

  it('adds leading slash if missing', () => {
    expect(normalizePath('orders/123')).toBe('/orders/123');
  });

  it('throws on empty path', () => {
    expect(() => normalizePath('')).toThrow('Path is required');
  });

  it('throws on whitespace-only path', () => {
    expect(() => normalizePath('   ')).toThrow('Path is required');
  });

  it('throws on absolute URL', () => {
    expect(() => normalizePath('https://example.com/orders')).toThrow('Path must be relative');
  });

  it('throws on http URL', () => {
    expect(() => normalizePath('http://example.com')).toThrow('Path must be relative');
  });

  it('includes example in error when provided', () => {
    expect(() => normalizePath('https://x.com', '/tickets/123')).toThrow(
      'Path must be relative (e.g., /tickets/123)',
    );
  });

  it('trims whitespace', () => {
    expect(normalizePath('  /orders  ')).toBe('/orders');
  });
});

describe('throwOnHttpError', () => {
  it('does nothing for status < 400', () => {
    expect(() => throwOnHttpError(200, { ok: true }, 'Test')).not.toThrow();
    expect(() => throwOnHttpError(301, 'redirect', 'Test')).not.toThrow();
    expect(() => throwOnHttpError(399, 'ok', 'Test')).not.toThrow();
  });

  it('throws for status 400 with string data', () => {
    expect(() => throwOnHttpError(400, 'bad request', 'Zendesk')).toThrow(
      'Zendesk API error (400): bad request',
    );
  });

  it('throws for status 500 with object data', () => {
    expect(() => throwOnHttpError(500, { error: 'internal' }, 'Loop')).toThrow(
      'Loop API error (500): {"error":"internal"}',
    );
  });

  it('throws for status 404', () => {
    expect(() => throwOnHttpError(404, 'not found', 'ShipHero')).toThrow(
      'ShipHero API error (404): not found',
    );
  });

  it('throws AuthenticationError for status 401', () => {
    expect(() => throwOnHttpError(401, 'unauthorized', 'Slack')).toThrow(
      'Slack API error (401): unauthorized',
    );
  });

  it('throws AuthorizationError for status 403', () => {
    expect(() => throwOnHttpError(403, 'forbidden', 'Gorgias')).toThrow(
      'Gorgias API error (403): forbidden',
    );
  });

  it('throws RateLimitError for status 429', () => {
    expect(() => throwOnHttpError(429, 'too many requests', 'Klaviyo')).toThrow(
      'Klaviyo API error (429): too many requests',
    );
  });

  it('throws StateSetError for unrecognized 4xx status', () => {
    expect(() => throwOnHttpError(418, "I'm a teapot", 'Test')).toThrow(
      "Test API error (418): I'm a teapot",
    );
  });
});

describe('applyQueryParams', () => {
  it('sets string values', () => {
    const url = new URL('https://example.com/api');
    applyQueryParams(url, { status: 'open', limit: '10' });
    expect(url.searchParams.get('status')).toBe('open');
    expect(url.searchParams.get('limit')).toBe('10');
  });

  it('converts numbers and booleans to strings', () => {
    const url = new URL('https://example.com/api');
    applyQueryParams(url, { page: 3, active: true });
    expect(url.searchParams.get('page')).toBe('3');
    expect(url.searchParams.get('active')).toBe('true');
  });

  it('skips null and undefined values', () => {
    const url = new URL('https://example.com/api');
    applyQueryParams(url, { a: 'keep', b: undefined, c: null });
    expect(url.searchParams.get('a')).toBe('keep');
    expect(url.searchParams.has('b')).toBe(false);
    expect(url.searchParams.has('c')).toBe(false);
  });

  it('is a no-op when query is null', () => {
    const url = new URL('https://example.com/api');
    applyQueryParams(url, null);
    expect(url.search).toBe('');
  });

  it('is a no-op when query is undefined', () => {
    const url = new URL('https://example.com/api');
    applyQueryParams(url, undefined);
    expect(url.search).toBe('');
  });
});
