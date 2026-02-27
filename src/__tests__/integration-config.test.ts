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

describe('getSkioConfigFromEnv', () => {
  const env = mockEnv();

  it('returns null when no env vars set', async () => {
    const { getSkioConfigFromEnv } = await import('../integrations/config.js');
    const result = getSkioConfigFromEnv();
    expect(result).toBeNull();
  });

  it('returns config when API key set', async () => {
    env.set('SKIO_API_KEY', 'skio-key-123456');
    const { getSkioConfigFromEnv } = await import('../integrations/config.js');
    const result = getSkioConfigFromEnv();
    expect(result).not.toBeNull();
    expect(result?.apiKey).toBe('skio-key-123456');
    expect(result?.baseUrl).toBe('https://api.skio.com/v1');
  });

  it('rejects unsafe private SKIO base URLs', async () => {
    env.set('SKIO_API_KEY', 'skio-key-123456');
    env.set('SKIO_BASE_URL', 'http://127.0.0.2:8080');
    const { getSkioConfigFromEnv } = await import('../integrations/config.js');
    expect(() => getSkioConfigFromEnv()).toThrow('Invalid or unsafe URL for SKIO_BASE_URL');
  });
});

describe('getStayAiConfigFromEnv', () => {
  const env = mockEnv();

  it('returns null when no env vars set', async () => {
    const { getStayAiConfigFromEnv } = await import('../integrations/config.js');
    const result = getStayAiConfigFromEnv();
    expect(result).toBeNull();
  });

  it('returns config when API key set', async () => {
    env.set('STAYAI_API_KEY', 'stayai-key-123456');
    const { getStayAiConfigFromEnv } = await import('../integrations/config.js');
    const result = getStayAiConfigFromEnv();
    expect(result).not.toBeNull();
    expect(result?.apiKey).toBe('stayai-key-123456');
    expect(result?.baseUrl).toBe('https://api.stay.ai/v1');
  });
});

describe('getAmazonConfigFromEnv', () => {
  const env = mockEnv();

  it('returns null when no env vars set', async () => {
    const { getAmazonConfigFromEnv } = await import('../integrations/config.js');
    const result = getAmazonConfigFromEnv();
    expect(result).toBeNull();
  });

  it('returns config when required env vars are set', async () => {
    env.set('AMAZON_LWA_CLIENT_ID', 'amzn-client-id-123456');
    env.set('AMAZON_LWA_CLIENT_SECRET', 'amzn-client-secret-123456');
    env.set('AMAZON_LWA_REFRESH_TOKEN', 'amzn-refresh-token-123456');
    env.set('AMAZON_AWS_ACCESS_KEY_ID', 'AKIAIOSFODNN7EXAMPLE');
    env.set('AMAZON_AWS_SECRET_ACCESS_KEY', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
    env.set('AMAZON_SP_MARKETPLACE_ID', 'ATVPDKIKX0DER');
    const { getAmazonConfigFromEnv } = await import('../integrations/config.js');
    const result = getAmazonConfigFromEnv();
    expect(result).not.toBeNull();
    expect(result?.awsRegion).toBe('us-east-1');
    expect(result?.endpoint).toBe('https://sellingpartnerapi-na.amazon.com');
    expect(result?.marketplaceId).toBe('ATVPDKIKX0DER');
  });
});

describe('getDhlConfigFromEnv', () => {
  const env = mockEnv();

  it('returns null when no env vars set', async () => {
    const { getDhlConfigFromEnv } = await import('../integrations/config.js');
    const result = getDhlConfigFromEnv();
    expect(result).toBeNull();
  });

  it('returns config when API key set', async () => {
    env.set('DHL_API_KEY', 'dhl-key-123456');
    const { getDhlConfigFromEnv } = await import('../integrations/config.js');
    const result = getDhlConfigFromEnv();
    expect(result).not.toBeNull();
    expect(result?.apiKey).toBe('dhl-key-123456');
    expect(result?.baseUrl).toBe('https://api-m.dhl.com');
  });
});

describe('getGlobalEConfigFromEnv', () => {
  const env = mockEnv();

  it('returns null when no env vars set', async () => {
    const { getGlobalEConfigFromEnv } = await import('../integrations/config.js');
    const result = getGlobalEConfigFromEnv();
    expect(result).toBeNull();
  });

  it('returns config when merchant id and api key set', async () => {
    env.set('GLOBALE_MERCHANT_ID', 'merchant-123');
    env.set('GLOBALE_API_KEY', 'globale-key-123456');
    const { getGlobalEConfigFromEnv } = await import('../integrations/config.js');
    const result = getGlobalEConfigFromEnv();
    expect(result).not.toBeNull();
    expect(result?.merchantId).toBe('merchant-123');
    expect(result?.apiKey).toBe('globale-key-123456');
    expect(result?.baseUrl).toBe('https://api.global-e.com');
  });
});

describe('getFedExConfigFromEnv', () => {
  const env = mockEnv();

  it('returns null when no env vars set', async () => {
    const { getFedExConfigFromEnv } = await import('../integrations/config.js');
    const result = getFedExConfigFromEnv();
    expect(result).toBeNull();
  });

  it('returns config when client credentials set', async () => {
    env.set('FEDEX_CLIENT_ID', 'fedex-client-123456');
    env.set('FEDEX_CLIENT_SECRET', 'fedex-secret-123456');
    const { getFedExConfigFromEnv } = await import('../integrations/config.js');
    const result = getFedExConfigFromEnv();
    expect(result).not.toBeNull();
    expect(result?.clientId).toBe('fedex-client-123456');
    expect(result?.locale).toBe('en_US');
    expect(result?.baseUrl).toBe('https://apis.fedex.com');
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
