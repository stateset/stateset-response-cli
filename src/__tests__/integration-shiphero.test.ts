import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestJsonWithRetry, throwOnHttpError } from '../integrations/http.js';
import { shipheroGraphql } from '../integrations/shiphero.js';

vi.mock('../integrations/http.js', () => ({
  requestJsonWithRetry: vi.fn(),
  throwOnHttpError: vi.fn(),
}));

const mockRequestJsonWithRetry = vi.mocked(requestJsonWithRetry);
const mockThrowOnHttpError = vi.mocked(throwOnHttpError);

const config = { accessToken: 'hero-tok' };

describe('shipheroGraphql', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestJsonWithRetry.mockResolvedValue({
      status: 200,
      headers: new Headers(),
      data: { data: { orders: [] } },
    });
  });

  it('sends POST to the ShipHero GraphQL endpoint', async () => {
    await shipheroGraphql({
      shiphero: config,
      query: '{ orders { id } }',
    });

    expect(mockRequestJsonWithRetry.mock.calls[0][0]).toBe(
      'https://public-api.shiphero.com/graphql',
    );
    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.method).toBe('POST');
  });

  it('sets Bearer authorization header', async () => {
    await shipheroGraphql({
      shiphero: config,
      query: '{ orders { id } }',
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    expect(opts?.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer hero-tok',
      }),
    );
  });

  it('sends query and variables in JSON body', async () => {
    const variables = { first: 10, status: 'pending' };
    await shipheroGraphql({
      shiphero: config,
      query: '{ orders($first: Int) { id } }',
      variables,
    });

    const opts = mockRequestJsonWithRetry.mock.calls[0][1];
    const parsed = JSON.parse(opts?.body as string);
    expect(parsed.query).toBe('{ orders($first: Int) { id } }');
    expect(parsed.variables).toEqual(variables);
  });

  it('extracts .data from response payload', async () => {
    mockRequestJsonWithRetry.mockResolvedValue({
      status: 200,
      headers: new Headers(),
      data: { data: { orders: [{ id: '1' }] } },
    });

    const result = await shipheroGraphql({
      shiphero: config,
      query: '{ orders { id } }',
    });

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ orders: [{ id: '1' }] });
  });

  it('throws on empty query', async () => {
    await expect(
      shipheroGraphql({
        shiphero: config,
        query: '',
      }),
    ).rejects.toThrow('GraphQL query is required');
  });

  it('throws on GraphQL errors in response', async () => {
    mockRequestJsonWithRetry.mockResolvedValue({
      status: 200,
      headers: new Headers(),
      data: { errors: [{ message: 'bad' }] },
    });

    await expect(
      shipheroGraphql({
        shiphero: config,
        query: '{ orders { id } }',
      }),
    ).rejects.toThrow('ShipHero GraphQL error: bad');
  });

  it('calls throwOnHttpError with status, data, and ShipHero', async () => {
    await shipheroGraphql({
      shiphero: config,
      query: '{ orders { id } }',
    });

    expect(mockThrowOnHttpError).toHaveBeenCalledWith(200, { data: { orders: [] } }, 'ShipHero');
  });
});
