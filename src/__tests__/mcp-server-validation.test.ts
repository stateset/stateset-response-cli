vi.mock('../config.js', () => ({
  getCurrentOrg: vi.fn(),
}));

vi.mock('./graphql-client.js', () => ({
  createGraphQLClient: vi.fn(() => ({})),
}));

vi.mock('../lib/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCurrentOrg } from '../config.js';

const mockedGetCurrentOrg = vi.mocked(getCurrentOrg);

// Dynamically import after mocks are set up
async function importCreateServer() {
  const mod = await import('../mcp-server/server.js');
  return mod.createServer;
}

describe('createServer validation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws when credentials are missing', async () => {
    mockedGetCurrentOrg.mockReturnValue({
      orgId: 'test-org',
      config: {
        name: 'Test',
        graphqlEndpoint: 'https://api.example.com/v1/graphql',
      },
    });

    const createServer = await importCreateServer();
    expect(() => createServer()).toThrow('missing credentials');
  });

  it('throws when graphqlEndpoint is empty', async () => {
    mockedGetCurrentOrg.mockReturnValue({
      orgId: 'test-org',
      config: {
        name: 'Test',
        graphqlEndpoint: '',
        cliToken: 'some-token',
      },
    });

    const createServer = await importCreateServer();
    expect(() => createServer()).toThrow('no GraphQL endpoint configured');
  });

  it('throws when graphqlEndpoint is not a valid URL', async () => {
    mockedGetCurrentOrg.mockReturnValue({
      orgId: 'test-org',
      config: {
        name: 'Test',
        graphqlEndpoint: 'not-a-url',
        cliToken: 'some-token',
      },
    });

    const createServer = await importCreateServer();
    expect(() => createServer()).toThrow('invalid GraphQL endpoint');
  });
});
