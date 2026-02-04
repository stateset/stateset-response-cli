export interface ShopifyConfig {
  shop: string;
  accessToken: string;
  apiVersion: string;
}

export interface GorgiasConfig {
  domain: string;
  apiKey: string;
  email: string;
}

export interface RechargeConfig {
  accessToken: string;
  apiVersion: string;
}

export interface KlaviyoConfig {
  apiKey: string;
  revision: string;
}

export interface LoopConfig {
  apiKey: string;
}

export interface ShipStationConfig {
  apiKey: string;
  apiSecret: string;
}

export interface ShipHeroConfig {
  accessToken: string;
}

export interface ShipFusionConfig {
  apiKey: string;
  clientId: string;
}

export interface ShipHawkConfig {
  apiKey: string;
}

export interface ZendeskConfig {
  subdomain: string;
  email: string;
  apiToken: string;
}

export interface IntegrationFlags {
  allowApply: boolean;
  redact: boolean;
}

function readFirstEnvVar(names: string[]): string | null {
  for (const name of names) {
    const v = process.env[name];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function parseBooleanEnv(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 'on';
}

function normalizeShopDomain(shop: string): string {
  let domain = String(shop).trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, '');
  domain = domain.split('/')[0];
  if (!domain.includes('.')) {
    domain = `${domain}.myshopify.com`;
  }
  return domain;
}

function validateAccessToken(token: string): string {
  const trimmed = String(token).trim();
  if (trimmed.length < 10) {
    throw new Error('Shopify access token appears too short. Check SHOPIFY_ACCESS_TOKEN.');
  }
  return trimmed;
}

export function getShopifyConfigFromEnv(): ShopifyConfig | null {
  const apiVersion =
    readFirstEnvVar(['SHOPIFY_API_VERSION', 'SHOPIFY_API_VER', 'STATESET_SHOPIFY_API_VERSION']) ||
    '2025-04';

  const rawShop =
    readFirstEnvVar([
      'SHOPIFY_SHOP_DOMAIN',
      'SHOPIFY_SHOP',
      'SHOPIFY_DOMAIN',
      'STATESET_SHOPIFY_SHOP_DOMAIN',
    ]);

  const rawToken =
    readFirstEnvVar([
      'SHOPIFY_ACCESS_TOKEN',
      'SHOPIFY_TOKEN',
      'SHOPIFY_ADMIN_ACCESS_TOKEN',
      'STATESET_SHOPIFY_ACCESS_TOKEN',
    ]);

  if (!rawShop && !rawToken) return null;
  if (!rawShop) throw new Error('Missing Shopify shop domain. Set SHOPIFY_SHOP_DOMAIN.');
  if (!rawToken) throw new Error('Missing Shopify access token. Set SHOPIFY_ACCESS_TOKEN.');

  const shop = normalizeShopDomain(rawShop);
  const accessToken = validateAccessToken(rawToken);

  return { shop, accessToken, apiVersion };
}

function normalizeGorgiasDomain(domain: string): string {
  let normalized = String(domain).trim().toLowerCase();
  normalized = normalized.replace(/^https?:\/\//, '');
  normalized = normalized.replace(/\.gorgias\.com$/, '');
  normalized = normalized.split('/')[0];
  return normalized;
}

export function getGorgiasConfigFromEnv(): GorgiasConfig | null {
  const rawDomain = readFirstEnvVar(['GORGIAS_DOMAIN', 'STATESET_GORGIAS_DOMAIN']);
  const apiKey = readFirstEnvVar(['GORGIAS_API_KEY', 'STATESET_GORGIAS_API_KEY']);
  const email = readFirstEnvVar(['GORGIAS_EMAIL', 'STATESET_GORGIAS_EMAIL']);

  if (!rawDomain && !apiKey && !email) return null;
  if (!rawDomain) throw new Error('Missing Gorgias domain. Set GORGIAS_DOMAIN.');
  if (!apiKey) throw new Error('Missing Gorgias API key. Set GORGIAS_API_KEY.');
  if (!email) throw new Error('Missing Gorgias email. Set GORGIAS_EMAIL.');

  return {
    domain: normalizeGorgiasDomain(rawDomain),
    apiKey,
    email,
  };
}

function validateRechargeToken(token: string): string {
  const trimmed = String(token).trim();
  if (trimmed.length < 10) {
    throw new Error('Recharge access token appears too short. Check RECHARGE_ACCESS_TOKEN.');
  }
  return trimmed;
}

export function getRechargeConfigFromEnv(): RechargeConfig | null {
  const apiVersion =
    readFirstEnvVar(['RECHARGE_API_VERSION', 'RECHARGE_API_VER', 'STATESET_RECHARGE_API_VERSION']) ||
    '2021-01';

  const rawToken =
    readFirstEnvVar([
      'RECHARGE_ACCESS_TOKEN',
      'RECHARGE_API_TOKEN',
      'RECHARGE_API_KEY',
      'STATESET_RECHARGE_ACCESS_TOKEN',
    ]);

  if (!rawToken) return null;

  const accessToken = validateRechargeToken(rawToken);

  return { accessToken, apiVersion };
}

function validateKlaviyoKey(key: string): string {
  const trimmed = String(key).trim();
  if (trimmed.length < 10) {
    throw new Error('Klaviyo API key appears too short. Check KLAVIYO_API_KEY.');
  }
  return trimmed;
}

function validateGenericKey(key: string, label: string, envName: string): string {
  const trimmed = String(key).trim();
  if (trimmed.length < 8) {
    throw new Error(`${label} appears too short. Check ${envName}.`);
  }
  return trimmed;
}

function normalizeZendeskSubdomain(input: string): string {
  let value = String(input).trim().toLowerCase();
  value = value.replace(/^https?:\/\//, '');
  value = value.replace(/\.zendesk\.com$/, '');
  value = value.split('/')[0];
  if (!value) {
    throw new Error('Zendesk subdomain is required. Set ZENDESK_SUBDOMAIN.');
  }
  return value;
}

export function getKlaviyoConfigFromEnv(): KlaviyoConfig | null {
  const revision =
    readFirstEnvVar(['KLAVIYO_REVISION', 'KLAVIYO_API_REVISION', 'STATESET_KLAVIYO_REVISION']) ||
    '2026-01-15';

  const rawKey =
    readFirstEnvVar([
      'KLAVIYO_PRIVATE_API_KEY',
      'KLAVIYO_API_KEY',
      'KLAVIYO_PRIVATE_KEY',
      'STATESET_KLAVIYO_API_KEY',
    ]);

  if (!rawKey) return null;

  const apiKey = validateKlaviyoKey(rawKey);

  return { apiKey, revision };
}

export function getLoopConfigFromEnv(): LoopConfig | null {
  const rawKey = readFirstEnvVar(['LOOP_API_KEY', 'STATESET_LOOP_API_KEY']);
  if (!rawKey) return null;
  const apiKey = validateGenericKey(rawKey, 'Loop API key', 'LOOP_API_KEY');
  return { apiKey };
}

export function getShipStationConfigFromEnv(): ShipStationConfig | null {
  const apiKey = readFirstEnvVar(['SHIPSTATION_API_KEY', 'STATESET_SHIPSTATION_API_KEY']);
  const apiSecret = readFirstEnvVar(['SHIPSTATION_API_SECRET', 'STATESET_SHIPSTATION_API_SECRET']);
  if (!apiKey && !apiSecret) return null;
  if (!apiKey) throw new Error('Missing ShipStation API key. Set SHIPSTATION_API_KEY.');
  if (!apiSecret) throw new Error('Missing ShipStation API secret. Set SHIPSTATION_API_SECRET.');
  return {
    apiKey: validateGenericKey(apiKey, 'ShipStation API key', 'SHIPSTATION_API_KEY'),
    apiSecret: validateGenericKey(apiSecret, 'ShipStation API secret', 'SHIPSTATION_API_SECRET'),
  };
}

export function getShipHeroConfigFromEnv(): ShipHeroConfig | null {
  const rawToken = readFirstEnvVar(['SHIPHERO_ACCESS_TOKEN', 'STATESET_SHIPHERO_ACCESS_TOKEN']);
  if (!rawToken) return null;
  const accessToken = validateGenericKey(rawToken, 'ShipHero access token', 'SHIPHERO_ACCESS_TOKEN');
  return { accessToken };
}

export function getShipFusionConfigFromEnv(): ShipFusionConfig | null {
  const apiKey = readFirstEnvVar(['SHIPFUSION_API_KEY', 'STATESET_SHIPFUSION_API_KEY']);
  const clientId = readFirstEnvVar(['SHIPFUSION_CLIENT_ID', 'STATESET_SHIPFUSION_CLIENT_ID']);
  if (!apiKey && !clientId) return null;
  if (!apiKey) throw new Error('Missing ShipFusion API key. Set SHIPFUSION_API_KEY.');
  if (!clientId) throw new Error('Missing ShipFusion client ID. Set SHIPFUSION_CLIENT_ID.');
  return {
    apiKey: validateGenericKey(apiKey, 'ShipFusion API key', 'SHIPFUSION_API_KEY'),
    clientId: validateGenericKey(clientId, 'ShipFusion client ID', 'SHIPFUSION_CLIENT_ID'),
  };
}

export function getShipHawkConfigFromEnv(): ShipHawkConfig | null {
  const rawKey = readFirstEnvVar(['SHIPHAWK_API_KEY', 'STATESET_SHIPHAWK_API_KEY']);
  if (!rawKey) return null;
  const apiKey = validateGenericKey(rawKey, 'ShipHawk API key', 'SHIPHAWK_API_KEY');
  return { apiKey };
}

export function getZendeskConfigFromEnv(): ZendeskConfig | null {
  const rawSubdomain = readFirstEnvVar(['ZENDESK_SUBDOMAIN', 'STATESET_ZENDESK_SUBDOMAIN']);
  const email = readFirstEnvVar(['ZENDESK_EMAIL', 'STATESET_ZENDESK_EMAIL']);
  const apiToken = readFirstEnvVar(['ZENDESK_API_TOKEN', 'STATESET_ZENDESK_API_TOKEN']);

  if (!rawSubdomain && !email && !apiToken) return null;
  if (!rawSubdomain) throw new Error('Missing Zendesk subdomain. Set ZENDESK_SUBDOMAIN.');
  if (!email) throw new Error('Missing Zendesk email. Set ZENDESK_EMAIL.');
  if (!apiToken) throw new Error('Missing Zendesk API token. Set ZENDESK_API_TOKEN.');

  return {
    subdomain: normalizeZendeskSubdomain(rawSubdomain),
    email,
    apiToken: validateGenericKey(apiToken, 'Zendesk API token', 'ZENDESK_API_TOKEN'),
  };
}

export function getIntegrationFlagsFromEnv(): IntegrationFlags {
  const allowApply = parseBooleanEnv(
    readFirstEnvVar(['STATESET_ALLOW_APPLY', 'RESPONSE_ALLOW_APPLY', 'ALLOW_APPLY'])
  );
  const redact = parseBooleanEnv(
    readFirstEnvVar(['STATESET_REDACT', 'RESPONSE_REDACT', 'REDACT_PII'])
  );

  return { allowApply, redact };
}
