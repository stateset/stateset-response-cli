import { getIntegrationConfigFromStore } from './store.js';
import { KLAVIYO_DEFAULT_REVISION, type IntegrationId } from './registry.js';
import { safeUrlSchema } from '../lib/validation.js';

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

export interface SkioConfig {
  apiKey: string;
  baseUrl: string;
  apiVersion: string;
}

export interface StayAiConfig {
  apiKey: string;
  baseUrl: string;
  apiVersion: string;
}

export interface AmazonConfig {
  lwaClientId: string;
  lwaClientSecret: string;
  lwaRefreshToken: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  awsSessionToken?: string;
  awsRegion: string;
  endpoint: string;
  marketplaceId?: string;
}

export interface DhlConfig {
  apiKey: string;
  accessToken?: string;
  accountNumber?: string;
  baseUrl: string;
}

export interface GlobalEConfig {
  merchantId: string;
  apiKey: string;
  channel?: string;
  baseUrl: string;
}

export interface FedExConfig {
  clientId: string;
  clientSecret: string;
  accountNumber?: string;
  locale: string;
  baseUrl: string;
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

/**
 * Load a stored integration config and validate that all required fields are present.
 * Returns null if no config is stored. Throws if stored but missing required fields.
 */
function loadStoredConfig(
  id: IntegrationId,
  requiredFields: string[],
  label: string,
): Record<string, string | undefined> | null {
  const stored = getIntegrationConfigFromStore(id);
  if (!stored) return null;
  for (const field of requiredFields) {
    if (!stored[field]) {
      throw new Error(
        `Missing ${label} ${field} in integrations config. Run "response integrations setup".`,
      );
    }
  }
  return stored;
}

function normalizeApiBaseUrl(value: string, envName: string): string {
  const normalized = String(value || '')
    .trim()
    .replace(/\/$/, '');
  if (!normalized) {
    throw new Error(`API base URL is required. Check ${envName}.`);
  }
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error(`API base URL must include http(s) protocol. Check ${envName}.`);
  }
  // Require a public HTTP(S) endpoint to reduce SSRF risk.
  const parsed = safeUrlSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new Error(`Invalid or unsafe URL for ${envName}: "${normalized}".`);
  }
  return normalized;
}

function defaultAmazonEndpointForRegion(region: string): string {
  switch (region.trim().toLowerCase()) {
    case 'eu-west-1':
      return 'https://sellingpartnerapi-eu.amazon.com';
    case 'us-west-2':
      return 'https://sellingpartnerapi-fe.amazon.com';
    case 'us-east-1':
    default:
      return 'https://sellingpartnerapi-na.amazon.com';
  }
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

  const rawShop = readFirstEnvVar([
    'SHOPIFY_SHOP_DOMAIN',
    'SHOPIFY_SHOP',
    'SHOPIFY_DOMAIN',
    'STATESET_SHOPIFY_SHOP_DOMAIN',
  ]);

  const rawToken = readFirstEnvVar([
    'SHOPIFY_ACCESS_TOKEN',
    'SHOPIFY_TOKEN',
    'SHOPIFY_ADMIN_ACCESS_TOKEN',
    'STATESET_SHOPIFY_ACCESS_TOKEN',
  ]);

  if (rawShop || rawToken) {
    if (!rawShop) throw new Error('Missing Shopify shop domain. Set SHOPIFY_SHOP_DOMAIN.');
    if (!rawToken) throw new Error('Missing Shopify access token. Set SHOPIFY_ACCESS_TOKEN.');

    const shop = normalizeShopDomain(rawShop);
    const accessToken = validateAccessToken(rawToken);

    return { shop, accessToken, apiVersion };
  }

  const stored = loadStoredConfig('shopify', ['shop', 'accessToken'], 'Shopify');
  if (!stored) return null;
  return {
    shop: normalizeShopDomain(stored.shop!),
    accessToken: validateAccessToken(stored.accessToken!),
    apiVersion: stored.apiVersion || apiVersion,
  };
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

  if (rawDomain || apiKey || email) {
    if (!rawDomain) throw new Error('Missing Gorgias domain. Set GORGIAS_DOMAIN.');
    if (!apiKey) throw new Error('Missing Gorgias API key. Set GORGIAS_API_KEY.');
    if (!email) throw new Error('Missing Gorgias email. Set GORGIAS_EMAIL.');

    return {
      domain: normalizeGorgiasDomain(rawDomain),
      apiKey,
      email,
    };
  }

  const stored = loadStoredConfig('gorgias', ['domain', 'apiKey', 'email'], 'Gorgias');
  if (!stored) return null;
  return {
    domain: normalizeGorgiasDomain(stored.domain!),
    apiKey: stored.apiKey!,
    email: stored.email!,
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
    readFirstEnvVar([
      'RECHARGE_API_VERSION',
      'RECHARGE_API_VER',
      'STATESET_RECHARGE_API_VERSION',
    ]) || '2021-01';

  const rawToken = readFirstEnvVar([
    'RECHARGE_ACCESS_TOKEN',
    'RECHARGE_API_TOKEN',
    'RECHARGE_API_KEY',
    'STATESET_RECHARGE_ACCESS_TOKEN',
  ]);

  if (rawToken) {
    const accessToken = validateRechargeToken(rawToken);
    return { accessToken, apiVersion };
  }

  const stored = loadStoredConfig('recharge', ['accessToken'], 'Recharge');
  if (!stored) return null;
  return {
    accessToken: validateRechargeToken(stored.accessToken!),
    apiVersion: stored.apiVersion || apiVersion,
  };
}

export function getSkioConfigFromEnv(): SkioConfig | null {
  const defaultBaseUrl = 'https://api.skio.com/v1';
  const apiVersion =
    readFirstEnvVar(['SKIO_API_VERSION', 'STATESET_SKIO_API_VERSION']) || '2024-01';
  const apiKey = readFirstEnvVar(['SKIO_API_KEY', 'STATESET_SKIO_API_KEY']);
  const baseUrl = readFirstEnvVar(['SKIO_BASE_URL', 'STATESET_SKIO_BASE_URL']) || defaultBaseUrl;

  if (apiKey || process.env.SKIO_BASE_URL || process.env.STATESET_SKIO_BASE_URL) {
    if (!apiKey) throw new Error('Missing Skio API key. Set SKIO_API_KEY.');
    return {
      apiKey: validateGenericKey(apiKey, 'Skio API key', 'SKIO_API_KEY'),
      baseUrl: normalizeApiBaseUrl(baseUrl, 'SKIO_BASE_URL'),
      apiVersion,
    };
  }

  const stored = loadStoredConfig('skio', ['apiKey'], 'Skio');
  if (!stored) return null;
  return {
    apiKey: validateGenericKey(stored.apiKey!, 'Skio API key', 'SKIO_API_KEY'),
    baseUrl: normalizeApiBaseUrl(stored.baseUrl || defaultBaseUrl, 'SKIO_BASE_URL'),
    apiVersion: stored.apiVersion || apiVersion,
  };
}

export function getStayAiConfigFromEnv(): StayAiConfig | null {
  const defaultBaseUrl = 'https://api.stay.ai/v1';
  const apiVersion =
    readFirstEnvVar(['STAYAI_API_VERSION', 'STAY_AI_API_VERSION', 'STATESET_STAYAI_API_VERSION']) ||
    '2024-01';
  const apiKey = readFirstEnvVar(['STAYAI_API_KEY', 'STAY_AI_API_KEY', 'STATESET_STAYAI_API_KEY']);
  const baseUrl =
    readFirstEnvVar(['STAYAI_BASE_URL', 'STAY_AI_BASE_URL', 'STATESET_STAYAI_BASE_URL']) ||
    defaultBaseUrl;

  if (
    apiKey ||
    process.env.STAYAI_BASE_URL ||
    process.env.STAY_AI_BASE_URL ||
    process.env.STATESET_STAYAI_BASE_URL
  ) {
    if (!apiKey) throw new Error('Missing Stay.ai API key. Set STAYAI_API_KEY.');
    return {
      apiKey: validateGenericKey(apiKey, 'Stay.ai API key', 'STAYAI_API_KEY'),
      baseUrl: normalizeApiBaseUrl(baseUrl, 'STAYAI_BASE_URL'),
      apiVersion,
    };
  }

  const stored = loadStoredConfig('stayai', ['apiKey'], 'Stay.ai');
  if (!stored) return null;
  return {
    apiKey: validateGenericKey(stored.apiKey!, 'Stay.ai API key', 'STAYAI_API_KEY'),
    baseUrl: normalizeApiBaseUrl(stored.baseUrl || defaultBaseUrl, 'STAYAI_BASE_URL'),
    apiVersion: stored.apiVersion || apiVersion,
  };
}

export function getAmazonConfigFromEnv(): AmazonConfig | null {
  const awsRegion =
    readFirstEnvVar(['AMAZON_SP_API_REGION', 'STATESET_AMAZON_SP_API_REGION']) || 'us-east-1';
  const defaultEndpoint = defaultAmazonEndpointForRegion(awsRegion);

  const endpoint =
    readFirstEnvVar(['AMAZON_SP_API_ENDPOINT', 'STATESET_AMAZON_SP_API_ENDPOINT']) ||
    defaultEndpoint;
  const lwaClientId = readFirstEnvVar(['AMAZON_LWA_CLIENT_ID', 'STATESET_AMAZON_LWA_CLIENT_ID']);
  const lwaClientSecret = readFirstEnvVar([
    'AMAZON_LWA_CLIENT_SECRET',
    'STATESET_AMAZON_LWA_CLIENT_SECRET',
  ]);
  const lwaRefreshToken = readFirstEnvVar([
    'AMAZON_LWA_REFRESH_TOKEN',
    'STATESET_AMAZON_LWA_REFRESH_TOKEN',
  ]);
  const awsAccessKeyId = readFirstEnvVar([
    'AMAZON_AWS_ACCESS_KEY_ID',
    'STATESET_AMAZON_AWS_ACCESS_KEY_ID',
  ]);
  const awsSecretAccessKey = readFirstEnvVar([
    'AMAZON_AWS_SECRET_ACCESS_KEY',
    'STATESET_AMAZON_AWS_SECRET_ACCESS_KEY',
  ]);
  const awsSessionToken = readFirstEnvVar([
    'AMAZON_AWS_SESSION_TOKEN',
    'STATESET_AMAZON_AWS_SESSION_TOKEN',
  ]);
  const marketplaceId = readFirstEnvVar([
    'AMAZON_SP_MARKETPLACE_ID',
    'STATESET_AMAZON_SP_MARKETPLACE_ID',
  ]);

  if (
    lwaClientId ||
    lwaClientSecret ||
    lwaRefreshToken ||
    awsAccessKeyId ||
    awsSecretAccessKey ||
    awsSessionToken ||
    process.env.AMAZON_SP_API_ENDPOINT ||
    process.env.STATESET_AMAZON_SP_API_ENDPOINT ||
    process.env.AMAZON_SP_API_REGION ||
    process.env.STATESET_AMAZON_SP_API_REGION
  ) {
    if (!lwaClientId) throw new Error('Missing Amazon LWA client ID. Set AMAZON_LWA_CLIENT_ID.');
    if (!lwaClientSecret)
      throw new Error('Missing Amazon LWA client secret. Set AMAZON_LWA_CLIENT_SECRET.');
    if (!lwaRefreshToken)
      throw new Error('Missing Amazon LWA refresh token. Set AMAZON_LWA_REFRESH_TOKEN.');
    if (!awsAccessKeyId)
      throw new Error('Missing Amazon AWS access key ID. Set AMAZON_AWS_ACCESS_KEY_ID.');
    if (!awsSecretAccessKey)
      throw new Error('Missing Amazon AWS secret access key. Set AMAZON_AWS_SECRET_ACCESS_KEY.');

    return {
      lwaClientId: validateGenericKey(lwaClientId, 'Amazon LWA client ID', 'AMAZON_LWA_CLIENT_ID'),
      lwaClientSecret: validateGenericKey(
        lwaClientSecret,
        'Amazon LWA client secret',
        'AMAZON_LWA_CLIENT_SECRET',
      ),
      lwaRefreshToken: validateGenericKey(
        lwaRefreshToken,
        'Amazon LWA refresh token',
        'AMAZON_LWA_REFRESH_TOKEN',
      ),
      awsAccessKeyId: validateGenericKey(
        awsAccessKeyId,
        'Amazon AWS access key ID',
        'AMAZON_AWS_ACCESS_KEY_ID',
      ),
      awsSecretAccessKey: validateGenericKey(
        awsSecretAccessKey,
        'Amazon AWS secret access key',
        'AMAZON_AWS_SECRET_ACCESS_KEY',
      ),
      awsSessionToken: awsSessionToken ? awsSessionToken.trim() : undefined,
      awsRegion: awsRegion.trim(),
      endpoint: normalizeApiBaseUrl(endpoint, 'AMAZON_SP_API_ENDPOINT'),
      marketplaceId: marketplaceId ? marketplaceId.trim() : undefined,
    };
  }

  const stored = loadStoredConfig(
    'amazon',
    ['lwaClientId', 'lwaClientSecret', 'lwaRefreshToken', 'awsAccessKeyId', 'awsSecretAccessKey'],
    'Amazon',
  );
  if (!stored) return null;

  const storedRegion = stored.awsRegion || awsRegion;
  const storedEndpoint = stored.endpoint || defaultAmazonEndpointForRegion(storedRegion);
  return {
    lwaClientId: validateGenericKey(
      stored.lwaClientId!,
      'Amazon LWA client ID',
      'AMAZON_LWA_CLIENT_ID',
    ),
    lwaClientSecret: validateGenericKey(
      stored.lwaClientSecret!,
      'Amazon LWA client secret',
      'AMAZON_LWA_CLIENT_SECRET',
    ),
    lwaRefreshToken: validateGenericKey(
      stored.lwaRefreshToken!,
      'Amazon LWA refresh token',
      'AMAZON_LWA_REFRESH_TOKEN',
    ),
    awsAccessKeyId: validateGenericKey(
      stored.awsAccessKeyId!,
      'Amazon AWS access key ID',
      'AMAZON_AWS_ACCESS_KEY_ID',
    ),
    awsSecretAccessKey: validateGenericKey(
      stored.awsSecretAccessKey!,
      'Amazon AWS secret access key',
      'AMAZON_AWS_SECRET_ACCESS_KEY',
    ),
    awsSessionToken: stored.awsSessionToken || undefined,
    awsRegion: storedRegion,
    endpoint: normalizeApiBaseUrl(storedEndpoint, 'AMAZON_SP_API_ENDPOINT'),
    marketplaceId: stored.marketplaceId || undefined,
  };
}

export function getDhlConfigFromEnv(): DhlConfig | null {
  const defaultBaseUrl = 'https://api-m.dhl.com';
  const apiKey = readFirstEnvVar(['DHL_API_KEY', 'STATESET_DHL_API_KEY']);
  const accessToken = readFirstEnvVar(['DHL_ACCESS_TOKEN', 'STATESET_DHL_ACCESS_TOKEN']);
  const accountNumber = readFirstEnvVar(['DHL_ACCOUNT_NUMBER', 'STATESET_DHL_ACCOUNT_NUMBER']);
  const baseUrl = readFirstEnvVar(['DHL_BASE_URL', 'STATESET_DHL_BASE_URL']) || defaultBaseUrl;

  if (
    apiKey ||
    accessToken ||
    accountNumber ||
    process.env.DHL_BASE_URL ||
    process.env.STATESET_DHL_BASE_URL
  ) {
    if (!apiKey) throw new Error('Missing DHL API key. Set DHL_API_KEY.');
    return {
      apiKey: validateGenericKey(apiKey, 'DHL API key', 'DHL_API_KEY'),
      accessToken: accessToken || undefined,
      accountNumber: accountNumber || undefined,
      baseUrl: normalizeApiBaseUrl(baseUrl, 'DHL_BASE_URL'),
    };
  }

  const stored = loadStoredConfig('dhl', ['apiKey'], 'DHL');
  if (!stored) return null;
  return {
    apiKey: validateGenericKey(stored.apiKey!, 'DHL API key', 'DHL_API_KEY'),
    accessToken: stored.accessToken || undefined,
    accountNumber: stored.accountNumber || undefined,
    baseUrl: normalizeApiBaseUrl(stored.baseUrl || defaultBaseUrl, 'DHL_BASE_URL'),
  };
}

export function getGlobalEConfigFromEnv(): GlobalEConfig | null {
  const defaultBaseUrl = 'https://api.global-e.com';
  const merchantId = readFirstEnvVar([
    'GLOBALE_MERCHANT_ID',
    'GLOBAL_E_MERCHANT_ID',
    'STATESET_GLOBALE_MERCHANT_ID',
  ]);
  const apiKey = readFirstEnvVar([
    'GLOBALE_API_KEY',
    'GLOBAL_E_API_KEY',
    'STATESET_GLOBALE_API_KEY',
  ]);
  const channel = readFirstEnvVar([
    'GLOBALE_CHANNEL',
    'GLOBAL_E_CHANNEL',
    'STATESET_GLOBALE_CHANNEL',
  ]);
  const baseUrl =
    readFirstEnvVar(['GLOBALE_BASE_URL', 'GLOBAL_E_BASE_URL', 'STATESET_GLOBALE_BASE_URL']) ||
    defaultBaseUrl;

  if (
    merchantId ||
    apiKey ||
    channel ||
    process.env.GLOBALE_BASE_URL ||
    process.env.GLOBAL_E_BASE_URL ||
    process.env.STATESET_GLOBALE_BASE_URL
  ) {
    if (!merchantId) throw new Error('Missing Global-e merchant ID. Set GLOBALE_MERCHANT_ID.');
    if (!apiKey) throw new Error('Missing Global-e API key. Set GLOBALE_API_KEY.');
    return {
      merchantId: validateGenericKey(merchantId, 'Global-e merchant ID', 'GLOBALE_MERCHANT_ID'),
      apiKey: validateGenericKey(apiKey, 'Global-e API key', 'GLOBALE_API_KEY'),
      channel: channel || undefined,
      baseUrl: normalizeApiBaseUrl(baseUrl, 'GLOBALE_BASE_URL'),
    };
  }

  const stored = loadStoredConfig('globale', ['merchantId', 'apiKey'], 'Global-e');
  if (!stored) return null;
  return {
    merchantId: validateGenericKey(
      stored.merchantId!,
      'Global-e merchant ID',
      'GLOBALE_MERCHANT_ID',
    ),
    apiKey: validateGenericKey(stored.apiKey!, 'Global-e API key', 'GLOBALE_API_KEY'),
    channel: stored.channel || undefined,
    baseUrl: normalizeApiBaseUrl(stored.baseUrl || defaultBaseUrl, 'GLOBALE_BASE_URL'),
  };
}

export function getFedExConfigFromEnv(): FedExConfig | null {
  const defaultBaseUrl = 'https://apis.fedex.com';
  const clientId = readFirstEnvVar(['FEDEX_CLIENT_ID', 'STATESET_FEDEX_CLIENT_ID']);
  const clientSecret = readFirstEnvVar(['FEDEX_CLIENT_SECRET', 'STATESET_FEDEX_CLIENT_SECRET']);
  const accountNumber = readFirstEnvVar(['FEDEX_ACCOUNT_NUMBER', 'STATESET_FEDEX_ACCOUNT_NUMBER']);
  const locale = readFirstEnvVar(['FEDEX_LOCALE', 'STATESET_FEDEX_LOCALE']) || 'en_US';
  const baseUrl = readFirstEnvVar(['FEDEX_BASE_URL', 'STATESET_FEDEX_BASE_URL']) || defaultBaseUrl;

  if (
    clientId ||
    clientSecret ||
    accountNumber ||
    process.env.FEDEX_BASE_URL ||
    process.env.STATESET_FEDEX_BASE_URL
  ) {
    if (!clientId) throw new Error('Missing FedEx client ID. Set FEDEX_CLIENT_ID.');
    if (!clientSecret) throw new Error('Missing FedEx client secret. Set FEDEX_CLIENT_SECRET.');
    return {
      clientId: validateGenericKey(clientId, 'FedEx client ID', 'FEDEX_CLIENT_ID'),
      clientSecret: validateGenericKey(clientSecret, 'FedEx client secret', 'FEDEX_CLIENT_SECRET'),
      accountNumber: accountNumber || undefined,
      locale: locale.trim() || 'en_US',
      baseUrl: normalizeApiBaseUrl(baseUrl, 'FEDEX_BASE_URL'),
    };
  }

  const stored = loadStoredConfig('fedex', ['clientId', 'clientSecret'], 'FedEx');
  if (!stored) return null;
  return {
    clientId: validateGenericKey(stored.clientId!, 'FedEx client ID', 'FEDEX_CLIENT_ID'),
    clientSecret: validateGenericKey(
      stored.clientSecret!,
      'FedEx client secret',
      'FEDEX_CLIENT_SECRET',
    ),
    accountNumber: stored.accountNumber || undefined,
    locale: (stored.locale || 'en_US').trim() || 'en_US',
    baseUrl: normalizeApiBaseUrl(stored.baseUrl || defaultBaseUrl, 'FEDEX_BASE_URL'),
  };
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
  // Reject subdomains containing characters that could enable URL injection.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(value)) {
    throw new Error(
      `Invalid Zendesk subdomain: "${value}". Must contain only letters, numbers, and hyphens.`,
    );
  }
  return value;
}

export function getKlaviyoConfigFromEnv(): KlaviyoConfig | null {
  const revision =
    readFirstEnvVar(['KLAVIYO_REVISION', 'KLAVIYO_API_REVISION', 'STATESET_KLAVIYO_REVISION']) ||
    KLAVIYO_DEFAULT_REVISION;

  const rawKey = readFirstEnvVar([
    'KLAVIYO_PRIVATE_API_KEY',
    'KLAVIYO_API_KEY',
    'KLAVIYO_PRIVATE_KEY',
    'STATESET_KLAVIYO_API_KEY',
  ]);

  if (rawKey) {
    const apiKey = validateKlaviyoKey(rawKey);
    return { apiKey, revision };
  }

  const stored = loadStoredConfig('klaviyo', ['apiKey'], 'Klaviyo');
  if (!stored) return null;
  return { apiKey: validateKlaviyoKey(stored.apiKey!), revision: stored.revision || revision };
}

export function getLoopConfigFromEnv(): LoopConfig | null {
  const rawKey = readFirstEnvVar(['LOOP_API_KEY', 'STATESET_LOOP_API_KEY']);
  if (rawKey) {
    return { apiKey: validateGenericKey(rawKey, 'Loop API key', 'LOOP_API_KEY') };
  }

  const stored = loadStoredConfig('loop', ['apiKey'], 'Loop');
  if (!stored) return null;
  return { apiKey: validateGenericKey(stored.apiKey!, 'Loop API key', 'LOOP_API_KEY') };
}

export function getShipStationConfigFromEnv(): ShipStationConfig | null {
  const apiKey = readFirstEnvVar(['SHIPSTATION_API_KEY', 'STATESET_SHIPSTATION_API_KEY']);
  const apiSecret = readFirstEnvVar(['SHIPSTATION_API_SECRET', 'STATESET_SHIPSTATION_API_SECRET']);
  if (apiKey || apiSecret) {
    if (!apiKey) throw new Error('Missing ShipStation API key. Set SHIPSTATION_API_KEY.');
    if (!apiSecret) throw new Error('Missing ShipStation API secret. Set SHIPSTATION_API_SECRET.');
    return {
      apiKey: validateGenericKey(apiKey, 'ShipStation API key', 'SHIPSTATION_API_KEY'),
      apiSecret: validateGenericKey(apiSecret, 'ShipStation API secret', 'SHIPSTATION_API_SECRET'),
    };
  }

  const stored = loadStoredConfig('shipstation', ['apiKey', 'apiSecret'], 'ShipStation');
  if (!stored) return null;
  return {
    apiKey: validateGenericKey(stored.apiKey!, 'ShipStation API key', 'SHIPSTATION_API_KEY'),
    apiSecret: validateGenericKey(
      stored.apiSecret!,
      'ShipStation API secret',
      'SHIPSTATION_API_SECRET',
    ),
  };
}

export function getShipHeroConfigFromEnv(): ShipHeroConfig | null {
  const rawToken = readFirstEnvVar(['SHIPHERO_ACCESS_TOKEN', 'STATESET_SHIPHERO_ACCESS_TOKEN']);
  if (rawToken) {
    return {
      accessToken: validateGenericKey(rawToken, 'ShipHero access token', 'SHIPHERO_ACCESS_TOKEN'),
    };
  }

  const stored = loadStoredConfig('shiphero', ['accessToken'], 'ShipHero');
  if (!stored) return null;
  return {
    accessToken: validateGenericKey(
      stored.accessToken!,
      'ShipHero access token',
      'SHIPHERO_ACCESS_TOKEN',
    ),
  };
}

export function getShipFusionConfigFromEnv(): ShipFusionConfig | null {
  const apiKey = readFirstEnvVar(['SHIPFUSION_API_KEY', 'STATESET_SHIPFUSION_API_KEY']);
  const clientId = readFirstEnvVar(['SHIPFUSION_CLIENT_ID', 'STATESET_SHIPFUSION_CLIENT_ID']);
  if (apiKey || clientId) {
    if (!apiKey) throw new Error('Missing ShipFusion API key. Set SHIPFUSION_API_KEY.');
    if (!clientId) throw new Error('Missing ShipFusion client ID. Set SHIPFUSION_CLIENT_ID.');
    return {
      apiKey: validateGenericKey(apiKey, 'ShipFusion API key', 'SHIPFUSION_API_KEY'),
      clientId: validateGenericKey(clientId, 'ShipFusion client ID', 'SHIPFUSION_CLIENT_ID'),
    };
  }

  const stored = loadStoredConfig('shipfusion', ['apiKey', 'clientId'], 'ShipFusion');
  if (!stored) return null;
  return {
    apiKey: validateGenericKey(stored.apiKey!, 'ShipFusion API key', 'SHIPFUSION_API_KEY'),
    clientId: validateGenericKey(stored.clientId!, 'ShipFusion client ID', 'SHIPFUSION_CLIENT_ID'),
  };
}

export function getShipHawkConfigFromEnv(): ShipHawkConfig | null {
  const rawKey = readFirstEnvVar(['SHIPHAWK_API_KEY', 'STATESET_SHIPHAWK_API_KEY']);
  if (rawKey) {
    return { apiKey: validateGenericKey(rawKey, 'ShipHawk API key', 'SHIPHAWK_API_KEY') };
  }

  const stored = loadStoredConfig('shiphawk', ['apiKey'], 'ShipHawk');
  if (!stored) return null;
  return { apiKey: validateGenericKey(stored.apiKey!, 'ShipHawk API key', 'SHIPHAWK_API_KEY') };
}

export function getZendeskConfigFromEnv(): ZendeskConfig | null {
  const rawSubdomain = readFirstEnvVar(['ZENDESK_SUBDOMAIN', 'STATESET_ZENDESK_SUBDOMAIN']);
  const email = readFirstEnvVar(['ZENDESK_EMAIL', 'STATESET_ZENDESK_EMAIL']);
  const apiToken = readFirstEnvVar(['ZENDESK_API_TOKEN', 'STATESET_ZENDESK_API_TOKEN']);

  if (rawSubdomain || email || apiToken) {
    if (!rawSubdomain) throw new Error('Missing Zendesk subdomain. Set ZENDESK_SUBDOMAIN.');
    if (!email) throw new Error('Missing Zendesk email. Set ZENDESK_EMAIL.');
    if (!apiToken) throw new Error('Missing Zendesk API token. Set ZENDESK_API_TOKEN.');

    return {
      subdomain: normalizeZendeskSubdomain(rawSubdomain),
      email,
      apiToken: validateGenericKey(apiToken, 'Zendesk API token', 'ZENDESK_API_TOKEN'),
    };
  }

  const stored = loadStoredConfig('zendesk', ['subdomain', 'email', 'apiToken'], 'Zendesk');
  if (!stored) return null;
  return {
    subdomain: normalizeZendeskSubdomain(stored.subdomain!),
    email: stored.email!,
    apiToken: validateGenericKey(stored.apiToken!, 'Zendesk API token', 'ZENDESK_API_TOKEN'),
  };
}

/**
 * Maps each integration ID to its config getter function.
 * Used by `isIntegrationConfigured()` to check status without
 * requiring callers to import every individual getter.
 */
const CONFIG_CHECKERS: Record<IntegrationId, () => unknown> = {
  shopify: getShopifyConfigFromEnv,
  gorgias: getGorgiasConfigFromEnv,
  recharge: getRechargeConfigFromEnv,
  skio: getSkioConfigFromEnv,
  stayai: getStayAiConfigFromEnv,
  amazon: getAmazonConfigFromEnv,
  dhl: getDhlConfigFromEnv,
  globale: getGlobalEConfigFromEnv,
  fedex: getFedExConfigFromEnv,
  klaviyo: getKlaviyoConfigFromEnv,
  loop: getLoopConfigFromEnv,
  shipstation: getShipStationConfigFromEnv,
  shiphero: getShipHeroConfigFromEnv,
  shipfusion: getShipFusionConfigFromEnv,
  shiphawk: getShipHawkConfigFromEnv,
  zendesk: getZendeskConfigFromEnv,
};

/** Returns true if the integration's config getter returns a truthy value without throwing. */
export function isIntegrationConfigured(id: IntegrationId): boolean {
  const checker = CONFIG_CHECKERS[id];
  if (!checker) return false;
  try {
    return Boolean(checker());
  } catch {
    return false;
  }
}

export function getIntegrationFlagsFromEnv(): IntegrationFlags {
  const allowApply = parseBooleanEnv(
    readFirstEnvVar(['STATESET_ALLOW_APPLY', 'RESPONSE_ALLOW_APPLY', 'ALLOW_APPLY']),
  );
  const redact = parseBooleanEnv(
    readFirstEnvVar(['STATESET_REDACT', 'RESPONSE_REDACT', 'REDACT_PII']),
  );

  return { allowApply, redact };
}
