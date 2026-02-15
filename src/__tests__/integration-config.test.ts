import { describe, it, expect } from 'vitest';
import { mockEnv } from './helpers/mocks.js';

describe('getIntegrationFlagsFromEnv', () => {
  const env = mockEnv();

  it('returns both false by default', async () => {
    const { getIntegrationFlagsFromEnv } = await import('../integrations/config.js');
    const flags = getIntegrationFlagsFromEnv();
    expect(flags.allowApply).toBe(false);
    expect(flags.redact).toBe(false);
  });

  it('reads STATESET_ALLOW_APPLY', async () => {
    env.set('STATESET_ALLOW_APPLY', 'true');
    const { getIntegrationFlagsFromEnv } = await import('../integrations/config.js');
    const flags = getIntegrationFlagsFromEnv();
    expect(flags.allowApply).toBe(true);
  });

  it('reads STATESET_REDACT', async () => {
    env.set('STATESET_REDACT', '1');
    const { getIntegrationFlagsFromEnv } = await import('../integrations/config.js');
    const flags = getIntegrationFlagsFromEnv();
    expect(flags.redact).toBe(true);
  });
});

describe('getShopifyConfigFromEnv', () => {
  const env = mockEnv();

  it('returns null when no env vars set', async () => {
    const { getShopifyConfigFromEnv } = await import('../integrations/config.js');
    const result = getShopifyConfigFromEnv();
    expect(result).toBeNull();
  });

  it('returns config when all required env vars set', async () => {
    env.set('SHOPIFY_SHOP', 'my-shop.myshopify.com');
    env.set('SHOPIFY_ACCESS_TOKEN', 'shpat_1234567890abcdef');
    const { getShopifyConfigFromEnv } = await import('../integrations/config.js');
    const result = getShopifyConfigFromEnv();
    expect(result).not.toBeNull();
    expect(result?.shop).toBe('my-shop.myshopify.com');
    expect(result?.accessToken).toBe('shpat_1234567890abcdef');
  });
});

describe('getGorgiasConfigFromEnv', () => {
  const env = mockEnv();

  it('returns null when no env vars set', async () => {
    const { getGorgiasConfigFromEnv } = await import('../integrations/config.js');
    const result = getGorgiasConfigFromEnv();
    expect(result).toBeNull();
  });

  it('returns config when all required env vars set', async () => {
    env.set('GORGIAS_DOMAIN', 'test.gorgias.com');
    env.set('GORGIAS_EMAIL', 'admin@test.com');
    env.set('GORGIAS_API_KEY', 'gorgias-key-123');
    const { getGorgiasConfigFromEnv } = await import('../integrations/config.js');
    const result = getGorgiasConfigFromEnv();
    expect(result).not.toBeNull();
    expect(result?.domain).toBe('test');
  });
});

describe('getKlaviyoConfigFromEnv', () => {
  const env = mockEnv();

  it('returns null when no env vars set', async () => {
    const { getKlaviyoConfigFromEnv } = await import('../integrations/config.js');
    const result = getKlaviyoConfigFromEnv();
    expect(result).toBeNull();
  });

  it('returns config when API key set', async () => {
    env.set('KLAVIYO_API_KEY', 'pk_abc123456789');
    const { getKlaviyoConfigFromEnv } = await import('../integrations/config.js');
    const result = getKlaviyoConfigFromEnv();
    expect(result).not.toBeNull();
    expect(result?.apiKey).toBe('pk_abc123456789');
  });
});

describe('getZendeskConfigFromEnv', () => {
  const env = mockEnv();

  it('returns null when no env vars set', async () => {
    const { getZendeskConfigFromEnv } = await import('../integrations/config.js');
    const result = getZendeskConfigFromEnv();
    expect(result).toBeNull();
  });

  it('returns config when required env vars set', async () => {
    env.set('ZENDESK_SUBDOMAIN', 'mycompany');
    env.set('ZENDESK_EMAIL', 'admin@mycompany.com');
    env.set('ZENDESK_API_TOKEN', 'zen-token-123');
    const { getZendeskConfigFromEnv } = await import('../integrations/config.js');
    const result = getZendeskConfigFromEnv();
    expect(result).not.toBeNull();
    expect(result?.subdomain).toBe('mycompany');
  });
});
