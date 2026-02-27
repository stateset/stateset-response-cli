import fs from 'node:fs';
import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import {
  listIntegrations,
  type IntegrationDefinition,
  type IntegrationId,
} from '../integrations/registry.js';
import {
  loadIntegrationsStore,
  loadIntegrationsStoreForScope,
  saveIntegrationsStore,
  type IntegrationEntry,
  type IntegrationStoreScope,
} from '../integrations/store.js';
import { getSessionsDir } from '../session.js';
import { formatSuccess, formatWarning, formatTable } from '../utils/display.js';
import { readIntegrationTelemetry, readToolAudit } from './audit.js';
import type { ToolAuditEntry } from './types.js';
import { readFirstEnvValue } from './utils.js';

type FieldSource = 'env' | 'store' | 'default' | 'none';
type HealthStatus = 'ready' | 'degraded' | 'disabled' | 'not-configured' | 'invalid-config';
type ConfigStatus = 'configured' | 'disabled' | 'empty' | 'not configured';

interface ResolvedField {
  key: string;
  required: boolean;
  source: FieldSource;
  hasValue: boolean;
  value?: string;
}

interface IntegrationSnapshot {
  id: IntegrationId;
  label: string;
  envStatus: string;
  configStatus: ConfigStatus;
  scope: string;
  configKeys: number;
  requiredTotal: number;
  requiredSatisfied: number;
  missingRequired: string[];
  source: string;
  updatedAt: string;
  url: string;
  urlStatus: 'ok' | 'invalid' | 'n/a';
  health: HealthStatus;
}

export interface IntegrationsSetupOptions {
  target?: string;
  fromEnv?: boolean;
  validateOnly?: boolean;
  scope?: IntegrationStoreScope;
}

const SOURCE_ORDER: FieldSource[] = ['env', 'store', 'default'];
const RATE_LIMIT_MARKERS = ['429', 'rate limit', 'too many requests', 'retry-after'];
const MAX_LOG_ROWS = 200;

const TOOL_PREFIX_BY_INTEGRATION: Record<IntegrationId, string> = {
  shopify: 'shopify_',
  gorgias: 'gorgias_',
  recharge: 'recharge_',
  skio: 'skio_',
  stayai: 'stayai_',
  amazon: 'amazon_',
  dhl: 'dhl_',
  globale: 'globale_',
  fedex: 'fedex_',
  klaviyo: 'klaviyo_',
  loop: 'loop_',
  shipstation: 'shipstation_',
  shiphero: 'shiphero_',
  shipfusion: 'shipfusion_',
  shiphawk: 'shiphawk_',
  zendesk: 'zendesk_',
};

function normalizeConfigStatus(entry: IntegrationEntry | undefined): ConfigStatus {
  if (!entry) return 'not configured';
  if (entry.enabled === false) return 'disabled';
  if (entry.config && Object.keys(entry.config).length > 0) return 'configured';
  return 'empty';
}

function resolveField(
  def: IntegrationDefinition,
  entry: IntegrationEntry | undefined,
): ResolvedField[] {
  return def.fields.map((field) => {
    const envValue = (readFirstEnvValue(field.envVars) || '').trim();
    if (envValue) {
      return {
        key: field.key,
        required: field.required !== false,
        source: 'env',
        hasValue: true,
        value: envValue,
      };
    }

    const storeValue = (entry?.config?.[field.key] || '').trim();
    if (storeValue) {
      return {
        key: field.key,
        required: field.required !== false,
        source: 'store',
        hasValue: true,
        value: storeValue,
      };
    }

    const defaultValue = (field.defaultValue || '').trim();
    if (defaultValue) {
      return {
        key: field.key,
        required: field.required !== false,
        source: 'default',
        hasValue: true,
        value: defaultValue,
      };
    }

    return {
      key: field.key,
      required: field.required !== false,
      source: 'none',
      hasValue: false,
    };
  });
}

function summarizeSources(fields: ResolvedField[]): string {
  const active = new Set<FieldSource>();
  for (const field of fields) {
    if (field.source !== 'none') {
      active.add(field.source);
    }
  }
  if (active.size === 0) return 'none';
  const parts = SOURCE_ORDER.filter((source) => active.has(source));
  return parts.join('+');
}

function validateUrl(raw: string | undefined): { value: string; status: 'ok' | 'invalid' | 'n/a' } {
  const value = (raw || '').trim();
  if (!value) {
    return { value: '-', status: 'n/a' };
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return { value, status: 'ok' };
    }
  } catch {
    return { value, status: 'invalid' };
  }
  return { value, status: 'invalid' };
}

function deriveHealthStatus(
  configStatus: ConfigStatus,
  requiredTotal: number,
  requiredSatisfied: number,
  urlStatus: 'ok' | 'invalid' | 'n/a',
  source: string,
): HealthStatus {
  if (configStatus === 'disabled') return 'disabled';
  if (urlStatus === 'invalid') return 'invalid-config';
  if (requiredTotal > 0 && requiredSatisfied === requiredTotal) return 'ready';
  if (source === 'none' && configStatus === 'not configured') return 'not-configured';
  return 'degraded';
}

function resolveIntegrationIdFromTool(toolName: string): IntegrationId | null {
  const lower = toolName.toLowerCase();
  const entries = Object.entries(TOOL_PREFIX_BY_INTEGRATION) as Array<[IntegrationId, string]>;
  for (const [id, prefix] of entries) {
    if (lower.startsWith(prefix)) {
      return id;
    }
  }
  return null;
}

function isRateLimited(entry: ToolAuditEntry): boolean {
  if (!entry.isError) return false;
  const haystack = `${entry.reason || ''} ${entry.resultExcerpt || ''}`.toLowerCase();
  return RATE_LIMIT_MARKERS.some((marker) => haystack.includes(marker));
}

function toTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return '-';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toISOString();
}

function loadIntegrationSnapshots(cwd: string, integrationId?: string): IntegrationSnapshot[] {
  const lowerTarget = (integrationId || '').trim().toLowerCase();
  const definitions = listIntegrations().filter((def) => {
    if (!lowerTarget) return true;
    return def.id.toLowerCase() === lowerTarget || def.label.toLowerCase() === lowerTarget;
  });
  const { scope, store } = loadIntegrationsStore(cwd);

  return definitions.map((def) => {
    const entry = store.integrations[def.id];
    const fields = resolveField(def, entry);
    const required = fields.filter((field) => field.required);
    const requiredSatisfied = required.filter((field) => field.hasValue).length;
    const missingRequired = required.filter((field) => !field.hasValue).map((field) => field.key);
    const source = summarizeSources(fields);
    const configStatus = normalizeConfigStatus(entry);
    const configKeys = entry?.config ? Object.keys(entry.config).length : 0;
    const updatedAt = entry?.updatedAt || '-';

    const urlField = fields.find((field) => /baseurl|endpoint|host/i.test(field.key));
    const { value: url, status: urlStatus } = validateUrl(urlField?.value);
    const health = deriveHealthStatus(
      configStatus,
      required.length,
      requiredSatisfied,
      urlStatus,
      source,
    );

    return {
      id: def.id,
      label: def.label,
      envStatus: getIntegrationEnvStatus(def).status,
      configStatus,
      scope: scope || 'none',
      configKeys,
      requiredTotal: required.length,
      requiredSatisfied,
      missingRequired,
      source,
      updatedAt,
      url,
      urlStatus,
      health,
    };
  });
}

function loadIntegrationAuditEntries(): Array<ToolAuditEntry & { integrationId: IntegrationId }> {
  const sessionsDir = getSessionsDir();
  const dedupe = new Set<string>();
  const allEntries: Array<ToolAuditEntry & { integrationId: IntegrationId }> = [];

  const register = (entry: ToolAuditEntry) => {
    const integrationId = resolveIntegrationIdFromTool(entry.name);
    if (!integrationId) return;
    const key = `${entry.ts}|${entry.type}|${entry.session}|${entry.name}|${entry.durationMs || 0}`;
    if (dedupe.has(key)) return;
    dedupe.add(key);
    allEntries.push({ ...entry, integrationId });
  };

  for (const entry of readIntegrationTelemetry()) {
    register(entry);
  }

  if (fs.existsSync(sessionsDir)) {
    let sessions: fs.Dirent[] = [];
    try {
      sessions = fs.readdirSync(sessionsDir, { withFileTypes: true });
    } catch {
      return allEntries;
    }

    for (const session of sessions) {
      if (!session.isDirectory()) continue;
      const auditEntries = readToolAudit(session.name);
      for (const entry of auditEntries) {
        register(entry);
      }
    }
  }

  return allEntries;
}

export function getIntegrationEnvStatus(def: IntegrationDefinition): {
  status: string;
  anySet: boolean;
} {
  const requiredFields = def.fields.filter((field) => field.required !== false);
  const requiredSet = requiredFields.filter((field) =>
    Boolean(readFirstEnvValue(field.envVars)),
  ).length;
  const anySet = def.fields.some((field) => Boolean(readFirstEnvValue(field.envVars)));
  if (!anySet) return { status: '-', anySet };
  if (requiredSet === requiredFields.length) return { status: 'set', anySet };
  return { status: 'partial', anySet };
}

export function printIntegrationStatus(cwd: string): void {
  const snapshots = loadIntegrationSnapshots(cwd);
  const { path: storePath } = loadIntegrationsStore(cwd);
  const rows = snapshots.map((snapshot) => {
    const config =
      snapshot.configStatus === 'not configured'
        ? '-'
        : `${snapshot.configStatus} (${snapshot.scope})`;
    return {
      integration: snapshot.label,
      env: snapshot.envStatus,
      config,
    };
  });

  console.log(formatSuccess('Integration status'));
  console.log(formatTable(rows, ['integration', 'env', 'config']));
  if (storePath) {
    console.log(chalk.gray(`  Config file: ${storePath}`));
  } else {
    console.log(chalk.gray('  No integrations config file found.'));
  }
  console.log(chalk.gray('  Tip: run "response integrations setup" to configure.'));
}

export function printIntegrationHealth(
  cwd: string,
  integrationId?: string,
  detailed = false,
): void {
  const snapshots = loadIntegrationSnapshots(cwd, integrationId);
  if (snapshots.length === 0) {
    console.log(formatWarning(`Integration not found: ${integrationId}`));
    return;
  }

  const rows = snapshots.map((snapshot) => {
    const baseRow: Record<string, string> = {
      integration: snapshot.label,
      health: snapshot.health,
      required: `${snapshot.requiredSatisfied}/${snapshot.requiredTotal}`,
      source: snapshot.source,
    };
    if (!detailed) {
      return baseRow;
    }
    return {
      ...baseRow,
      id: snapshot.id,
      env: snapshot.envStatus,
      config: snapshot.configStatus,
      missing: snapshot.missingRequired.length ? snapshot.missingRequired.join(',') : '-',
      configKeys: String(snapshot.configKeys),
      scope: snapshot.scope,
      url: snapshot.url,
      urlStatus: snapshot.urlStatus,
      updatedAt: snapshot.updatedAt,
    };
  });

  const columns = detailed
    ? [
        'integration',
        'id',
        'health',
        'required',
        'missing',
        'source',
        'env',
        'config',
        'configKeys',
        'scope',
        'url',
        'urlStatus',
        'updatedAt',
      ]
    : ['integration', 'health', 'required', 'source'];
  console.log(formatSuccess('Integration health'));
  console.log(formatTable(rows, columns));
  if (detailed) {
    console.log(
      chalk.gray(
        '  Health combines required-field coverage, source resolution, and URL validation.',
      ),
    );
  }
}

export function printIntegrationLimits(cwd: string, integrationId?: string): void {
  const snapshots = loadIntegrationSnapshots(cwd, integrationId);
  if (snapshots.length === 0) {
    console.log(formatWarning(`Integration not found: ${integrationId}`));
    return;
  }
  const auditEntries = loadIntegrationAuditEntries();
  const limitsRows = snapshots.map((snapshot) => {
    const rows = auditEntries.filter((entry) => entry.integrationId === snapshot.id);
    const callCount = rows.filter((entry) => entry.type === 'tool_call').length;
    const errorCount = rows.filter((entry) => entry.type === 'tool_result' && entry.isError).length;
    const rateLimited = rows.filter(
      (entry) => entry.type === 'tool_result' && isRateLimited(entry),
    );
    const lastRateLimit = rateLimited.sort((a, b) => toTimestamp(b.ts) - toTimestamp(a.ts))[0];
    const lastSeen = rows.sort((a, b) => toTimestamp(b.ts) - toTimestamp(a.ts))[0];
    return {
      integration: snapshot.label,
      id: snapshot.id,
      calls: String(callCount),
      errors: String(errorCount),
      rateLimited: String(rateLimited.length),
      lastRateLimit: formatTimestamp(lastRateLimit?.ts),
      lastSeen: formatTimestamp(lastSeen?.ts),
    };
  });
  console.log(formatSuccess('Integration limits'));
  console.log(
    formatTable(limitsRows, [
      'integration',
      'calls',
      'errors',
      'rateLimited',
      'lastRateLimit',
      'lastSeen',
    ]),
  );
  if (auditEntries.length === 0) {
    console.log(
      chalk.gray('  No audit history found. Enable tool audit to populate rate-limit telemetry.'),
    );
  }
}

export function printIntegrationLogs(cwd: string, integrationId?: string, last = 20): void {
  const snapshots = loadIntegrationSnapshots(cwd, integrationId);
  if (snapshots.length === 0) {
    console.log(formatWarning(`Integration not found: ${integrationId}`));
    return;
  }

  const auditEntries = loadIntegrationAuditEntries();
  const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const filtered = auditEntries.filter((entry) => snapshotById.has(entry.integrationId));
  if (filtered.length === 0) {
    console.log(formatWarning('No integration audit events found.'));
    console.log(chalk.gray('  Enable tool audit with "/audit on" or STATESET_TOOL_AUDIT=true.'));
    return;
  }

  const limit = Number.isFinite(last) && last > 0 ? Math.min(Math.floor(last), MAX_LOG_ROWS) : 20;
  const recent = filtered.sort((a, b) => toTimestamp(b.ts) - toTimestamp(a.ts)).slice(0, limit);

  if (integrationId) {
    const rows = recent.map((entry) => ({
      time: formatTimestamp(entry.ts),
      session: entry.session || '-',
      tool: entry.name,
      type: entry.type,
      status: entry.isError ? 'error' : 'ok',
      duration: entry.durationMs ? `${entry.durationMs}ms` : '-',
    }));
    console.log(formatSuccess(`Integration logs (${rows.length} events)`));
    console.log(formatTable(rows, ['time', 'session', 'tool', 'type', 'status', 'duration']));
    return;
  }

  const rows = recent.map((entry) => ({
    time: formatTimestamp(entry.ts),
    integration: snapshotById.get(entry.integrationId)?.label || entry.integrationId,
    session: entry.session || '-',
    tool: entry.name,
    status: entry.isError ? 'error' : 'ok',
    duration: entry.durationMs ? `${entry.durationMs}ms` : '-',
  }));
  console.log(formatSuccess(`Integration logs (${rows.length} events)`));
  console.log(formatTable(rows, ['time', 'integration', 'session', 'tool', 'status', 'duration']));
}

export async function runIntegrationsSetup(
  cwd: string,
  options: IntegrationsSetupOptions = {},
): Promise<void> {
  const { scope: existingScope } = loadIntegrationsStore(cwd);

  let scope: IntegrationStoreScope;
  if (options.scope) {
    scope = options.scope;
  } else if (options.validateOnly) {
    scope = existingScope ?? 'global';
  } else {
    const scopeAnswer = await inquirer.prompt([
      {
        type: 'list',
        name: 'scope',
        message: 'Where should integration settings be saved?',
        choices: [
          { name: 'Global (~/.stateset/integrations.json)', value: 'global' },
          { name: 'Project (.stateset/integrations.json)', value: 'local' },
        ],
        default: existingScope ?? 'global',
      },
    ]);
    scope = scopeAnswer.scope as IntegrationStoreScope;
  }

  const { store } = loadIntegrationsStoreForScope(cwd, scope);
  const definitions = listIntegrations();
  const normalizedTarget = (options.target || '').trim().toLowerCase();
  const targetDefinitions = normalizedTarget
    ? definitions.filter(
        (def) =>
          def.id.toLowerCase() === normalizedTarget || def.label.toLowerCase() === normalizedTarget,
      )
    : definitions;

  if (normalizedTarget && targetDefinitions.length === 0) {
    throw new Error(`Integration not found: ${options.target}`);
  }

  const defaults = targetDefinitions
    .filter((def) => store.integrations[def.id]?.enabled)
    .map((def) => def.id);

  let selectedIds: IntegrationId[] = [];
  if (normalizedTarget) {
    selectedIds = targetDefinitions.map((def) => def.id);
  } else if (options.validateOnly) {
    selectedIds = targetDefinitions.map((def) => def.id);
  } else {
    const answer = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selected',
        message: 'Select integrations to configure',
        pageSize: Math.min(12, targetDefinitions.length),
        choices: targetDefinitions.map((def) => ({
          name: `${def.label} — ${def.description}`,
          value: def.id,
          checked: defaults.includes(def.id),
        })),
      },
    ]);
    selectedIds = (answer.selected as IntegrationId[]) ?? [];
  }
  const selectedSet = new Set(selectedIds);

  const disableCandidates = targetDefinitions
    .filter((def) => store.integrations[def.id] && !selectedSet.has(def.id))
    .map((def) => def.id);
  let disableOthers = false;
  if (!options.validateOnly && disableCandidates.length > 0) {
    const response = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'disable',
        message: 'Disable integrations that were not selected?',
        default: true,
      },
    ]);
    disableOthers = Boolean(response.disable);
  }

  const validationRows: Array<{
    integration: string;
    required: string;
    missing: string;
    status: string;
  }> = [];

  for (const def of targetDefinitions) {
    const existing = store.integrations[def.id]?.config ?? {};
    if (!selectedSet.has(def.id)) {
      if (!options.validateOnly && disableOthers && store.integrations[def.id]) {
        store.integrations[def.id] = {
          ...store.integrations[def.id],
          enabled: false,
          updatedAt: new Date().toISOString(),
        };
      }
      continue;
    }

    const nextConfig: Record<string, string> = { ...existing };
    const missingRequired: string[] = [];

    for (const field of def.fields) {
      const envValue = (readFirstEnvValue(field.envVars) || '').trim();
      const existingValue = existing[field.key];
      const defaultValue = existingValue || field.defaultValue || '';
      const required = field.required !== false;

      if (options.fromEnv && envValue) {
        nextConfig[field.key] = envValue;
        continue;
      }

      const hasRequiredCoverage = Boolean(envValue || existingValue || defaultValue);
      if (required && hasRequiredCoverage) {
        if (existingValue) {
          nextConfig[field.key] = existingValue;
        } else if (defaultValue) {
          nextConfig[field.key] = defaultValue;
        }
        continue;
      }

      if (options.validateOnly) {
        if (required && !hasRequiredCoverage) {
          missingRequired.push(field.key);
        }
        continue;
      }

      const isSecret = Boolean(field.secret);
      const envHint = field.envVars[0] ? ` (${field.envVars[0]})` : '';
      const promptLabel = `${def.label}: ${field.label}${envHint}`;
      const prompt = {
        type: isSecret ? 'password' : 'input',
        name: field.key,
        message:
          existingValue && isSecret ? `${promptLabel} (leave blank to keep existing)` : promptLabel,
        default: isSecret ? undefined : defaultValue,
        mask: isSecret ? '*' : undefined,
        validate: (value: string) => {
          const trimmed = String(value ?? '').trim();
          if (trimmed) return true;
          if (envValue) return true;
          if (existingValue) return true;
          if (field.defaultValue) return true;
          if (field.required === false) return true;
          return `${field.label} is required.`;
        },
      } as const;

      const answers = await inquirer.prompt([prompt]);
      const raw = String(answers[field.key] ?? '').trim();
      if (raw) {
        nextConfig[field.key] = raw;
      } else if (!raw && existingValue) {
        nextConfig[field.key] = existingValue;
      } else if (!raw && envValue && options.fromEnv) {
        nextConfig[field.key] = envValue;
      } else if (!raw && field.defaultValue && !nextConfig[field.key]) {
        nextConfig[field.key] = field.defaultValue;
      }
    }

    if (options.validateOnly) {
      const requiredCount = def.fields.filter((field) => field.required !== false).length;
      validationRows.push({
        integration: def.label,
        required: String(requiredCount),
        missing: missingRequired.length > 0 ? missingRequired.join(',') : '-',
        status: missingRequired.length > 0 ? 'missing' : 'ok',
      });
      continue;
    }

    store.integrations[def.id] = {
      enabled: true,
      config: nextConfig,
      updatedAt: new Date().toISOString(),
    };
  }

  if (options.validateOnly) {
    const hasMissing = validationRows.some((row) => row.status !== 'ok');
    console.log(formatSuccess('Integration validation'));
    console.log(formatTable(validationRows, ['integration', 'required', 'missing', 'status']));
    if (hasMissing) {
      console.log(
        formatWarning(
          'Some integrations are missing required values. Re-run setup with --from-env or provide values interactively.',
        ),
      );
    } else {
      console.log(chalk.gray('  All selected integrations have required fields configured.'));
    }
    return;
  }

  const filePath = saveIntegrationsStore(cwd, scope, store);
  console.log(formatSuccess(`Saved integrations to ${filePath}`));
  const enabled = targetDefinitions
    .filter((def) => store.integrations[def.id]?.enabled)
    .map((def) => def.label);
  console.log(chalk.gray(`  Enabled: ${enabled.length ? enabled.join(', ') : 'none'}`));
  console.log(chalk.gray('  Environment variables always override stored settings.'));
}

export function registerIntegrationsCommands(program: Command): void {
  const integrations = program
    .command('integrations')
    .description('Configure and inspect integrations');

  integrations
    .command('status')
    .description('Show integration configuration status')
    .action(() => {
      printIntegrationStatus(process.cwd());
    });

  integrations
    .command('setup')
    .description('Interactive integration configuration wizard')
    .argument('[integration]', 'Integration id or label (optional)')
    .option('--from-env', 'Prefill values from environment variables when available')
    .option('--validate-only', 'Validate required fields without writing config')
    .option('--scope <scope>', 'Config scope: global or local')
    .action(
      async (
        integration: string | undefined,
        opts: { fromEnv?: boolean; validateOnly?: boolean; scope?: string },
      ) => {
        const requestedScope = opts.scope?.trim().toLowerCase();
        if (requestedScope && requestedScope !== 'global' && requestedScope !== 'local') {
          console.log(formatWarning('Scope must be "global" or "local".'));
          process.exitCode = 1;
          return;
        }
        await runIntegrationsSetup(process.cwd(), {
          target: integration,
          fromEnv: Boolean(opts.fromEnv),
          validateOnly: Boolean(opts.validateOnly),
          scope: requestedScope as IntegrationStoreScope | undefined,
        });
      },
    );

  integrations
    .command('edit')
    .description('Open the integrations config file path')
    .action(() => {
      const { scope, path: storePath } = loadIntegrationsStore(process.cwd());
      if (!storePath) {
        const defaultPath = loadIntegrationsStoreForScope(process.cwd(), 'global').path;
        console.log(formatWarning('No integrations config file found.'));
        console.log(chalk.gray(`  Default path: ${defaultPath}`));
        return;
      }
      console.log(formatSuccess(`Integrations config (${scope}): ${storePath}`));
    });

  integrations
    .command('health')
    .description('Show integration health and connectivity')
    .argument('[integration]', 'Integration id (optional)')
    .option('--detailed', 'Include resolved field diagnostics')
    .action((integration: string | undefined, opts: { detailed?: boolean }) => {
      printIntegrationHealth(process.cwd(), integration, Boolean(opts.detailed));
    });

  integrations
    .command('limits')
    .description('Show API rate limits and quotas')
    .argument('[integration]', 'Integration id (optional)')
    .action((integration: string | undefined) => {
      printIntegrationLimits(process.cwd(), integration);
    });

  integrations
    .command('logs')
    .description('Show integration event logs')
    .argument('[integration]', 'Integration id (optional)')
    .option('--last <n>', 'Number of recent log rows')
    .action((integration: string | undefined, opts: { last?: string }) => {
      const count = opts.last ? Number.parseInt(opts.last, 10) : undefined;
      printIntegrationLogs(process.cwd(), integration, count);
    });
}
