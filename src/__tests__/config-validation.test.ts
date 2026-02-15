import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn(),
  },
}));
vi.mock('../lib/secrets.js', () => ({
  encryptSecret: (v: string) => v,
  decryptSecret: (v: string) => v,
  isEncrypted: () => false,
}));

import fs from 'node:fs';
import { loadConfig, saveConfig, getConfigPath, migrateConfigSecrets } from '../config.js';
import { ConfigurationError } from '../lib/errors.js';

const mockedFs = vi.mocked(fs);

beforeEach(() => {
  vi.clearAllMocks();
  mockedFs.existsSync.mockReturnValue(true);
});

describe('loadConfig validation', () => {
  it('loads a valid config', () => {
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        currentOrg: 'acme',
        organizations: {
          acme: { name: 'Acme Corp', graphqlEndpoint: 'https://api.acme.com/graphql' },
        },
      }),
    );
    const cfg = loadConfig();
    expect(cfg.currentOrg).toBe('acme');
    expect(cfg.organizations.acme.name).toBe('Acme Corp');
  });

  it('loads config with optional fields', () => {
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        currentOrg: 'acme',
        anthropicApiKey: 'sk-ant-test',
        model: 'claude-sonnet-4-20250514',
        organizations: {
          acme: {
            name: 'Acme',
            graphqlEndpoint: 'https://api.acme.com/graphql',
            adminSecret: 'secret',
            cliToken: 'token',
          },
        },
      }),
    );
    const cfg = loadConfig();
    expect(cfg.anthropicApiKey).toBe('sk-ant-test');
    expect(cfg.model).toBe('claude-sonnet-4-20250514');
  });

  it('throws ConfigurationError for missing currentOrg', () => {
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        organizations: { acme: { name: 'Acme', graphqlEndpoint: 'https://x.com' } },
      }),
    );
    expect(() => loadConfig()).toThrow(ConfigurationError);
    expect(() => loadConfig()).toThrow(/Invalid configuration/);
  });

  it('throws ConfigurationError for empty currentOrg', () => {
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        currentOrg: '',
        organizations: { acme: { name: 'Acme', graphqlEndpoint: 'https://x.com' } },
      }),
    );
    expect(() => loadConfig()).toThrow(ConfigurationError);
  });

  it('throws ConfigurationError for invalid model value', () => {
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        currentOrg: 'acme',
        model: 'gpt-4',
        organizations: { acme: { name: 'Acme', graphqlEndpoint: 'https://x.com' } },
      }),
    );
    expect(() => loadConfig()).toThrow(ConfigurationError);
  });

  it('throws ConfigurationError for malformed JSON', () => {
    mockedFs.readFileSync.mockReturnValue('not valid json {{{');
    expect(() => loadConfig()).toThrow(ConfigurationError);
    expect(() => loadConfig()).toThrow(/Invalid JSON/);
  });

  it('throws ConfigurationError when config file is missing', () => {
    mockedFs.existsSync.mockReturnValue(false);
    expect(() => loadConfig()).toThrow(ConfigurationError);
    expect(() => loadConfig()).toThrow(/No configuration found/);
  });

  it('throws for org with missing name', () => {
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        currentOrg: 'acme',
        organizations: { acme: { graphqlEndpoint: 'https://x.com' } },
      }),
    );
    expect(() => loadConfig()).toThrow(ConfigurationError);
  });

  it('throws for org with missing graphqlEndpoint', () => {
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        currentOrg: 'acme',
        organizations: { acme: { name: 'Acme' } },
      }),
    );
    expect(() => loadConfig()).toThrow(ConfigurationError);
  });

  it('accepts empty organizations object', () => {
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        currentOrg: 'acme',
        organizations: {},
      }),
    );
    const cfg = loadConfig();
    expect(cfg.organizations).toEqual({});
  });
});

describe('loadConfig fs error handling', () => {
  it('throws ConfigurationError when readFileSync fails', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });
    expect(() => loadConfig()).toThrow(ConfigurationError);
    expect(() => loadConfig()).toThrow(/Failed to read config file/);
  });
});

describe('saveConfig fs error handling', () => {
  it('throws ConfigurationError when writeFileSync fails', () => {
    mockedFs.writeFileSync.mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });
    expect(() =>
      saveConfig({
        currentOrg: 'acme',
        organizations: {
          acme: { name: 'Acme', graphqlEndpoint: 'https://x.com' },
        },
      }),
    ).toThrow(ConfigurationError);
    expect(() =>
      saveConfig({
        currentOrg: 'acme',
        organizations: {
          acme: { name: 'Acme', graphqlEndpoint: 'https://x.com' },
        },
      }),
    ).toThrow(/Failed to write config file/);
  });
});

describe('migrateConfigSecrets', () => {
  it('returns false when config file does not exist', () => {
    mockedFs.existsSync.mockReturnValue(false);
    expect(migrateConfigSecrets()).toBe(false);
  });

  it('returns false when config contains invalid JSON', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('not valid json');
    expect(migrateConfigSecrets()).toBe(false);
  });
});

describe('getConfigPath', () => {
  it('returns a string ending with config.json', () => {
    const p = getConfigPath();
    expect(p).toMatch(/config\.json$/);
  });
});
