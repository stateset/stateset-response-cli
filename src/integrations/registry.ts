export const KLAVIYO_DEFAULT_REVISION = '2026-01-15';

export type IntegrationId =
  | 'shopify'
  | 'gorgias'
  | 'recharge'
  | 'skio'
  | 'stayai'
  | 'amazon'
  | 'dhl'
  | 'globale'
  | 'fedex'
  | 'klaviyo'
  | 'loop'
  | 'shipstation'
  | 'shiphero'
  | 'shipfusion'
  | 'shiphawk'
  | 'zendesk';

export interface IntegrationField {
  key: string;
  label: string;
  envVars: string[];
  required?: boolean;
  secret?: boolean;
  defaultValue?: string;
  placeholder?: string;
  hint?: string;
}

export interface IntegrationDefinition {
  id: IntegrationId;
  label: string;
  description: string;
  fields: IntegrationField[];
}

export const INTEGRATION_DEFINITIONS: IntegrationDefinition[] = [
  {
    id: 'shopify',
    label: 'Shopify',
    description: 'Order listing, holds, refunds, and tagging',
    fields: [
      {
        key: 'shop',
        label: 'Shop domain',
        envVars: [
          'SHOPIFY_SHOP_DOMAIN',
          'SHOPIFY_SHOP',
          'SHOPIFY_DOMAIN',
          'STATESET_SHOPIFY_SHOP_DOMAIN',
        ],
        required: true,
        placeholder: 'myshop.myshopify.com',
      },
      {
        key: 'accessToken',
        label: 'Admin API access token',
        envVars: [
          'SHOPIFY_ACCESS_TOKEN',
          'SHOPIFY_TOKEN',
          'SHOPIFY_ADMIN_ACCESS_TOKEN',
          'STATESET_SHOPIFY_ACCESS_TOKEN',
        ],
        required: true,
        secret: true,
      },
      {
        key: 'apiVersion',
        label: 'API version',
        envVars: ['SHOPIFY_API_VERSION', 'SHOPIFY_API_VER', 'STATESET_SHOPIFY_API_VERSION'],
        defaultValue: '2025-04',
      },
    ],
  },
  {
    id: 'gorgias',
    label: 'Gorgias',
    description: 'Tickets, macros, tags, and merges',
    fields: [
      {
        key: 'domain',
        label: 'Subdomain',
        envVars: ['GORGIAS_DOMAIN', 'STATESET_GORGIAS_DOMAIN'],
        required: true,
        placeholder: 'acme',
      },
      {
        key: 'apiKey',
        label: 'API key',
        envVars: ['GORGIAS_API_KEY', 'STATESET_GORGIAS_API_KEY'],
        required: true,
        secret: true,
      },
      {
        key: 'email',
        label: 'Agent email',
        envVars: ['GORGIAS_EMAIL', 'STATESET_GORGIAS_EMAIL'],
        required: true,
      },
    ],
  },
  {
    id: 'recharge',
    label: 'Recharge',
    description: 'Subscriptions, charges, and orders',
    fields: [
      {
        key: 'accessToken',
        label: 'Access token',
        envVars: [
          'RECHARGE_ACCESS_TOKEN',
          'RECHARGE_API_TOKEN',
          'RECHARGE_API_KEY',
          'STATESET_RECHARGE_ACCESS_TOKEN',
        ],
        required: true,
        secret: true,
      },
      {
        key: 'apiVersion',
        label: 'API version',
        envVars: ['RECHARGE_API_VERSION', 'RECHARGE_API_VER', 'STATESET_RECHARGE_API_VERSION'],
        defaultValue: '2021-01',
      },
    ],
  },
  {
    id: 'skio',
    label: 'Skio',
    description: 'Subscriptions, charges, and customer lifecycle',
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        envVars: ['SKIO_API_KEY', 'STATESET_SKIO_API_KEY'],
        required: true,
        secret: true,
      },
      {
        key: 'baseUrl',
        label: 'API base URL',
        envVars: ['SKIO_BASE_URL', 'STATESET_SKIO_BASE_URL'],
        defaultValue: 'https://api.skio.com/v1',
        placeholder: 'https://api.skio.com/v1',
      },
      {
        key: 'apiVersion',
        label: 'API version',
        envVars: ['SKIO_API_VERSION', 'STATESET_SKIO_API_VERSION'],
        defaultValue: '2024-01',
      },
    ],
  },
  {
    id: 'stayai',
    label: 'Stay.ai',
    description: 'Subscriptions, charges, and customer lifecycle',
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        envVars: ['STAYAI_API_KEY', 'STAY_AI_API_KEY', 'STATESET_STAYAI_API_KEY'],
        required: true,
        secret: true,
      },
      {
        key: 'baseUrl',
        label: 'API base URL',
        envVars: ['STAYAI_BASE_URL', 'STAY_AI_BASE_URL', 'STATESET_STAYAI_BASE_URL'],
        defaultValue: 'https://api.stay.ai/v1',
        placeholder: 'https://api.stay.ai/v1',
      },
      {
        key: 'apiVersion',
        label: 'API version',
        envVars: ['STAYAI_API_VERSION', 'STAY_AI_API_VERSION', 'STATESET_STAYAI_API_VERSION'],
        defaultValue: '2024-01',
      },
    ],
  },
  {
    id: 'amazon',
    label: 'Amazon SP-API',
    description: 'Orders and fulfillment operations',
    fields: [
      {
        key: 'lwaClientId',
        label: 'LWA client ID',
        envVars: ['AMAZON_LWA_CLIENT_ID', 'STATESET_AMAZON_LWA_CLIENT_ID'],
        required: true,
      },
      {
        key: 'lwaClientSecret',
        label: 'LWA client secret',
        envVars: ['AMAZON_LWA_CLIENT_SECRET', 'STATESET_AMAZON_LWA_CLIENT_SECRET'],
        required: true,
        secret: true,
      },
      {
        key: 'lwaRefreshToken',
        label: 'LWA refresh token',
        envVars: ['AMAZON_LWA_REFRESH_TOKEN', 'STATESET_AMAZON_LWA_REFRESH_TOKEN'],
        required: true,
        secret: true,
      },
      {
        key: 'awsAccessKeyId',
        label: 'AWS access key ID',
        envVars: ['AMAZON_AWS_ACCESS_KEY_ID', 'STATESET_AMAZON_AWS_ACCESS_KEY_ID'],
        required: true,
      },
      {
        key: 'awsSecretAccessKey',
        label: 'AWS secret access key',
        envVars: ['AMAZON_AWS_SECRET_ACCESS_KEY', 'STATESET_AMAZON_AWS_SECRET_ACCESS_KEY'],
        required: true,
        secret: true,
      },
      {
        key: 'awsSessionToken',
        label: 'AWS session token',
        envVars: ['AMAZON_AWS_SESSION_TOKEN', 'STATESET_AMAZON_AWS_SESSION_TOKEN'],
        required: false,
        secret: true,
      },
      {
        key: 'awsRegion',
        label: 'AWS region',
        envVars: ['AMAZON_SP_API_REGION', 'STATESET_AMAZON_SP_API_REGION'],
        defaultValue: 'us-east-1',
      },
      {
        key: 'endpoint',
        label: 'SP-API endpoint',
        envVars: ['AMAZON_SP_API_ENDPOINT', 'STATESET_AMAZON_SP_API_ENDPOINT'],
        defaultValue: 'https://sellingpartnerapi-na.amazon.com',
      },
      {
        key: 'marketplaceId',
        label: 'Default marketplace ID',
        envVars: ['AMAZON_SP_MARKETPLACE_ID', 'STATESET_AMAZON_SP_MARKETPLACE_ID'],
        required: false,
      },
    ],
  },
  {
    id: 'dhl',
    label: 'DHL',
    description: 'Shipping, rates, tracking, and pickups',
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        envVars: ['DHL_API_KEY', 'STATESET_DHL_API_KEY'],
        required: true,
        secret: true,
      },
      {
        key: 'accessToken',
        label: 'Access token',
        envVars: ['DHL_ACCESS_TOKEN', 'STATESET_DHL_ACCESS_TOKEN'],
        required: false,
        secret: true,
      },
      {
        key: 'accountNumber',
        label: 'Account number',
        envVars: ['DHL_ACCOUNT_NUMBER', 'STATESET_DHL_ACCOUNT_NUMBER'],
        required: false,
      },
      {
        key: 'baseUrl',
        label: 'API base URL',
        envVars: ['DHL_BASE_URL', 'STATESET_DHL_BASE_URL'],
        defaultValue: 'https://api-m.dhl.com',
      },
    ],
  },
  {
    id: 'globale',
    label: 'Global-e',
    description: 'Cross-border orders, shipments, and returns',
    fields: [
      {
        key: 'merchantId',
        label: 'Merchant ID',
        envVars: ['GLOBALE_MERCHANT_ID', 'GLOBAL_E_MERCHANT_ID', 'STATESET_GLOBALE_MERCHANT_ID'],
        required: true,
      },
      {
        key: 'apiKey',
        label: 'API key',
        envVars: ['GLOBALE_API_KEY', 'GLOBAL_E_API_KEY', 'STATESET_GLOBALE_API_KEY'],
        required: true,
        secret: true,
      },
      {
        key: 'channel',
        label: 'Channel',
        envVars: ['GLOBALE_CHANNEL', 'GLOBAL_E_CHANNEL', 'STATESET_GLOBALE_CHANNEL'],
        required: false,
      },
      {
        key: 'baseUrl',
        label: 'API base URL',
        envVars: ['GLOBALE_BASE_URL', 'GLOBAL_E_BASE_URL', 'STATESET_GLOBALE_BASE_URL'],
        defaultValue: 'https://api.global-e.com',
      },
    ],
  },
  {
    id: 'fedex',
    label: 'FedEx',
    description: 'Rates, labels, tracking, and pickups',
    fields: [
      {
        key: 'clientId',
        label: 'Client ID',
        envVars: ['FEDEX_CLIENT_ID', 'STATESET_FEDEX_CLIENT_ID'],
        required: true,
      },
      {
        key: 'clientSecret',
        label: 'Client secret',
        envVars: ['FEDEX_CLIENT_SECRET', 'STATESET_FEDEX_CLIENT_SECRET'],
        required: true,
        secret: true,
      },
      {
        key: 'accountNumber',
        label: 'Account number',
        envVars: ['FEDEX_ACCOUNT_NUMBER', 'STATESET_FEDEX_ACCOUNT_NUMBER'],
        required: false,
      },
      {
        key: 'locale',
        label: 'Locale',
        envVars: ['FEDEX_LOCALE', 'STATESET_FEDEX_LOCALE'],
        defaultValue: 'en_US',
      },
      {
        key: 'baseUrl',
        label: 'API base URL',
        envVars: ['FEDEX_BASE_URL', 'STATESET_FEDEX_BASE_URL'],
        defaultValue: 'https://apis.fedex.com',
      },
    ],
  },
  {
    id: 'klaviyo',
    label: 'Klaviyo',
    description: 'Profiles, lists, segments, campaigns, flows',
    fields: [
      {
        key: 'apiKey',
        label: 'Private API key',
        envVars: [
          'KLAVIYO_PRIVATE_API_KEY',
          'KLAVIYO_API_KEY',
          'KLAVIYO_PRIVATE_KEY',
          'STATESET_KLAVIYO_API_KEY',
        ],
        required: true,
        secret: true,
      },
      {
        key: 'revision',
        label: 'API revision',
        envVars: ['KLAVIYO_REVISION', 'KLAVIYO_API_REVISION', 'STATESET_KLAVIYO_REVISION'],
        defaultValue: KLAVIYO_DEFAULT_REVISION,
      },
    ],
  },
  {
    id: 'loop',
    label: 'Loop Returns',
    description: 'Returns, exchanges, and labels',
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        envVars: ['LOOP_API_KEY', 'STATESET_LOOP_API_KEY'],
        required: true,
        secret: true,
      },
    ],
  },
  {
    id: 'shipstation',
    label: 'ShipStation',
    description: 'Labels, shipments, and rates',
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        envVars: ['SHIPSTATION_API_KEY', 'STATESET_SHIPSTATION_API_KEY'],
        required: true,
        secret: true,
      },
      {
        key: 'apiSecret',
        label: 'API secret',
        envVars: ['SHIPSTATION_API_SECRET', 'STATESET_SHIPSTATION_API_SECRET'],
        required: true,
        secret: true,
      },
    ],
  },
  {
    id: 'shiphero',
    label: 'ShipHero',
    description: 'Warehouse orders and inventory',
    fields: [
      {
        key: 'accessToken',
        label: 'Access token',
        envVars: ['SHIPHERO_ACCESS_TOKEN', 'STATESET_SHIPHERO_ACCESS_TOKEN'],
        required: true,
        secret: true,
      },
    ],
  },
  {
    id: 'shipfusion',
    label: 'ShipFusion',
    description: '3PL orders, shipments, and returns',
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        envVars: ['SHIPFUSION_API_KEY', 'STATESET_SHIPFUSION_API_KEY'],
        required: true,
        secret: true,
      },
      {
        key: 'clientId',
        label: 'Client ID',
        envVars: ['SHIPFUSION_CLIENT_ID', 'STATESET_SHIPFUSION_CLIENT_ID'],
        required: true,
      },
    ],
  },
  {
    id: 'shiphawk',
    label: 'ShipHawk',
    description: 'Freight rates and bookings',
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        envVars: ['SHIPHAWK_API_KEY', 'STATESET_SHIPHAWK_API_KEY'],
        required: true,
        secret: true,
      },
    ],
  },
  {
    id: 'zendesk',
    label: 'Zendesk',
    description: 'Tickets, users, and workflows',
    fields: [
      {
        key: 'subdomain',
        label: 'Subdomain',
        envVars: ['ZENDESK_SUBDOMAIN', 'STATESET_ZENDESK_SUBDOMAIN'],
        required: true,
        placeholder: 'acme',
      },
      {
        key: 'email',
        label: 'Agent email',
        envVars: ['ZENDESK_EMAIL', 'STATESET_ZENDESK_EMAIL'],
        required: true,
      },
      {
        key: 'apiToken',
        label: 'API token',
        envVars: ['ZENDESK_API_TOKEN', 'STATESET_ZENDESK_API_TOKEN'],
        required: true,
        secret: true,
      },
    ],
  },
];

export const INTEGRATION_MAP: Record<IntegrationId, IntegrationDefinition> =
  INTEGRATION_DEFINITIONS.reduce(
    (acc, def) => {
      acc[def.id] = def;
      return acc;
    },
    {} as Record<IntegrationId, IntegrationDefinition>,
  );

export function listIntegrations(): IntegrationDefinition[] {
  return INTEGRATION_DEFINITIONS.slice();
}

export function getIntegrationDefinition(id: IntegrationId): IntegrationDefinition {
  return INTEGRATION_MAP[id];
}

export function getIntegrationSecretKeys(id: IntegrationId): string[] {
  const def = INTEGRATION_MAP[id];
  return def.fields.filter((field) => field.secret).map((field) => field.key);
}
