import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));
vi.mock('../session.js', () => ({ getStateSetDir: () => '/tmp/test-stateset' }));
vi.mock('../lib/secrets.js', () => ({
  decryptConfigSecrets: (cfg: Record<string, string>) => cfg,
  encryptConfigSecrets: (cfg: Record<string, string>) => cfg,
}));
vi.mock('../integrations/registry.js', () => ({
  getIntegrationSecretKeys: () => [],
}));

import fs from 'node:fs';
import {
  decryptStore,
  encryptStore,
  getIntegrationConfigFromStore,
  type IntegrationsStore,
} from '../integrations/store.js';

const mockedFs = vi.mocked(fs);

describe('integration store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('decryptStore', () => {
    it('returns empty integrations when given an empty store', () => {
      const store: IntegrationsStore = { version: 1, integrations: {} };
      expect(decryptStore(store).integrations).toEqual({});
    });

    it('preserves the version field', () => {
      const store: IntegrationsStore = { version: 3, integrations: {} };
      expect(decryptStore(store).version).toBe(3);
    });
  });

  describe('encryptStore', () => {
    it('returns empty integrations when given an empty store', () => {
      const store: IntegrationsStore = { version: 1, integrations: {} };
      expect(encryptStore(store).integrations).toEqual({});
    });
  });

  describe('encrypt/decrypt round-trip', () => {
    it('returns original data after encrypt then decrypt', () => {
      const store: IntegrationsStore = {
        version: 1,
        integrations: {
          shopify: { enabled: true, config: { api_key: 'sk_123', shop: 'myshop' } },
        },
      };
      expect(decryptStore(encryptStore(store))).toEqual(store);
    });
  });

  describe('getIntegrationConfigFromStore', () => {
    it('returns null when integration is not found', () => {
      expect(getIntegrationConfigFromStore('shopify' as any, '/tmp/test')).toBeNull();
    });

    it('returns null when integration is disabled', () => {
      const localPath = '/tmp/test/.stateset/integrations.json';
      mockedFs.existsSync.mockImplementation((p) => p === localPath);
      mockedFs.readFileSync.mockReturnValue(
        JSON.stringify({
          version: 1,
          integrations: { shopify: { enabled: false, config: { api_key: 'k' } } },
        }),
      );
      expect(getIntegrationConfigFromStore('shopify' as any, '/tmp/test')).toBeNull();
    });

    it('returns config when integration is enabled', () => {
      const localPath = '/tmp/test/.stateset/integrations.json';
      mockedFs.existsSync.mockImplementation((p) => p === localPath);
      mockedFs.readFileSync.mockReturnValue(
        JSON.stringify({
          version: 1,
          integrations: { shopify: { enabled: true, config: { api_key: 'sk_123' } } },
        }),
      );
      expect(getIntegrationConfigFromStore('shopify' as any, '/tmp/test')).toEqual({
        api_key: 'sk_123',
      });
    });
  });
});
