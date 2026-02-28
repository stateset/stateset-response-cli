/**
 * Tests for GraphQL client
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GraphQLClient } from 'graphql-request';
import { createGraphQLClient, executeQuery } from '../mcp-server/graphql-client.js';

// Mock graphql-request
vi.mock('graphql-request', () => ({
  GraphQLClient: vi.fn().mockImplementation(() => ({
    request: vi.fn(),
  })),
}));

describe('createGraphQLClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.STATESET_ALLOW_INSECURE_HTTP;
  });

  it('creates client with admin secret auth', () => {
    createGraphQLClient(
      'https://api.example.com/graphql',
      { type: 'admin_secret', adminSecret: 'my-secret' },
      'org-123',
    );

    expect(GraphQLClient).toHaveBeenCalledWith('https://api.example.com/graphql', {
      headers: {
        'Content-Type': 'application/json',
        'x-hasura-admin-secret': 'my-secret',
        'x-stateset-org-id': 'org-123',
      },
    });
  });

  it('creates client with CLI token auth', () => {
    createGraphQLClient(
      'https://api.example.com/graphql',
      { type: 'cli_token', token: 'my-token' },
      'org-456',
    );

    expect(GraphQLClient).toHaveBeenCalledWith('https://api.example.com/graphql', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer my-token',
        'x-stateset-org-id': 'org-456',
      },
    });
  });

  it('creates client without org ID', () => {
    createGraphQLClient('https://api.example.com/graphql', {
      type: 'cli_token',
      token: 'my-token',
    });

    expect(GraphQLClient).toHaveBeenCalledWith('https://api.example.com/graphql', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer my-token',
      },
    });
  });

  it('rejects insecure http endpoint by default', () => {
    expect(() =>
      createGraphQLClient('http://api.example.com/graphql', {
        type: 'cli_token',
        token: 'my-token',
      }),
    ).toThrow('Refusing insecure GraphQL endpoint');
  });

  it('allows insecure http endpoint when explicitly enabled', () => {
    process.env.STATESET_ALLOW_INSECURE_HTTP = 'true';

    createGraphQLClient('http://api.example.com/graphql', {
      type: 'cli_token',
      token: 'my-token',
    });

    expect(GraphQLClient).toHaveBeenCalledWith('http://api.example.com/graphql', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer my-token',
      },
    });
  });
});

describe('executeQuery', () => {
  let mockClient: { request: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Pin Math.random to 0.5 so jitter is deterministic (0.5*2-1=0 → zero jitter)
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    mockClient = { request: vi.fn() };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('executes query successfully', async () => {
    const expectedData = { users: [{ id: '1', name: 'Test' }] };
    mockClient.request.mockResolvedValueOnce(expectedData);

    const result = await executeQuery(
      mockClient as unknown as GraphQLClient,
      'query { users { id name } }',
      {},
    );

    expect(result).toEqual(expectedData);
    expect(mockClient.request).toHaveBeenCalledTimes(1);
  });

  it('passes variables to query', async () => {
    mockClient.request.mockResolvedValueOnce({ user: { id: '1' } });

    await executeQuery(
      mockClient as unknown as GraphQLClient,
      'query ($id: ID!) { user(id: $id) { id } }',
      { id: '123' },
    );

    expect(mockClient.request).toHaveBeenCalledWith(
      expect.objectContaining({
        document: 'query ($id: ID!) { user(id: $id) { id } }',
        variables: { id: '123' },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('retries on 502 status', async () => {
    const error502 = new Error('Bad Gateway');
    (error502 as unknown as { response: { status: number } }).response = { status: 502 };

    mockClient.request.mockRejectedValueOnce(error502).mockResolvedValueOnce({ data: 'success' });

    const resultPromise = executeQuery(mockClient as unknown as GraphQLClient, 'query { data }');

    // Fast-forward past the delay
    await vi.advanceTimersByTimeAsync(1000);

    const result = await resultPromise;
    expect(result).toEqual({ data: 'success' });
    expect(mockClient.request).toHaveBeenCalledTimes(2);
  });

  it('retries on 503 status', async () => {
    const error503 = new Error('Service Unavailable');
    (error503 as unknown as { response: { status: number } }).response = { status: 503 };

    mockClient.request.mockRejectedValueOnce(error503).mockResolvedValueOnce({ data: 'success' });

    const resultPromise = executeQuery(mockClient as unknown as GraphQLClient, 'query { data }');

    await vi.advanceTimersByTimeAsync(1000);

    const result = await resultPromise;
    expect(result).toEqual({ data: 'success' });
    expect(mockClient.request).toHaveBeenCalledTimes(2);
  });

  it('retries on 504 status', async () => {
    const error504 = new Error('Gateway Timeout');
    (error504 as unknown as { response: { status: number } }).response = { status: 504 };

    mockClient.request.mockRejectedValueOnce(error504).mockResolvedValueOnce({ data: 'success' });

    const resultPromise = executeQuery(mockClient as unknown as GraphQLClient, 'query { data }');

    await vi.advanceTimersByTimeAsync(1000);

    const result = await resultPromise;
    expect(result).toEqual({ data: 'success' });
    expect(mockClient.request).toHaveBeenCalledTimes(2);
  });

  it('retries on TypeError (network failure)', async () => {
    mockClient.request
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({ data: 'success' });

    const resultPromise = executeQuery(mockClient as unknown as GraphQLClient, 'query { data }');

    await vi.advanceTimersByTimeAsync(1000);

    const result = await resultPromise;
    expect(result).toEqual({ data: 'success' });
    expect(mockClient.request).toHaveBeenCalledTimes(2);
  });

  it('retries on ECONNRESET', async () => {
    const errorReset = new Error('Connection reset');
    (errorReset as unknown as { code: string }).code = 'ECONNRESET';

    mockClient.request.mockRejectedValueOnce(errorReset).mockResolvedValueOnce({ data: 'success' });

    const resultPromise = executeQuery(mockClient as unknown as GraphQLClient, 'query { data }');

    await vi.advanceTimersByTimeAsync(1000);

    const result = await resultPromise;
    expect(result).toEqual({ data: 'success' });
  });

  it('retries on ECONNREFUSED', async () => {
    const errorRefused = new Error('Connection refused');
    (errorRefused as unknown as { code: string }).code = 'ECONNREFUSED';

    mockClient.request
      .mockRejectedValueOnce(errorRefused)
      .mockResolvedValueOnce({ data: 'success' });

    const resultPromise = executeQuery(mockClient as unknown as GraphQLClient, 'query { data }');

    await vi.advanceTimersByTimeAsync(1000);

    const result = await resultPromise;
    expect(result).toEqual({ data: 'success' });
  });

  it('retries on ETIMEDOUT', async () => {
    const errorTimeout = new Error('Connection timed out');
    (errorTimeout as unknown as { code: string }).code = 'ETIMEDOUT';

    mockClient.request
      .mockRejectedValueOnce(errorTimeout)
      .mockResolvedValueOnce({ data: 'success' });

    const resultPromise = executeQuery(mockClient as unknown as GraphQLClient, 'query { data }');

    await vi.advanceTimersByTimeAsync(1000);

    const result = await resultPromise;
    expect(result).toEqual({ data: 'success' });
  });

  it('does not retry on 400 status', async () => {
    const error400 = new Error('Bad Request');
    (error400 as unknown as { response: { status: number } }).response = { status: 400 };

    mockClient.request.mockRejectedValue(error400);

    await expect(
      executeQuery(mockClient as unknown as GraphQLClient, 'query { data }'),
    ).rejects.toThrow();

    expect(mockClient.request).toHaveBeenCalledTimes(1);
  });

  it('does not retry on 401 status', async () => {
    const error401 = new Error('Unauthorized');
    (error401 as unknown as { response: { status: number } }).response = { status: 401 };

    mockClient.request.mockRejectedValue(error401);

    await expect(
      executeQuery(mockClient as unknown as GraphQLClient, 'query { data }'),
    ).rejects.toThrow();

    expect(mockClient.request).toHaveBeenCalledTimes(1);
  });

  it('uses exponential backoff', async () => {
    const error502 = new Error('Bad Gateway');
    (error502 as unknown as { response: { status: number } }).response = { status: 502 };

    mockClient.request
      .mockRejectedValueOnce(error502)
      .mockRejectedValueOnce(error502)
      .mockRejectedValueOnce(error502)
      .mockResolvedValueOnce({ data: 'success' });

    const resultPromise = executeQuery(mockClient as unknown as GraphQLClient, 'query { data }');

    // First retry after 1000ms (1s * 2^0)
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockClient.request).toHaveBeenCalledTimes(2);

    // Second retry after 2000ms (1s * 2^1)
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockClient.request).toHaveBeenCalledTimes(3);

    // Third retry after 4000ms (1s * 2^2)
    await vi.advanceTimersByTimeAsync(4000);
    expect(mockClient.request).toHaveBeenCalledTimes(4);

    const result = await resultPromise;
    expect(result).toEqual({ data: 'success' });
  });

  it('gives up after MAX_RETRIES', async () => {
    const error502 = new Error('Bad Gateway');
    (error502 as unknown as { response: { status: number } }).response = { status: 502 };

    mockClient.request.mockRejectedValue(error502);

    const resultPromise = executeQuery(mockClient as unknown as GraphQLClient, 'query { data }');
    // Prevent PromiseRejectionHandledWarning — handler is attached after rejection occurs during timer advancement
    resultPromise.catch(() => {});

    // Advance through all retries
    await vi.advanceTimersByTimeAsync(1000); // retry 1
    await vi.advanceTimersByTimeAsync(2000); // retry 2
    await vi.advanceTimersByTimeAsync(4000); // retry 3

    await expect(resultPromise).rejects.toThrow();
    expect(mockClient.request).toHaveBeenCalledTimes(4); // initial + 3 retries
  });

  it('extracts error message from GraphQL response', async () => {
    const gqlError = new Error('GraphQL error');
    (gqlError as unknown as { response: { errors: Array<{ message: string }> } }).response = {
      errors: [{ message: 'Field "foo" is not defined' }],
    };

    mockClient.request.mockRejectedValue(gqlError);

    await expect(
      executeQuery(mockClient as unknown as GraphQLClient, 'query { foo }'),
    ).rejects.toThrow('Field "foo" is not defined');
  });

  it('falls back to error message when no GraphQL errors', async () => {
    const error = new Error('Something went wrong');
    mockClient.request.mockRejectedValue(error);

    await expect(
      executeQuery(mockClient as unknown as GraphQLClient, 'query { data }'),
    ).rejects.toThrow('Something went wrong');
  });

  it('handles unknown error type', async () => {
    mockClient.request.mockRejectedValue('string error');

    await expect(
      executeQuery(mockClient as unknown as GraphQLClient, 'query { data }'),
    ).rejects.toThrow('Unknown GraphQL error');
  });

  it('retries on 429 status', async () => {
    const error429 = new Error('Too Many Requests');
    (error429 as unknown as { response: { status: number } }).response = { status: 429 };

    mockClient.request.mockRejectedValueOnce(error429).mockResolvedValueOnce({ data: 'success' });

    const resultPromise = executeQuery(mockClient as unknown as GraphQLClient, 'query { data }');

    await vi.advanceTimersByTimeAsync(1000);

    const result = await resultPromise;
    expect(result).toEqual({ data: 'success' });
    expect(mockClient.request).toHaveBeenCalledTimes(2);
  });

  it('uses Retry-After header delay when present on 429', async () => {
    const error429 = new Error('Too Many Requests');
    (
      error429 as unknown as {
        response: { status: number; headers: { get: (name: string) => string | null } };
      }
    ).response = {
      status: 429,
      headers: { get: (name: string) => (name === 'retry-after' ? '3' : null) },
    };

    mockClient.request.mockRejectedValueOnce(error429).mockResolvedValueOnce({ data: 'ok' });

    const resultPromise = executeQuery(mockClient as unknown as GraphQLClient, 'query { data }');

    // Should wait 3000ms (3 seconds from Retry-After), not the default 1000ms
    await vi.advanceTimersByTimeAsync(2999);
    expect(mockClient.request).toHaveBeenCalledTimes(1); // not retried yet

    await vi.advanceTimersByTimeAsync(1);
    const result = await resultPromise;
    expect(result).toEqual({ data: 'ok' });
    expect(mockClient.request).toHaveBeenCalledTimes(2);
  });

  it('caps Retry-After at 60 seconds', async () => {
    const error429 = new Error('Too Many Requests');
    (
      error429 as unknown as {
        response: { status: number; headers: { get: (name: string) => string | null } };
      }
    ).response = {
      status: 429,
      headers: { get: (name: string) => (name === 'retry-after' ? '120' : null) },
    };

    mockClient.request.mockRejectedValueOnce(error429).mockResolvedValueOnce({ data: 'ok' });

    const resultPromise = executeQuery(mockClient as unknown as GraphQLClient, 'query { data }');

    // Should cap at 60000ms, not 120000ms
    await vi.advanceTimersByTimeAsync(59_999);
    expect(mockClient.request).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const result = await resultPromise;
    expect(result).toEqual({ data: 'ok' });
    expect(mockClient.request).toHaveBeenCalledTimes(2);
  });

  it('falls back to exponential backoff when no Retry-After header', async () => {
    const error429 = new Error('Too Many Requests');
    (error429 as unknown as { response: { status: number } }).response = { status: 429 };

    mockClient.request.mockRejectedValueOnce(error429).mockResolvedValueOnce({ data: 'ok' });

    const resultPromise = executeQuery(mockClient as unknown as GraphQLClient, 'query { data }');

    // Should use exponential backoff: 1000ms * 2^0 = 1000ms
    await vi.advanceTimersByTimeAsync(999);
    expect(mockClient.request).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const result = await resultPromise;
    expect(result).toEqual({ data: 'ok' });
    expect(mockClient.request).toHaveBeenCalledTimes(2);
  });
});
