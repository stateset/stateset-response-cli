import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EngineClient, EngineClientError } from '../lib/engine-client.js';

function makeConfig(overrides: Partial<{ url: string; apiKey: string; tenantId: string }> = {}) {
  return {
    url: overrides.url ?? 'https://engine.example.com/',
    apiKey: overrides.apiKey ?? 'sk-test-key',
    tenantId: overrides.tenantId,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('EngineClientError', () => {
  it('stores name, message, status, code, data', () => {
    const err = new EngineClientError('fail', { status: 422, code: 'INVALID', data: { x: 1 } });
    expect(err.name).toBe('EngineClientError');
    expect(err.message).toBe('fail');
    expect(err.status).toBe(422);
    expect(err.code).toBe('INVALID');
    expect(err.data).toEqual({ x: 1 });
  });

  it('defaults to undefined for optional fields', () => {
    const err = new EngineClientError('boom');
    expect(err.status).toBeUndefined();
    expect(err.code).toBeUndefined();
  });
});

describe('EngineClient constructor', () => {
  it('strips trailing slash from URL', () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new EngineClient(makeConfig({ url: 'https://engine.example.com/' }));
    void client.health();

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe('https://engine.example.com/health');
    vi.unstubAllGlobals();
  });
});

describe('EngineClient headers', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends Authorization header', async () => {
    const client = new EngineClient(makeConfig({ apiKey: 'my-key' }));
    await client.health();

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer my-key');
  });

  it('sends x-tenant-id when tenantId is set', async () => {
    const client = new EngineClient(makeConfig({ tenantId: 'tenant-1' }));
    await client.health();

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers['x-tenant-id']).toBe('tenant-1');
  });

  it('omits x-tenant-id when tenantId is not set', async () => {
    const client = new EngineClient(makeConfig());
    await client.health();

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers['x-tenant-id']).toBeUndefined();
  });
});

describe('EngineClient error handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws EngineClientError on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, 400)));

    const client = new EngineClient(makeConfig());
    await expect(client.health()).rejects.toThrow(EngineClientError);
  });

  it('preserves status code on error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'nope' }, 403)));

    const client = new EngineClient(makeConfig());
    try {
      await client.health();
      expect.fail('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EngineClientError);
      expect((err as EngineClientError).status).toBe(403);
    }
  });

  it('wraps AbortError as timeout', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortErr));

    const client = new EngineClient(makeConfig());
    try {
      await client.health();
      expect.fail('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EngineClientError);
      expect((err as EngineClientError).status).toBe(504);
      expect((err as EngineClientError).code).toBe('TIMEOUT');
    }
  });
});

describe('EngineClient API methods', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: EngineClient;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    vi.stubGlobal('fetch', fetchMock);
    client = new EngineClient(makeConfig());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('health() calls GET /health', async () => {
    await client.health();
    expect(fetchMock.mock.calls[0][0]).toContain('/health');
  });

  it('listBrands() calls GET /v1/brands', async () => {
    await client.listBrands({ slug: 'acme' });
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/brands?slug=acme');
  });

  it('createBrand() calls POST /v1/brands', async () => {
    await client.createBrand({ name: 'Test' });
    const opts = fetchMock.mock.calls[0][1];
    expect(opts.method).toBe('POST');
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/brands');
  });

  it('listBootstrapTemplates() calls GET /v1/bootstrap/templates', async () => {
    await client.listBootstrapTemplates();
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/bootstrap/templates');
  });

  it('bootstrapBrand() calls POST /v1/bootstrap/brands', async () => {
    await client.bootstrapBrand({ slug: 'acme' });
    const opts = fetchMock.mock.calls[0][1];
    expect(opts.method).toBe('POST');
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/bootstrap/brands');
  });

  it('startWorkflow() calls POST', async () => {
    await client.startWorkflow({ brand: 'acme', ticket_id: '123' });
    const opts = fetchMock.mock.calls[0][1];
    expect(opts.method).toBe('POST');
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/workflows/response-automation-v2/start');
  });

  it('ingestEvent() includes idempotency-key header', async () => {
    await client.ingestEvent('acme', { event_type: 'test' }, 'key-1');
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers['idempotency-key']).toBe('key-1');
  });

  it('cancelWorkflow() calls POST', async () => {
    await client.cancelWorkflow('wf-123');
    const opts = fetchMock.mock.calls[0][1];
    expect(opts.method).toBe('POST');
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/workflows/wf-123/cancel');
  });

  it('cancelWorkflow() routes rav2 workflow ids to the typed endpoint', async () => {
    await client.cancelWorkflow('rav2-123');
    expect(fetchMock.mock.calls[0][0]).toContain(
      '/v1/workflows/response-automation-v2/rav2-123/cancel',
    );
  });

  it('restartWorkflow() calls the rav2 restart endpoint', async () => {
    await client.restartWorkflow('rav2-123');
    expect(fetchMock.mock.calls[0][0]).toContain(
      '/v1/workflows/response-automation-v2/rav2-123/restart',
    );
  });

  it('terminateWorkflow() routes connector workflow ids correctly', async () => {
    await client.terminateWorkflow('connector-123');
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/workflows/connector/connector-123/terminate');
  });

  it('reviewWorkflow() routes legacy workflow ids to the signal endpoint', async () => {
    await client.reviewWorkflow('legacy-123', { approved: true });
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/workflows/legacy-123/signal/review');
  });

  it('listDlq() calls GET with query params', async () => {
    await client.listDlq('brand-1', { status: 'pending', limit: 5 });
    expect(fetchMock.mock.calls[0][0]).toContain('status=pending');
    expect(fetchMock.mock.calls[0][0]).toContain('limit=5');
  });

  it('startConnectorWorkflow() calls POST', async () => {
    await client.startConnectorWorkflow({ brand: 'acme' });
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/workflows/connector/start');
  });

  it('getSnoozeStatus() calls GET', async () => {
    await client.getSnoozeStatus('snz-1');
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/workflows/snooze/snz-1/status');
  });

  it('listBrandConfigVersions() calls GET with query params', async () => {
    await client.listBrandConfigVersions('brand-1', { limit: 10 });
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/brands/brand-1/config-versions?limit=10');
  });

  it('listBrandWorkflows() calls GET with query params', async () => {
    await client.listBrandWorkflows('brand-1', { status: 'completed', limit: 5 });
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/brands/brand-1/workflows?status=completed');
    expect(fetchMock.mock.calls[0][0]).toContain('limit=5');
  });

  it('getDispatchHealthDashboard() calls GET with query params', async () => {
    await client.getDispatchHealthDashboard({
      tenantId: 'tenant-1',
      limit: 10,
      offset: 5,
    });
    expect(fetchMock.mock.calls[0][0]).toContain(
      '/v1/dispatch/health?tenant_id=tenant-1&limit=10&offset=5',
    );
  });

  it('runDispatchGuard() calls POST with request body', async () => {
    await client.runDispatchGuard({
      tenantId: 'tenant-1',
      apply: true,
      minimumHealthStatus: 'warning',
      maxActions: 3,
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1/dispatch/guard');
    expect(options.method).toBe('POST');
    expect(JSON.parse(String(options.body))).toEqual({
      tenant_id: 'tenant-1',
      apply: true,
      minimum_health_status: 'warning',
      max_actions: 3,
    });
  });
});

describe('EngineClient retry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does NOT retry POST on 503', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'unavailable' }, 503)));

    const client = new EngineClient(makeConfig());
    await expect(client.createBrand({ name: 'test' })).rejects.toThrow(EngineClientError);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry GET on 400', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, 400)));

    const client = new EngineClient(makeConfig());
    await expect(client.health()).rejects.toThrow(EngineClientError);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});
