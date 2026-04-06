import {
  getGorgiasConfigFromEnv,
  getLoopConfigFromEnv,
  getRechargeConfigFromEnv,
  getShipHeroConfigFromEnv,
  getShopifyConfigFromEnv,
} from '../integrations/config.js';
import {
  buildLocalConnectorSyncPlan,
  type LoopSyncMode,
  type RequiredEnvVar,
} from './workflow-studio-connectors.js';

export type SecretValueSource = 'shell' | 'integration-env' | 'store' | 'missing';
export type SecretRenderFormat = 'dotenv' | 'shell' | 'json';

export interface ConnectorSecretEnvEntry extends RequiredEnvVar {
  connectors: string[];
  available: boolean;
  source: SecretValueSource;
  value?: string;
}

export interface LocalConnectorSecretEnvPlan {
  brandSlug: string;
  brandEnvPrefix: string;
  connectorPreferences: { loop_mode: LoopSyncMode };
  entries: ConnectorSecretEnvEntry[];
  warnings: string[];
}

function readEnvValue(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function detectSource(
  directEnvName: string,
  fallbackEnvNames: string[],
  cwdValue: unknown,
): Exclude<SecretValueSource, 'missing'> | 'missing' {
  if (readEnvValue(directEnvName)) {
    return 'shell';
  }

  for (const envName of fallbackEnvNames) {
    if (readEnvValue(envName)) {
      return 'integration-env';
    }
  }

  return cwdValue ? 'store' : 'missing';
}

function buildConnectorMap(secretRefs: string[]): string[] {
  return [...new Set(secretRefs)].sort();
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function quoteDotenv(value: string): string {
  if (/^[A-Za-z0-9_./:+@=-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function maskSecret(value: string | undefined): string {
  if (!value) return '-';
  if (value.length <= 8) return '*'.repeat(Math.max(value.length, 4));
  return `${value.slice(0, 3)}...${value.slice(-3)}`;
}

function buildEntryMap(
  brandSlug: string,
  loopMode: LoopSyncMode,
  cwd: string,
): Map<string, { value?: string; source: SecretValueSource }> {
  const prefix = brandSlug
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .toUpperCase();
  const entries = new Map<string, { value?: string; source: SecretValueSource }>();

  const shopifyEnv = `${prefix}_SHOPIFY_ACCESS_TOKEN`;
  const shopifyDirect = readEnvValue(shopifyEnv);
  const shopifyConfig = getShopifyConfigFromEnv(cwd);
  entries.set(shopifyEnv, {
    value: shopifyDirect ?? shopifyConfig?.accessToken,
    source: detectSource(
      shopifyEnv,
      [
        'SHOPIFY_ACCESS_TOKEN',
        'SHOPIFY_TOKEN',
        'SHOPIFY_ADMIN_ACCESS_TOKEN',
        'STATESET_SHOPIFY_ACCESS_TOKEN',
      ],
      shopifyConfig,
    ),
  });

  const gorgiasEnv = `${prefix}_GORGIAS_BASIC_TOKEN`;
  const gorgiasDirect = readEnvValue(gorgiasEnv);
  const gorgiasConfig = getGorgiasConfigFromEnv(cwd);
  entries.set(gorgiasEnv, {
    value:
      gorgiasDirect ??
      (gorgiasConfig
        ? Buffer.from(`${gorgiasConfig.email}:${gorgiasConfig.apiKey}`, 'utf-8').toString('base64')
        : undefined),
    source: detectSource(
      gorgiasEnv,
      ['GORGIAS_API_KEY', 'STATESET_GORGIAS_API_KEY'],
      gorgiasConfig,
    ),
  });

  const rechargeEnv = `${prefix}_RECHARGE_ACCESS_TOKEN`;
  const rechargeDirect = readEnvValue(rechargeEnv);
  const rechargeConfig = getRechargeConfigFromEnv(cwd);
  entries.set(rechargeEnv, {
    value: rechargeDirect ?? rechargeConfig?.accessToken,
    source: detectSource(
      rechargeEnv,
      [
        'RECHARGE_ACCESS_TOKEN',
        'RECHARGE_API_TOKEN',
        'RECHARGE_API_KEY',
        'STATESET_RECHARGE_ACCESS_TOKEN',
      ],
      rechargeConfig,
    ),
  });

  const shipHeroEnv = `${prefix}_SHIPHERO_ACCESS_TOKEN`;
  const shipHeroDirect = readEnvValue(shipHeroEnv);
  const shipHeroConfig = getShipHeroConfigFromEnv(cwd);
  entries.set(shipHeroEnv, {
    value: shipHeroDirect ?? shipHeroConfig?.accessToken,
    source: detectSource(
      shipHeroEnv,
      ['SHIPHERO_ACCESS_TOKEN', 'STATESET_SHIPHERO_ACCESS_TOKEN'],
      shipHeroConfig,
    ),
  });

  const loopEnv = `${prefix}_LOOP_API_KEY`;
  const loopDirect = readEnvValue(loopEnv);
  const loopConfig = getLoopConfigFromEnv(cwd);
  if (loopMode === 'subscriptions' || loopMode === 'returns' || loopMode === 'both') {
    entries.set(loopEnv, {
      value: loopDirect ?? loopConfig?.apiKey,
      source: detectSource(loopEnv, ['LOOP_API_KEY', 'STATESET_LOOP_API_KEY'], loopConfig),
    });
  }

  for (const sharedEnv of [
    'STATESET_KB_API_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'MEM0_API_KEY',
  ]) {
    const value = readEnvValue(sharedEnv);
    entries.set(sharedEnv, {
      value,
      source: value ? 'shell' : 'missing',
    });
  }

  return entries;
}

export function buildLocalConnectorSecretEnvPlan(
  brandSlug: string,
  rawPreferences: unknown = {},
  cwd: string = process.cwd(),
): LocalConnectorSecretEnvPlan {
  const connectorPlan = buildLocalConnectorSyncPlan(brandSlug, rawPreferences, cwd);
  const connectorRefs = new Map<string, string[]>();
  for (const connector of connectorPlan.connectors) {
    const secretRef = connector.auth.secret_ref;
    if (!secretRef.startsWith('env://')) {
      continue;
    }
    const envName = secretRef.replace(/^env:\/\//, '');
    const list = connectorRefs.get(envName) ?? [];
    list.push(connector.connector_key);
    connectorRefs.set(envName, list);
  }

  const secretValues = buildEntryMap(brandSlug, connectorPlan.connectorPreferences.loop_mode, cwd);
  const entries = connectorPlan.requiredEnvVars.map((required) => {
    const resolved = secretValues.get(required.name);
    const value = resolved?.value;
    return {
      ...required,
      connectors: buildConnectorMap(connectorRefs.get(required.name) ?? []),
      available: Boolean(value),
      source: resolved?.source ?? 'missing',
      value,
    };
  });

  const warnings = [...connectorPlan.warnings];
  const missing = entries.filter((entry) => !entry.available);
  if (missing.length > 0) {
    warnings.push(
      `Missing ${missing.length} required secret env var(s): ${missing.map((entry) => entry.name).join(', ')}`,
    );
  }

  return {
    brandSlug: connectorPlan.brandSlug,
    brandEnvPrefix: connectorPlan.brandEnvPrefix,
    connectorPreferences: connectorPlan.connectorPreferences,
    entries,
    warnings,
  };
}

export function renderLocalConnectorSecretEnvPlan(
  plan: LocalConnectorSecretEnvPlan,
  format: SecretRenderFormat,
): string {
  if (format === 'json') {
    return `${JSON.stringify(
      {
        brand_slug: plan.brandSlug,
        brand_env_prefix: plan.brandEnvPrefix,
        loop_mode: plan.connectorPreferences.loop_mode,
        entries: plan.entries.map((entry) => ({
          env: entry.name,
          value: entry.value ?? null,
          source: entry.source,
          purpose: entry.purpose,
          connectors: entry.connectors,
        })),
      },
      null,
      2,
    )}\n`;
  }

  const lines: string[] = [
    `# Generated by response CLI for brand ${plan.brandSlug}`,
    `# loop_mode=${plan.connectorPreferences.loop_mode}`,
  ];
  for (const entry of plan.entries) {
    if (!entry.available || entry.value === undefined) {
      lines.push(`# Missing ${entry.name} (${entry.purpose})`);
      lines.push(`# ${entry.name}=`);
      continue;
    }

    if (format === 'shell') {
      lines.push(`export ${entry.name}=${quoteShell(entry.value)}`);
      continue;
    }

    lines.push(`${entry.name}=${quoteDotenv(entry.value)}`);
  }
  return `${lines.join('\n')}\n`;
}

export function maskConnectorSecretEntries(
  entries: ConnectorSecretEnvEntry[],
): Array<Record<string, string>> {
  return entries.map((entry) => ({
    env: entry.name,
    available: entry.available ? 'yes' : 'no',
    source: entry.source,
    connectors: entry.connectors.join(',') || '-',
    value_preview: maskSecret(entry.value),
    purpose: entry.purpose,
  }));
}
