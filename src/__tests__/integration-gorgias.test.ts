import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../integrations/http.js', async () => {
  const actual =
    await vi.importActual<typeof import('../integrations/http.js')>('../integrations/http.js');
  return {
    ...actual,
    normalizePath: vi.fn((p: string) => (p.startsWith('/') ? p : `/${p}`)),
    applyQueryParams: vi.fn(),
    requestJsonWithRetry: vi.fn(),
  };
});

import { requestJsonWithRetry } from '../integrations/http.js';
import { createGorgiasApi } from '../integrations/gorgias.js';
import type { GorgiasApi } from '../integrations/gorgias.js';

const config = { domain: 'test-shop', apiKey: 'gorg-key', email: 'admin@test.com' };
const expectedAuth = Buffer.from('admin@test.com:gorg-key').toString('base64');

describe('createGorgiasApi', () => {
  let api: GorgiasApi;
  const mockRequestJsonWithRetry = vi.mocked(requestJsonWithRetry);

  beforeEach(() => {
    vi.restoreAllMocks();
    mockRequestJsonWithRetry.mockReset();
    mockRequestJsonWithRetry.mockResolvedValue({
      status: 200,
      headers: new Headers(),
      data: {},
    });
    api = createGorgiasApi(config);
  });

  it('returns all 12 methods as functions', () => {
    const expectedMethods = [
      'requestRaw',
      'listTickets',
      'getTicket',
      'updateTicket',
      'addMessage',
      'getTicketMessages',
      'listMacros',
      'getMacro',
      'applyMacro',
      'mergeTickets',
      'listUsers',
      'listTeams',
    ];

    for (const method of expectedMethods) {
      expect(typeof api[method as keyof GorgiasApi]).toBe('function');
    }
  });

  it('sets Basic auth header with Base64 encoded email:apiKey', async () => {
    await api.getTicket(1);

    const [, opts] = mockRequestJsonWithRetry.mock.calls[0];
    expect(opts?.headers).toEqual(
      expect.objectContaining({
        Authorization: `Basic ${expectedAuth}`,
      }),
    );
  });

  it('getTicket calls /tickets/{id} with GET', async () => {
    await api.getTicket(42);

    const [url, opts] = mockRequestJsonWithRetry.mock.calls[0];
    expect(url.toString()).toContain('/api/tickets/42');
    expect(opts?.method).toBe('GET');
  });

  it('listTickets calls /tickets with GET', async () => {
    await api.listTickets();

    const [url, opts] = mockRequestJsonWithRetry.mock.calls[0];
    expect(url.toString()).toContain('/api/tickets');
    expect(opts?.method).toBe('GET');
  });

  it('listTickets builds query string from params', async () => {
    await api.listTickets({ status: 'open', limit: 10 });

    const [url] = mockRequestJsonWithRetry.mock.calls[0];
    const urlStr = url.toString();
    expect(urlStr).toContain('status=open');
    expect(urlStr).toContain('limit=10');
  });

  it('updateTicket sends PUT to /tickets/{id} with body', async () => {
    const data = { status: 'closed' };
    await api.updateTicket(7, data);

    const [url, opts] = mockRequestJsonWithRetry.mock.calls[0];
    expect(url.toString()).toContain('/api/tickets/7');
    expect(opts?.method).toBe('PUT');
    expect(JSON.parse(String(opts?.body))).toEqual(data);
  });

  it('addMessage auto-adds via: api when not present', async () => {
    await api.addMessage(5, { body_text: 'hello' });

    const [, opts] = mockRequestJsonWithRetry.mock.calls[0];
    const parsed = JSON.parse(String(opts?.body));
    expect(parsed.via).toBe('api');
    expect(parsed.body_text).toBe('hello');
  });

  it('addMessage preserves existing via value', async () => {
    await api.addMessage(5, { body_text: 'hello', via: 'email' });

    const [, opts] = mockRequestJsonWithRetry.mock.calls[0];
    const parsed = JSON.parse(String(opts?.body));
    expect(parsed.via).toBe('email');
  });

  it('applyMacro sends POST to /tickets/{id}/apply-macro with macro_id', async () => {
    await api.applyMacro(10, 99);

    const [url, opts] = mockRequestJsonWithRetry.mock.calls[0];
    expect(url.toString()).toContain('/api/tickets/10/apply-macro');
    expect(opts?.method).toBe('POST');
    expect(JSON.parse(String(opts?.body))).toEqual({ macro_id: 99 });
  });

  it('mergeTickets sends POST to /tickets/{id}/merge with ticket_ids', async () => {
    await api.mergeTickets(1, [2, 3, 4]);

    const [url, opts] = mockRequestJsonWithRetry.mock.calls[0];
    expect(url.toString()).toContain('/api/tickets/1/merge');
    expect(opts?.method).toBe('POST');
    expect(JSON.parse(String(opts?.body))).toEqual({ ticket_ids: [2, 3, 4] });
  });

  it('listMacros, listUsers, and listTeams call correct endpoints', async () => {
    await api.listMacros();
    expect(mockRequestJsonWithRetry.mock.calls[0][0].toString()).toContain('/api/macros');

    mockRequestJsonWithRetry.mockClear();
    await api.listUsers();
    expect(mockRequestJsonWithRetry.mock.calls[0][0].toString()).toContain('/api/users');

    mockRequestJsonWithRetry.mockClear();
    await api.listTeams();
    expect(mockRequestJsonWithRetry.mock.calls[0][0].toString()).toContain('/api/teams');
  });

  it('throws on non-ok response', async () => {
    mockRequestJsonWithRetry.mockResolvedValue({
      status: 404,
      headers: new Headers(),
      data: 'not found',
    });

    await expect(api.getTicket(999)).rejects.toThrow('Gorgias API error (404): not found');
  });
});
