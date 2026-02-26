import { describe, it, expect } from 'vitest';
import {
  listIntegrations,
  getIntegrationDefinition,
  getIntegrationSecretKeys,
} from '../integrations/registry.js';

describe('listIntegrations', () => {
  it('returns all 16 integration definitions', () => {
    const integrations = listIntegrations();
    expect(integrations).toHaveLength(16);
    const ids = integrations.map((i) => i.id);
    expect(ids).toContain('shopify');
    expect(ids).toContain('gorgias');
    expect(ids).toContain('zendesk');
    expect(ids).toContain('klaviyo');
    expect(ids).toContain('skio');
    expect(ids).toContain('stayai');
    expect(ids).toContain('amazon');
    expect(ids).toContain('dhl');
    expect(ids).toContain('globale');
    expect(ids).toContain('fedex');
  });

  it('returns a copy (mutations do not affect future calls)', () => {
    const first = listIntegrations();
    first.pop();
    const second = listIntegrations();
    expect(second).toHaveLength(16);
  });
});

describe('getIntegrationDefinition', () => {
  it('returns the Shopify definition with expected fields', () => {
    const def = getIntegrationDefinition('shopify');
    expect(def.id).toBe('shopify');
    expect(def.label).toBe('Shopify');
    expect(def.fields.length).toBeGreaterThan(0);
    expect(def.fields.some((f) => f.key === 'shop')).toBe(true);
  });

  it('returns the Klaviyo definition with apiKey marked secret', () => {
    const def = getIntegrationDefinition('klaviyo');
    const apiKeyField = def.fields.find((f) => f.key === 'apiKey');
    expect(apiKeyField).toBeDefined();
    expect(apiKeyField!.secret).toBe(true);
  });
});

describe('getIntegrationSecretKeys', () => {
  it('returns secret keys for shopify', () => {
    const secrets = getIntegrationSecretKeys('shopify');
    expect(secrets).toContain('accessToken');
    expect(secrets).not.toContain('shop');
  });

  it('returns secret keys for gorgias', () => {
    const secrets = getIntegrationSecretKeys('gorgias');
    expect(secrets).toContain('apiKey');
    expect(secrets).not.toContain('domain');
  });
});
