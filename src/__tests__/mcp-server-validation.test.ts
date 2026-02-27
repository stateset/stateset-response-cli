vi.mock('../config.js', () => ({
  validateRuntimeConfig: vi.fn(),
}));

vi.mock('./graphql-client.js', () => ({
  createGraphQLClient: vi.fn(() => ({})),
}));

vi.mock('../lib/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateRuntimeConfig } from '../config.js';
import { ConfigurationError } from '../lib/errors.js';

const mockedValidate = vi.mocked(validateRuntimeConfig);

// Dynamically import after mocks are set up
async function importCreateServer() {
  const mod = await import('../mcp-server/server.js');
  return mod.createServer;
}

describe('createServer validation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws when validateRuntimeConfig rejects missing credentials', async () => {
    mockedValidate.mockImplementation(() => {
      throw new ConfigurationError(
        'Organization "test-org" is missing credentials. Run "response auth login" to set up your credentials.',
      );
    });

    const createServer = await importCreateServer();
    expect(() => createServer()).toThrow('missing credentials');
  });

  it('throws when validateRuntimeConfig rejects empty endpoint', async () => {
    mockedValidate.mockImplementation(() => {
      throw new ConfigurationError(
        'Organization "test-org" has no GraphQL endpoint configured. Run "response auth login" to set up your organization.',
      );
    });

    const createServer = await importCreateServer();
    expect(() => createServer()).toThrow('no GraphQL endpoint configured');
  });

  it('throws when validateRuntimeConfig rejects invalid endpoint URL', async () => {
    mockedValidate.mockImplementation(() => {
      throw new ConfigurationError(
        'Organization "test-org" has an invalid GraphQL endpoint: "not-a-url". Expected a valid HTTP(S) URL.',
      );
    });

    const createServer = await importCreateServer();
    expect(() => createServer()).toThrow('invalid GraphQL endpoint');
  });
});
