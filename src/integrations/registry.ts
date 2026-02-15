export const KLAVIYO_DEFAULT_REVISION = '2026-01-15';

export type IntegrationId =
  | 'shopify'
  | 'gorgias'
  | 'recharge'
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
