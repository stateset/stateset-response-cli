import {
  getGorgiasConfigFromEnv,
  getLoopConfigFromEnv,
  getRechargeConfigFromEnv,
  getShipHeroConfigFromEnv,
  getShipStationConfigFromEnv,
  getShopifyConfigFromEnv,
  getSkioConfigFromEnv,
  getStayAiConfigFromEnv,
  getZendeskConfigFromEnv,
} from '../integrations/config.js';
import type { ConnectorSpec } from './manifest-builder.js';

export const LOOP_SYNC_MODES = ['subscriptions', 'returns', 'both'] as const;
export type LoopSyncMode = (typeof LOOP_SYNC_MODES)[number];

export interface ConnectorPreferences {
  loop_mode: LoopSyncMode;
}

export interface UnsupportedConnectorService {
  service: string;
  connector_type: string;
  reason: string;
}

export interface RequiredEnvVar {
  name: string;
  purpose: string;
  presentInShell: boolean;
}

export interface LocalConnectorSyncPlan {
  brandSlug: string;
  brandEnvPrefix: string;
  connectorPreferences: ConnectorPreferences;
  availableServices: string[];
  syncableServices: string[];
  connectors: ConnectorSpec[];
  requiredEnvVars: RequiredEnvVar[];
  unsupportedServices: UnsupportedConnectorService[];
  warnings: string[];
}

export const DEFAULT_CONNECTOR_PREFERENCES: ConnectorPreferences = Object.freeze({
  loop_mode: 'subscriptions',
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasEnvVar(name: string): boolean {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeBaseUrl(value: string, fallback: string): string {
  const trimmed = String(value || '').trim();
  const candidate = trimmed || fallback;
  return candidate.replace(/\/+$/, '');
}

export function getStateSetKbBaseUrl(): string | null {
  const configured = String(
    process.env.STATESET_KB_BASE_URL || process.env.STATESET_KB_HOST || '',
  ).trim();
  if (!configured) {
    return null;
  }
  return normalizeBaseUrl(configured, '');
}

function connectorMatch(left: ConnectorSpec, right: ConnectorSpec): boolean {
  if (left.connector_key && right.connector_key && left.connector_key === right.connector_key) {
    return true;
  }
  return left.connector_type === right.connector_type && left.direction === right.direction;
}

function addEnvRequirement(acc: Map<string, RequiredEnvVar>, name: string, purpose: string): void {
  const existing = acc.get(name);
  if (existing) return;
  acc.set(name, {
    name,
    purpose,
    presentInShell: hasEnvVar(name),
  });
}

export function normalizeConnectorPreferences(rawPreferences: unknown = {}): ConnectorPreferences {
  const source = isPlainObject(rawPreferences) ? rawPreferences : {};
  const loopMode = LOOP_SYNC_MODES.includes(source.loop_mode as LoopSyncMode)
    ? (source.loop_mode as LoopSyncMode)
    : DEFAULT_CONNECTOR_PREFERENCES.loop_mode;

  return { loop_mode: loopMode };
}

export function getConnectorPreferencesFromMetadata(metadata: unknown = {}): ConnectorPreferences {
  if (!isPlainObject(metadata)) {
    return { ...DEFAULT_CONNECTOR_PREFERENCES };
  }
  return normalizeConnectorPreferences(metadata.connector_preferences);
}

export function mergeConnectorPreferencesIntoMetadata(
  metadata: unknown = {},
  nextPreferences: unknown = {},
): Record<string, unknown> {
  const baseMetadata = isPlainObject(metadata) ? metadata : {};
  const mergedPreferences = normalizeConnectorPreferences({
    ...getConnectorPreferencesFromMetadata(baseMetadata),
    ...(isPlainObject(nextPreferences) ? nextPreferences : {}),
  });

  return {
    ...baseMetadata,
    connector_preferences: mergedPreferences,
  };
}

export function normalizeBrandEnvPrefix(brandSlug: string): string {
  return String(brandSlug)
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .toUpperCase();
}

export function mergeConnectorSpecs(
  existing: readonly ConnectorSpec[],
  generated: readonly ConnectorSpec[],
): ConnectorSpec[] {
  const merged = existing.map((connector) => ({
    ...connector,
    target: { ...connector.target },
    auth: { ...connector.auth },
    metadata: connector.metadata ? { ...connector.metadata } : undefined,
  }));

  for (const candidate of generated) {
    const index = merged.findIndex((connector) => connectorMatch(connector, candidate));
    if (index === -1) {
      merged.push({
        ...candidate,
        target: { ...candidate.target },
        auth: { ...candidate.auth },
        metadata: candidate.metadata ? { ...candidate.metadata } : undefined,
      });
      continue;
    }

    const current = merged[index]!;
    merged[index] = {
      ...current,
      ...candidate,
      target: {
        ...current.target,
        ...candidate.target,
      },
      auth: {
        ...current.auth,
        ...candidate.auth,
      },
      metadata: {
        ...(current.metadata ?? {}),
        ...(candidate.metadata ?? {}),
      },
    };
  }

  return merged;
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

export function buildLocalConnectorSyncPlan(
  brandSlug: string,
  rawPreferences: unknown = {},
  cwd: string = process.cwd(),
): LocalConnectorSyncPlan {
  const connectorPreferences = normalizeConnectorPreferences(rawPreferences);
  const brandEnvPrefix = normalizeBrandEnvPrefix(brandSlug);
  const requiredEnvVars = new Map<string, RequiredEnvVar>();
  const connectors: ConnectorSpec[] = [];
  const availableServices: string[] = [];
  const syncableServices = new Set<string>();
  const unsupportedServices: UnsupportedConnectorService[] = [];
  const warnings: string[] = [];

  const shopify = getShopifyConfigFromEnv(cwd);
  if (shopify) {
    availableServices.push('shopify');
    syncableServices.add('shopify');
    const secretEnv = `${brandEnvPrefix}_SHOPIFY_ACCESS_TOKEN`;
    addEnvRequirement(requiredEnvVars, secretEnv, 'Shopify Admin API access token');
    connectors.push(
      buildConnector({
        connector_key: 'shopify-primary',
        connector_type: 'shopify',
        direction: 'outbound',
        target: {
          base_url: `https://${shopify.shop}`,
          api_version: shopify.apiVersion || '2025-04',
        },
        auth: {
          secret_ref: `env://${secretEnv}`,
        },
        metadata: {
          shop: shopify.shop,
          api_version: shopify.apiVersion || '2025-04',
          source: 'local_cli_sync',
        },
      }),
    );
    if (!hasEnvVar(secretEnv)) {
      warnings.push(
        `Detected local Shopify config, but ${secretEnv} is not set in the current shell.`,
      );
    }
  }

  const gorgias = getGorgiasConfigFromEnv(cwd);
  if (gorgias) {
    availableServices.push('gorgias');
    syncableServices.add('gorgias');
    const secretEnv = `${brandEnvPrefix}_GORGIAS_BASIC_TOKEN`;
    addEnvRequirement(
      requiredEnvVars,
      secretEnv,
      'Base64-encoded "email:apiKey" string for Gorgias Basic auth',
    );
    connectors.push(
      buildConnector({
        connector_key: 'gorgias-primary',
        connector_type: 'gorgias',
        direction: 'outbound',
        target: {
          base_url: `https://${gorgias.domain}.gorgias.com`,
        },
        auth: {
          secret_ref: `env://${secretEnv}`,
        },
        metadata: {
          domain: gorgias.domain,
          email: gorgias.email,
          source: 'local_cli_sync',
        },
      }),
    );
    if (!hasEnvVar(secretEnv)) {
      warnings.push(
        `Detected local Gorgias config, but ${secretEnv} is not set in the current shell.`,
      );
    }
  }

  const recharge = getRechargeConfigFromEnv(cwd);
  if (recharge) {
    availableServices.push('recharge');
    syncableServices.add('recharge');
    const secretEnv = `${brandEnvPrefix}_RECHARGE_ACCESS_TOKEN`;
    addEnvRequirement(requiredEnvVars, secretEnv, 'Recharge API access token');
    connectors.push(
      buildConnector({
        connector_key: 'recharge-primary',
        connector_type: 'recharge',
        direction: 'outbound',
        target: {
          base_url: 'https://api.rechargeapps.com',
          api_version: recharge.apiVersion || '2021-01',
        },
        auth: {
          secret_ref: `env://${secretEnv}`,
        },
        metadata: {
          api_version: recharge.apiVersion || '2021-01',
          source: 'local_cli_sync',
        },
      }),
    );
    if (!hasEnvVar(secretEnv)) {
      warnings.push(
        `Detected local Recharge config, but ${secretEnv} is not set in the current shell.`,
      );
    }
  }

  const shipHero = getShipHeroConfigFromEnv(cwd);
  if (shipHero) {
    availableServices.push('shiphero');
    syncableServices.add('shiphero');
    const secretEnv = `${brandEnvPrefix}_SHIPHERO_ACCESS_TOKEN`;
    addEnvRequirement(requiredEnvVars, secretEnv, 'ShipHero access token');
    connectors.push(
      buildConnector({
        connector_key: 'shiphero-primary',
        connector_type: 'shiphero',
        direction: 'outbound',
        target: {
          endpoint: 'https://public-api.shiphero.com/graphql',
        },
        auth: {
          secret_ref: `env://${secretEnv}`,
        },
        metadata: {
          source: 'local_cli_sync',
        },
      }),
    );
    if (!hasEnvVar(secretEnv)) {
      warnings.push(
        `Detected local ShipHero config, but ${secretEnv} is not set in the current shell.`,
      );
    }
  }

  const loop = getLoopConfigFromEnv(cwd);
  if (loop) {
    availableServices.push('loop');
    const secretEnv = `${brandEnvPrefix}_LOOP_API_KEY`;
    addEnvRequirement(requiredEnvVars, secretEnv, 'Loop API key');
    if (
      connectorPreferences.loop_mode === 'subscriptions' ||
      connectorPreferences.loop_mode === 'both'
    ) {
      syncableServices.add('loop');
      connectors.push(
        buildConnector({
          connector_key: 'loop-primary',
          connector_type: 'loop',
          direction: 'outbound',
          target: {
            base_url: 'https://api.loopsubscriptions.com/admin/2023-10',
          },
          auth: {
            secret_ref: `env://${secretEnv}`,
          },
          metadata: {
            mode: 'subscriptions',
            source: 'local_cli_sync',
          },
        }),
      );
    }
    if (connectorPreferences.loop_mode === 'returns' || connectorPreferences.loop_mode === 'both') {
      syncableServices.add('loop_returns');
      connectors.push(
        buildConnector({
          connector_key: 'loop-returns-primary',
          connector_type: 'loop_returns',
          direction: 'outbound',
          target: {
            base_url: 'https://api.loopreturns.com/api/v1',
          },
          auth: {
            secret_ref: `env://${secretEnv}`,
          },
          metadata: {
            mode: 'returns',
            source: 'local_cli_sync',
          },
        }),
      );
    }
    if (!hasEnvVar(secretEnv)) {
      warnings.push(
        `Detected local Loop config, but ${secretEnv} is not set in the current shell.`,
      );
    }
  }

  const kbApiKeyPresent = hasEnvVar('STATESET_KB_API_KEY');
  const kbCollection = process.env.STATESET_KB_COLLECTION?.trim();
  const kbBaseUrl = getStateSetKbBaseUrl();
  if (kbApiKeyPresent && kbCollection && kbBaseUrl) {
    availableServices.push('qdrant');
    syncableServices.add('qdrant');
    addEnvRequirement(requiredEnvVars, 'STATESET_KB_API_KEY', 'StateSet KB / Qdrant API key');
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
          collection: kbCollection,
          source: 'local_cli_sync',
        },
      }),
    );
  } else if (kbApiKeyPresent && kbCollection && !kbBaseUrl) {
    warnings.push(
      'Detected local KB config, but STATESET_KB_BASE_URL or STATESET_KB_HOST is not set in the current shell.',
    );
  }

  if (hasEnvVar('OPENAI_API_KEY')) {
    syncableServices.add('openai');
    addEnvRequirement(requiredEnvVars, 'OPENAI_API_KEY', 'OpenAI API key');
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
        metadata: {
          source: 'local_cli_sync',
        },
      }),
    );
  }

  if (hasEnvVar('ANTHROPIC_API_KEY')) {
    syncableServices.add('anthropic');
    addEnvRequirement(requiredEnvVars, 'ANTHROPIC_API_KEY', 'Anthropic API key');
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
        metadata: {
          source: 'local_cli_sync',
        },
      }),
    );
  }

  if (hasEnvVar('MEM0_API_KEY')) {
    syncableServices.add('mem0');
    addEnvRequirement(requiredEnvVars, 'MEM0_API_KEY', 'mem0 API key');
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
        metadata: {
          source: 'local_cli_sync',
        },
      }),
    );
  }

  if (getZendeskConfigFromEnv(cwd)) {
    availableServices.push('zendesk');
    unsupportedServices.push({
      service: 'zendesk',
      connector_type: 'zendesk',
      reason: 'The workflow-studio connector sync path does not manage Zendesk bindings yet.',
    });
  }

  if (getShipStationConfigFromEnv(cwd)) {
    availableServices.push('shipstation');
    unsupportedServices.push({
      service: 'shipstation',
      connector_type: 'shipstation',
      reason: 'ShipStation is not currently covered by the Temporal workflow-studio sync flow.',
    });
  }

  if (getSkioConfigFromEnv(cwd)) {
    availableServices.push('skio');
    unsupportedServices.push({
      service: 'skio',
      connector_type: 'skio',
      reason: 'Skio is not currently supported by the Temporal Rust workflow engine.',
    });
  }

  if (getStayAiConfigFromEnv(cwd)) {
    availableServices.push('stayai');
    unsupportedServices.push({
      service: 'stayai',
      connector_type: 'stay',
      reason: 'Stay.ai is not currently covered by the workflow-studio connector sync path.',
    });
  }

  return {
    brandSlug,
    brandEnvPrefix,
    connectorPreferences,
    availableServices,
    syncableServices: [...syncableServices],
    connectors,
    requiredEnvVars: [...requiredEnvVars.values()],
    unsupportedServices,
    warnings,
  };
}
