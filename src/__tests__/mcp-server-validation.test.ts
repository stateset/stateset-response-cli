vi.mock('../config.js', () => ({
  validateRuntimeConfig: vi.fn(),
}));

vi.mock('../mcp-server/graphql-client.js', () => ({
  createGraphQLClient: vi.fn(() => ({})),
}));

vi.mock('../lib/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateRuntimeConfig } from '../config.js';
import { ConfigurationError } from '../lib/errors.js';
import { createServer } from '../mcp-server/server.js';

describe('createServer validation', () => {
  const mockedValidate = vi.mocked(validateRuntimeConfig);

  beforeEach(() => {
    mockedValidate.mockReset();
  });

  it('throws when validateRuntimeConfig rejects missing credentials', () => {
    mockedValidate.mockImplementation(() => {
      throw new ConfigurationError(
        'Organization "test-org" is missing credentials. Run "response auth login" to set up your credentials.',
      );
    });

    expect(() => createServer()).toThrow('missing credentials');
  });

  it('throws when validateRuntimeConfig rejects empty endpoint', () => {
    mockedValidate.mockImplementation(() => {
      throw new ConfigurationError(
        'Organization "test-org" has no GraphQL endpoint configured. Run "response auth login" to set up your organization.',
      );
    });

    expect(() => createServer()).toThrow('no GraphQL endpoint configured');
  });

  it('throws when validateRuntimeConfig rejects invalid endpoint URL', () => {
    mockedValidate.mockImplementation(() => {
      throw new ConfigurationError(
        'Organization "test-org" has an invalid GraphQL endpoint: "not-a-url". Expected a valid HTTP(S) URL.',
      );
    });

    expect(() => createServer()).toThrow('invalid GraphQL endpoint');
  });
});
