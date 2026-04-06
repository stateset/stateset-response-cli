import { getCurrentOrg, type OrgConfig } from '../config.js';
import {
  createGraphQLClient,
  executeQuery,
  type GraphQLAuth,
} from '../mcp-server/graphql-client.js';
import type { ConnectorSpec } from './manifest-builder.js';
import type {
  ConnectorPreferences,
  LocalConnectorSyncPlan,
  RequiredEnvVar,
  UnsupportedConnectorService,
} from './workflow-studio-connectors.js';
import {
  getStateSetKbBaseUrl,
  normalizeBrandEnvPrefix,
  normalizeConnectorPreferences,
} from './workflow-studio-connectors.js';

const PLATFORM_SYNCABLE_CONNECTOR_TYPES = new Set([
  'shopify',
  'gorgias',
  'recharge',
  'shiphero',
  'loop',
  'loop_returns',
  'qdrant',
]);

interface RawAccessTokenRow {
  shop?: string | null;
  shopify_access_token?: string | null;
  gorgias?: string | null;
  gorgias_access_token?: string | null;
  gorgias_username?: string | null;
  zendesk?: string | null;
  zendesk_access_token?: string | null;
  zendesk_email?: string | null;
  shipstation_api_key?: string | null;
  shiphero_api_key?: string | null;
  shiphero_refresh_token?: string | null;
  loop_api_key?: string | null;
  recharge_api_key?: string | null;
  skio_api_key?: string | null;
  shipfusion_api_key?: string | null;
  ordergroove_api_key?: string | null;
  merchant_name?: string | null;
  domain?: string | null;
  org_id?: string | null;
  user_id?: string | null;
  stateset_kb_collection?: string | null;
  stateset_kb_api_key?: string | null;
}

export interface PlatformConnectorCredentials {
  orgId: string;
  userId?: string;
  merchantName?: string;
  domain?: string;
  shopify?: {
    shop: string;
    accessToken: string;
    apiVersion: string;
  } | null;
  gorgias?: {
    domain: string;
    apiKey: string;
    email?: string;
  } | null;
  zendesk?: {
    subdomain: string;
    apiToken: string;
    email: string;
  } | null;
  shipstation?: {
    apiKey: string;
  } | null;
  shiphero?: {
    accessToken: string;
    refreshToken?: string;
  } | null;
  loop?: {
    apiKey: string;
  } | null;
  recharge?: {
    apiKey: string;
  } | null;
  skio?: {
    apiKey: string;
  } | null;
  shipfusion?: {
    apiKey: string;
  } | null;
  ordergroove?: {
    apiKey: string;
  } | null;
  statesetKb?: {
    collection: string;
    apiKey: string;
  } | null;
}

interface SyncTarget {
  service: string;
  connector_type: string;
}

function hasEnvVar(name: string): boolean {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0;
}

function addEnvRequirement(acc: Map<string, RequiredEnvVar>, name: string, purpose: string): void {
  if (acc.has(name)) {
    return;
  }
  acc.set(name, {
    name,
    purpose,
    presentInShell: hasEnvVar(name),
  });
}

function makeGraphqlAuth(orgConfig: OrgConfig): GraphQLAuth {
  const cliToken = orgConfig.cliToken?.trim();
  if (cliToken) {
    return { type: 'cli_token', token: cliToken };
  }
  const adminSecret = orgConfig.adminSecret?.trim();
  if (adminSecret) {
    return { type: 'admin_secret', adminSecret };
  }
  throw new Error('Current organization is missing GraphQL credentials.');
}

function normalizePlatformCredentials(raw: RawAccessTokenRow): PlatformConnectorCredentials {
  return {
    orgId: String(raw.org_id || '').trim(),
    userId: raw.user_id ? String(raw.user_id).trim() : undefined,
    merchantName: raw.merchant_name ? String(raw.merchant_name).trim() : undefined,
    domain: raw.domain ? String(raw.domain).trim() : undefined,
    shopify:
      raw.shop && raw.shopify_access_token
        ? {
            shop: String(raw.shop).trim(),
            accessToken: String(raw.shopify_access_token).trim(),
            apiVersion: '2025-01',
          }
        : null,
    gorgias:
      raw.gorgias && raw.gorgias_access_token
        ? {
            domain: String(raw.gorgias).trim(),
            apiKey: String(raw.gorgias_access_token).trim(),
            email: raw.gorgias_username ? String(raw.gorgias_username).trim() : undefined,
          }
        : null,
    zendesk:
      raw.zendesk && raw.zendesk_access_token && raw.zendesk_email
        ? {
            subdomain: String(raw.zendesk).trim(),
            apiToken: String(raw.zendesk_access_token).trim(),
            email: String(raw.zendesk_email).trim(),
          }
        : null,
    shipstation: raw.shipstation_api_key
      ? {
          apiKey: String(raw.shipstation_api_key).trim(),
        }
      : null,
    shiphero: raw.shiphero_api_key
      ? {
          accessToken: String(raw.shiphero_api_key).trim(),
          refreshToken: raw.shiphero_refresh_token
            ? String(raw.shiphero_refresh_token).trim()
            : undefined,
        }
      : null,
    loop: raw.loop_api_key
      ? {
          apiKey: String(raw.loop_api_key).trim(),
        }
      : null,
    recharge: raw.recharge_api_key
      ? {
          apiKey: String(raw.recharge_api_key).trim(),
        }
      : null,
    skio: raw.skio_api_key
      ? {
          apiKey: String(raw.skio_api_key).trim(),
        }
      : null,
    shipfusion: raw.shipfusion_api_key
      ? {
          apiKey: String(raw.shipfusion_api_key).trim(),
        }
      : null,
    ordergroove: raw.ordergroove_api_key
      ? {
          apiKey: String(raw.ordergroove_api_key).trim(),
        }
      : null,
    statesetKb:
      raw.stateset_kb_collection && raw.stateset_kb_api_key
        ? {
            collection: String(raw.stateset_kb_collection).trim(),
            apiKey: String(raw.stateset_kb_api_key).trim(),
          }
        : null,
  };
}

export function getAvailablePlatformCredentialServices(
  credentials: PlatformConnectorCredentials,
): string[] {
  const services: string[] = [];
  if (credentials.shopify) services.push('shopify');
  if (credentials.gorgias) services.push('gorgias');
  if (credentials.zendesk) services.push('zendesk');
  if (credentials.shipstation) services.push('shipstation');
  if (credentials.shiphero) services.push('shiphero');
  if (credentials.loop) services.push('loop');
  if (credentials.recharge) services.push('recharge');
  if (credentials.skio) services.push('skio');
  if (credentials.shipfusion) services.push('shipfusion');
  if (credentials.ordergroove) services.push('ordergroove');
  if (
    hasEnvVar('STATESET_KB_API_KEY') &&
    credentials.statesetKb?.collection &&
    getStateSetKbBaseUrl()
  ) {
    services.push('stateset-kb');
  }
  return services;
}

function mapServiceToConnectorType(service: string): string {
  const map: Record<string, string> = {
    shopify: 'shopify',
    gorgias: 'gorgias',
    zendesk: 'zendesk',
    recharge: 'recharge',
    shipstation: 'shipstation',
    shiphero: 'shiphero',
    loop: 'loop',
    'stateset-kb': 'qdrant',
    'stateset-nsr': 'nsr',
  };
  return map[service] ?? service;
}

function buildSyncTargets(
  availableServices: string[],
  connectorPreferences: ConnectorPreferences,
): { syncableTargets: SyncTarget[]; unsupportedServices: UnsupportedConnectorService[] } {
  const syncableTargets: SyncTarget[] = [];
  const unsupportedServices: UnsupportedConnectorService[] = [];
  const loopMode = connectorPreferences.loop_mode || 'subscriptions';

  for (const service of availableServices) {
    if (service === 'loop') {
      if (loopMode === 'subscriptions' || loopMode === 'both') {
        syncableTargets.push({ service, connector_type: 'loop' });
      }
      if (loopMode === 'returns' || loopMode === 'both') {
        syncableTargets.push({ service, connector_type: 'loop_returns' });
      }
      continue;
    }

    const connectorType = mapServiceToConnectorType(service);
    if (PLATFORM_SYNCABLE_CONNECTOR_TYPES.has(connectorType)) {
      syncableTargets.push({ service, connector_type: connectorType });
      continue;
    }

    unsupportedServices.push({
      service,
      connector_type: connectorType,
      reason: 'This connector is not currently supported by the Temporal Rust workflow engine.',
    });
  }

  return { syncableTargets, unsupportedServices };
}

function buildConnector(
  connector: Omit<ConnectorSpec, 'enabled' | 'retry_policy'> & {
    enabled?: boolean;
    retry_policy?: Record<string, unknown>;
  },
): ConnectorSpec {
  return {
    enabled: true,
    retry_policy: {},
    ...connector,
  };
}

export async function fetchCurrentOrgPlatformConnectorCredentials(): Promise<PlatformConnectorCredentials | null> {
  const { orgId, config } = getCurrentOrg();
  const client = createGraphQLClient(config.graphqlEndpoint, makeGraphqlAuth(config), orgId);
  const query = `query GetPlatformConnectorCredentials($org_id: String!) {
    access_tokens(where: { org_id: { _eq: $org_id } }, limit: 1) {
      shop
      shopify_access_token
      gorgias
      gorgias_access_token
      gorgias_username
      zendesk
      zendesk_access_token
      zendesk_email
      shipstation_api_key
      shiphero_api_key
      shiphero_refresh_token
      loop_api_key
      recharge_api_key
      skio_api_key
      shipfusion_api_key
      ordergroove_api_key
      merchant_name
      domain
      org_id
      user_id
      stateset_kb_collection
      stateset_kb_api_key
    }
  }`;

  const data = await executeQuery<{ access_tokens: RawAccessTokenRow[] }>(client, query, {
    org_id: orgId,
  });
  const row = data.access_tokens?.[0];
  if (!row) {
    return null;
  }

  const normalized = normalizePlatformCredentials(row);
  if (!normalized.orgId) {
    normalized.orgId = orgId;
  }
  return normalized;
}

export function buildPlatformConnectorSyncPlanFromCredentials(
  brandSlug: string,
  credentials: PlatformConnectorCredentials,
  rawPreferences: unknown = {},
): LocalConnectorSyncPlan {
  const connectorPreferences = normalizeConnectorPreferences(rawPreferences);
  const brandEnvPrefix = normalizeBrandEnvPrefix(brandSlug);
  const requiredEnvVars = new Map<string, RequiredEnvVar>();
  const connectors: ConnectorSpec[] = [];
  const warnings: string[] = [
    'Platform credential sync creates connector bindings from access_tokens, but it does not provision the referenced env:// secrets into the workflow engine runtime.',
  ];
  const kbBaseUrl = getStateSetKbBaseUrl();

  const availableServices = getAvailablePlatformCredentialServices(credentials);
  const { syncableTargets, unsupportedServices } = buildSyncTargets(
    availableServices,
    connectorPreferences,
  );
  const targetTypes = new Set(syncableTargets.map((target) => target.connector_type));

  if (credentials.statesetKb && hasEnvVar('STATESET_KB_API_KEY') && !kbBaseUrl) {
    warnings.push(
      'Platform KB credentials were found, but STATESET_KB_BASE_URL or STATESET_KB_HOST is not set in the current shell.',
    );
  }

  if (targetTypes.has('gorgias') && credentials.gorgias) {
    addEnvRequirement(
      requiredEnvVars,
      `GORGIAS_AUTH_${credentials.orgId}`,
      'Platform-managed Gorgias Basic auth token',
    );
    connectors.push(
      buildConnector({
        connector_key: 'gorgias-primary',
        connector_type: 'gorgias',
        direction: 'outbound',
        target: {
          base_url: `https://${credentials.gorgias.domain}.gorgias.com`,
        },
        auth: {
          secret_ref: `env://GORGIAS_AUTH_${credentials.orgId}`,
        },
        metadata: {
          domain: credentials.gorgias.domain,
          email: credentials.gorgias.email,
          source: 'platform_sync',
        },
      }),
    );
  }

  if (targetTypes.has('shopify') && credentials.shopify) {
    addEnvRequirement(
      requiredEnvVars,
      `SHOPIFY_TOKEN_${credentials.orgId}`,
      'Platform-managed Shopify Admin API token',
    );
    connectors.push(
      buildConnector({
        connector_key: 'shopify-primary',
        connector_type: 'shopify',
        direction: 'outbound',
        target: {
          base_url: `https://${credentials.shopify.shop}`,
          api_version: credentials.shopify.apiVersion || '2025-01',
        },
        auth: {
          secret_ref: `env://SHOPIFY_TOKEN_${credentials.orgId}`,
        },
        metadata: {
          shop: credentials.shopify.shop,
          api_version: credentials.shopify.apiVersion || '2025-01',
          source: 'platform_sync',
        },
      }),
    );
  }

  if (targetTypes.has('recharge') && credentials.recharge) {
    addEnvRequirement(
      requiredEnvVars,
      `RECHARGE_TOKEN_${credentials.orgId}`,
      'Platform-managed Recharge API token',
    );
    connectors.push(
      buildConnector({
        connector_key: 'recharge-primary',
        connector_type: 'recharge',
        direction: 'outbound',
        target: {
          base_url: 'https://api.rechargeapps.com',
        },
        auth: {
          secret_ref: `env://RECHARGE_TOKEN_${credentials.orgId}`,
        },
        metadata: {
          source: 'platform_sync',
        },
      }),
    );
  }

  if (targetTypes.has('shiphero') && credentials.shiphero) {
    addEnvRequirement(
      requiredEnvVars,
      `SHIPHERO_TOKEN_${credentials.orgId}`,
      'Platform-managed ShipHero access token',
    );
    connectors.push(
      buildConnector({
        connector_key: 'shiphero-primary',
        connector_type: 'shiphero',
        direction: 'outbound',
        target: {
          endpoint: 'https://public-api.shiphero.com/graphql',
        },
        auth: {
          secret_ref: `env://SHIPHERO_TOKEN_${credentials.orgId}`,
        },
        metadata: {
          source: 'platform_sync',
        },
      }),
    );
  }

  if (targetTypes.has('loop') && credentials.loop) {
    addEnvRequirement(
      requiredEnvVars,
      `LOOP_API_KEY_${credentials.orgId}`,
      'Platform-managed Loop API key',
    );
    connectors.push(
      buildConnector({
        connector_key: 'loop-primary',
        connector_type: 'loop',
        direction: 'outbound',
        target: {
          base_url: 'https://api.loopsubscriptions.com/admin/2023-10',
        },
        auth: {
          secret_ref: `env://LOOP_API_KEY_${credentials.orgId}`,
        },
        metadata: {
          mode: 'subscriptions',
          source: 'platform_sync',
        },
      }),
    );
  }

  if (targetTypes.has('loop_returns') && credentials.loop) {
    addEnvRequirement(
      requiredEnvVars,
      `LOOP_API_KEY_${credentials.orgId}`,
      'Platform-managed Loop API key',
    );
    connectors.push(
      buildConnector({
        connector_key: 'loop-returns-primary',
        connector_type: 'loop_returns',
        direction: 'outbound',
        target: {
          base_url: 'https://api.loopreturns.com/api/v1',
        },
        auth: {
          secret_ref: `env://LOOP_API_KEY_${credentials.orgId}`,
        },
        metadata: {
          mode: 'returns',
          source: 'platform_sync',
        },
      }),
    );
  }

  if (targetTypes.has('qdrant') && credentials.statesetKb && kbBaseUrl) {
    addEnvRequirement(
      requiredEnvVars,
      'STATESET_KB_API_KEY',
      'StateSet KB API key for qdrant connector auth',
    );
    connectors.push(
      buildConnector({
        connector_key: 'stateset-kb-primary',
        connector_type: 'qdrant',
        direction: 'outbound',
        target: {
          base_url: kbBaseUrl,
        },
        auth: {
          secret_ref: 'env://STATESET_KB_API_KEY',
        },
        metadata: {
          collection: credentials.statesetKb.collection,
          source: 'platform_sync',
        },
      }),
    );
  }

  addEnvRequirement(
    requiredEnvVars,
    'OPENAI_API_KEY',
    'OpenAI API key for workflow engine LLM calls',
  );
  connectors.push(
    buildConnector({
      connector_key: 'openai-primary',
      connector_type: 'openai',
      direction: 'outbound',
      target: {
        base_url: 'https://api.openai.com',
      },
      auth: {
        secret_ref: 'env://OPENAI_API_KEY',
      },
      metadata: { source: 'platform_sync' },
    }),
  );

  if (hasEnvVar('ANTHROPIC_API_KEY')) {
    addEnvRequirement(
      requiredEnvVars,
      'ANTHROPIC_API_KEY',
      'Anthropic API key for workflow engine connector auth',
    );
    connectors.push(
      buildConnector({
        connector_key: 'anthropic-primary',
        connector_type: 'anthropic',
        direction: 'outbound',
        target: {
          base_url: 'https://api.anthropic.com',
        },
        auth: {
          secret_ref: 'env://ANTHROPIC_API_KEY',
        },
        metadata: { source: 'platform_sync' },
      }),
    );
  }

  if (hasEnvVar('MEM0_API_KEY')) {
    addEnvRequirement(requiredEnvVars, 'MEM0_API_KEY', 'mem0 API key for memory connector auth');
    connectors.push(
      buildConnector({
        connector_key: 'mem0-primary',
        connector_type: 'mem0',
        direction: 'outbound',
        target: {
          base_url: 'https://api.mem0.ai',
        },
        auth: {
          secret_ref: 'env://MEM0_API_KEY',
        },
        metadata: { source: 'platform_sync' },
      }),
    );
  }

  for (const requirement of requiredEnvVars.values()) {
    if (!requirement.presentInShell) {
      warnings.push(
        `Expected ${requirement.name} for platform-synced connector auth, but it is not set in the current shell.`,
      );
    }
  }

  return {
    brandSlug,
    brandEnvPrefix,
    connectorPreferences,
    availableServices,
    syncableServices: Array.from(new Set(syncableTargets.map((target) => target.service))).sort(
      (left, right) => left.localeCompare(right),
    ),
    connectors,
    requiredEnvVars: Array.from(requiredEnvVars.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    unsupportedServices,
    warnings,
  };
}
