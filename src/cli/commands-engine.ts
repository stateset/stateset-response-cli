import chalk from 'chalk';
import inquirer from 'inquirer';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ChatContext, CommandResult } from './types.js';
import {
  loadConfig,
  saveConfig,
  configExists,
  getWorkflowEngineConfig,
  type WorkflowEngineConfig,
} from '../config.js';
import { EngineClient, EngineClientError } from '../lib/engine-client.js';
import { formatTable } from '../utils/display.js';
import { handleOnboardCommand } from './commands-onboard.js';
import {
  pullBrandStudioConfig,
  pushBrandStudioConfig,
  validateBrandStudioConfig,
} from './engine-config.js';
import {
  brandStudioExists,
  buildBrandStudioBundle,
  loadBrandStudioBundle,
  type BrandStudioBundle,
  writeBrandStudioBundle,
} from '../lib/brand-studio.js';
import { buildDefaultManifest } from '../lib/manifest-builder.js';
import {
  buildLocalConnectorSyncPlan,
  getConnectorPreferencesFromMetadata,
  mergeConnectorPreferencesIntoMetadata,
  mergeConnectorSpecs,
  type LocalConnectorSyncPlan,
  type LoopSyncMode,
} from '../lib/workflow-studio-connectors.js';
import {
  buildBootstrapBinding,
  buildResponseAutomationBinding,
  createWorkflowStudioAutomationConfigFromTemplate,
  findResponseAutomationBinding,
  isWorkflowStudioTemplateId,
  listWorkflowStudioTemplateIds,
  type WorkflowStudioTemplateId,
} from '../lib/workflow-studio-bootstrap.js';
import {
  buildLocalConnectorSecretEnvPlan,
  maskConnectorSecretEntries,
  renderLocalConnectorSecretEnvPlan,
  type SecretRenderFormat,
} from '../lib/workflow-studio-secret-env.js';
import {
  buildPlatformConnectorSyncPlanFromCredentials,
  fetchCurrentOrgPlatformConnectorCredentials,
} from '../lib/workflow-studio-platform-sync.js';
import {
  buildLocalStackApplyCommand,
  parseLocalStackServices,
} from '../lib/workflow-studio-local-stack.js';
import { resolveSafeOutputPath, writePrivateTextFile } from './utils.js';
import { parseCommandArgs } from './shortcuts/utils.js';
import {
  asItems,
  connectorIdentity,
  formatDateTime,
  formatJsonBlock,
  getBrandDisplayName,
  getBrandId,
  getBrandSlug,
  isObject,
  parseConfigVersion,
  printNotConfigured,
  readJsonObjectFromFile,
  resolveInputPath,
  resolveRemoteBrand,
  sleep,
  type RemoteBrandRecord,
} from './engine-support.js';
import {
  listOnboardingRunsView,
  resolveBrandDlqItem,
  retryBrandDlqItem,
  showBrandDlq,
  showOnboardingRunView,
  startOnboardingRun,
  updateOnboardingRunView,
} from './engine-onboarding-dlq.js';

export {
  listOnboardingRunsView,
  resolveBrandDlqItem,
  retryBrandDlqItem,
  showBrandDlq,
  showOnboardingRunView,
  startOnboardingRun,
  updateOnboardingRunView,
};

const NOT_HANDLED: CommandResult = { handled: false };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEST_STATUS_POLL_DELAYS_MS = [0, 250, 750];
type ConnectorSyncSource = 'local' | 'platform';

function parseLoopMode(value: string | undefined): LoopSyncMode | undefined {
  if (value === 'subscriptions' || value === 'returns' || value === 'both') {
    return value;
  }
  return undefined;
}

function parseSecretRenderFormat(value: string | undefined): SecretRenderFormat | undefined {
  if (value === 'dotenv' || value === 'shell' || value === 'json') {
    return value;
  }
  return undefined;
}

function parseConnectorSyncSource(value: string | undefined): ConnectorSyncSource | undefined {
  if (value === 'local' || value === 'platform') {
    return value;
  }
  return undefined;
}

function slugToDisplayName(slug: string): string {
  return slug
    .split(/[-_]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatOptionalNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '-';
}

function formatRatio(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '-';
}

function normalizeDispatchGuardThreshold(value: string | undefined): 'warning' | 'critical' {
  return value === 'warning' ? 'warning' : 'critical';
}

function parseWorkflowStudioTemplate(value: unknown): WorkflowStudioTemplateId | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!isWorkflowStudioTemplateId(normalized)) {
    throw new Error(
      `Unknown workflow-studio template "${value}". Expected one of: ${listWorkflowStudioTemplateIds().join(', ')}`,
    );
  }

  return normalized;
}

function printValidationReport(label: string, value: unknown): boolean {
  if (!isObject(value)) {
    console.log(chalk.gray(`  ${JSON.stringify(value, null, 2)}`));
    return false;
  }

  const valid = value.valid === true;
  const errors = Array.isArray(value.errors) ? value.errors.map(String) : [];
  const warnings = Array.isArray(value.warnings) ? value.warnings.map(String) : [];
  const checks = Array.isArray(value.checks)
    ? value.checks.filter(isObject).map((check) => ({
        code: String(check.code ?? '-'),
        ok: check.ok === true ? 'yes' : 'no',
        message: String(check.message ?? '-'),
      }))
    : [];

  console.log(chalk.bold(`  Validation: ${label}`));
  console.log(chalk[valid ? 'green' : 'yellow'](`  Valid: ${valid ? 'yes' : 'no'}`));

  if (errors.length > 0) {
    console.log(chalk.red(`  Errors (${errors.length})`));
    for (const error of errors) {
      console.log(chalk.red(`  - ${error}`));
    }
  }

  if (warnings.length > 0) {
    console.log(chalk.yellow(`  Warnings (${warnings.length})`));
    for (const warning of warnings) {
      console.log(chalk.yellow(`  - ${warning}`));
    }
  }

  if (checks.length > 0) {
    console.log(formatTable(checks, ['code', 'ok', 'message']));
  }

  return valid;
}

function normalizeCreateBrandPayload(
  payload: Record<string, unknown>,
  tenantId?: string,
): { payload: Record<string, unknown>; templateId?: WorkflowStudioTemplateId } {
  const nextPayload: Record<string, unknown> = { ...payload };
  const templateId = parseWorkflowStudioTemplate(nextPayload.template);
  delete nextPayload.template;

  if (!nextPayload.tenant_id && tenantId) {
    nextPayload.tenant_id = tenantId;
  }
  if (!nextPayload.tenant_id) {
    throw new Error(
      'Brand create requires tenant_id. Set WORKFLOW_ENGINE_TENANT_ID in CLI config or include tenant_id in the JSON payload.',
    );
  }

  if ('connector_preferences' in nextPayload) {
    nextPayload.metadata = mergeConnectorPreferencesIntoMetadata(
      nextPayload.metadata,
      nextPayload.connector_preferences,
    );
    delete nextPayload.connector_preferences;
  }

  return { payload: nextPayload, templateId };
}

function normalizeUpdateBrandPayload(
  payload: Record<string, unknown>,
  currentMetadata: unknown,
): Record<string, unknown> {
  const nextPayload: Record<string, unknown> = { ...payload };
  if ('connector_preferences' in nextPayload) {
    const baseMetadata = {
      ...(isObject(currentMetadata) ? currentMetadata : {}),
      ...(isObject(nextPayload.metadata) ? nextPayload.metadata : {}),
    };
    nextPayload.metadata = mergeConnectorPreferencesIntoMetadata(
      baseMetadata,
      nextPayload.connector_preferences,
    );
    delete nextPayload.connector_preferences;
  }
  return nextPayload;
}

export async function showEngineStatus(): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  console.log(chalk.bold('  Workflow Engine'));
  console.log(chalk.gray(`  URL:       ${config.url}`));
  console.log(chalk.gray(`  API Key:   ${'*'.repeat(8)}...${config.apiKey.slice(-4)}`));
  if (config.tenantId) {
    console.log(chalk.gray(`  Tenant ID: ${config.tenantId}`));
  }

  const client = new EngineClient(config);
  try {
    await client.health();
    console.log(chalk.green('  Status:    connected'));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Status:    unreachable (${msg})`));
  }
}

async function runSetup(ctx: ChatContext): Promise<void> {
  if (!configExists()) {
    console.log(chalk.red('  No CLI config found. Run "response auth login" first.'));
    return;
  }

  const cfg = loadConfig();
  const org = cfg.organizations[cfg.currentOrg];
  if (!org) {
    console.log(chalk.red(`  Organization "${cfg.currentOrg}" not found in config.`));
    return;
  }

  const existing = org.workflowEngine;
  const defaults = {
    url: existing?.url || process.env.WORKFLOW_ENGINE_URL || '',
    apiKey: existing?.apiKey || process.env.WORKFLOW_ENGINE_API_KEY || '',
    tenantId: existing?.tenantId || process.env.WORKFLOW_ENGINE_TENANT_ID || '',
  };

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'url',
      message: 'Workflow engine URL:',
      default: defaults.url || 'http://localhost:8080',
      validate: (input: string) => {
        try {
          const parsed = new URL(input);
          if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return 'Must be an HTTP(S) URL';
          }
          return true;
        } catch {
          return 'Invalid URL';
        }
      },
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'Workflow engine API key:',
      default: defaults.apiKey,
      validate: (input: string) => (input.trim().length > 0 ? true : 'API key is required'),
    },
    {
      type: 'input',
      name: 'tenantId',
      message: 'Tenant ID (optional, press Enter to skip):',
      default: defaults.tenantId,
    },
  ]);

  const engineConfig: WorkflowEngineConfig = {
    url: answers.url.trim(),
    apiKey: answers.apiKey.trim(),
    tenantId: answers.tenantId.trim() || undefined,
  };

  // Test connectivity
  const client = new EngineClient(engineConfig);
  try {
    await client.health();
    console.log(chalk.green('  Connection verified.'));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.yellow(`  Warning: could not reach engine (${msg}).`));
    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: 'Save config anyway?',
        default: true,
      },
    ]);
    if (!proceed) {
      console.log(chalk.gray('  Setup cancelled.'));
      return;
    }
  }

  org.workflowEngine = engineConfig;
  cfg.organizations[cfg.currentOrg] = org;
  saveConfig(cfg);
  console.log(chalk.green('  Workflow engine config saved.'));

  // Reconnect MCP server to pick up new tools
  try {
    await ctx.reconnectAgent();
    console.log(chalk.gray('  Agent reconnected with engine tools.'));
  } catch {
    console.log(chalk.gray('  Restart the session to load engine tools.'));
  }
}

export async function listBrands(slugFilter?: string, statusFilter?: string): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const result = (await client.listBrands({
      slug: slugFilter,
      status: statusFilter,
      limit: 50,
    })) as {
      items?: Array<Record<string, unknown>>;
    };
    const items = result?.items ?? (Array.isArray(result) ? result : []);
    if (!items.length) {
      console.log(chalk.gray('  No brands found.'));
      return;
    }

    console.log(chalk.bold(`  Brands (${items.length})`));
    const rows = items.map((brand) => ({
      id: String(brand.id ?? '').slice(0, 8),
      name: String(brand.name ?? brand.slug ?? 'unnamed'),
      status: String(brand.status ?? 'unknown'),
      mode: String(brand.routing_mode ?? '-'),
    }));
    console.log(formatTable(rows, ['id', 'name', 'status', 'mode']));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function validateEngineBrand(brandRef: string): Promise<boolean> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return false;
  }

  const client = new EngineClient(config);
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(brand);
    const brandSlug = getBrandSlug(brand) || brandRef;
    if (!brandId) {
      throw new Error('Remote brand is missing id.');
    }

    const report = await client.validateBrand(brandId);
    return printValidationReport(brandSlug, report);
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
    return false;
  }
}

export async function showBrandDetails(brandRef: string): Promise<boolean> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return false;
  }

  const client = new EngineClient(config);
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const rows = [
      { field: 'id', value: getBrandId(brand) || '-' },
      { field: 'slug', value: getBrandSlug(brand) || '-' },
      { field: 'display_name', value: getBrandDisplayName(brand) || '-' },
      { field: 'status', value: String(brand.status ?? '-') },
      { field: 'routing_mode', value: String(brand.routing_mode ?? '-') },
      { field: 'canary_percent', value: String(brand.canary_percent ?? '-') },
      { field: 'config_version', value: String(brand.config_version ?? '-') },
      { field: 'region', value: String(brand.region ?? '-') },
      { field: 'default_locale', value: String(brand.default_locale ?? '-') },
      { field: 'activated_at', value: formatDateTime(brand.activated_at) },
    ];
    console.log(chalk.bold(`  Brand: ${getBrandSlug(brand) || brandRef}`));
    console.log(formatTable(rows, ['field', 'value']));

    if (isObject(brand.metadata) && Object.keys(brand.metadata).length > 0) {
      console.log(chalk.bold('  Metadata'));
      console.log(chalk.gray(`  ${formatJsonBlock(brand.metadata)}`));
    }
    return true;
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
    return false;
  }
}

export async function showEffectiveBrandConfig(brandRef: string): Promise<boolean> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return false;
  }

  const client = new EngineClient(config);
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(brand);
    const brandSlug = getBrandSlug(brand) || brandRef;
    if (!brandId) {
      throw new Error('Remote brand is missing id.');
    }

    const result = await client.getBrandConfig(brandId);
    const payload = isObject(result) ? result : {};
    const effectiveBrand = isObject(payload.brand) ? (payload.brand as RemoteBrandRecord) : brand;
    const binding = findResponseAutomationBinding(effectiveBrand.workflow_bindings);
    const automationConfig =
      binding && isObject(binding.deterministic_config) ? binding.deterministic_config : null;
    const connectors = asItems(payload.connectors);

    const rows = [
      { field: 'brand', value: brandSlug },
      { field: 'brand_id', value: brandId },
      {
        field: 'config_version',
        value: String(payload.config_version ?? effectiveBrand.config_version ?? '-'),
      },
      {
        field: 'published_at',
        value: formatDateTime(payload.published_at ?? effectiveBrand.activated_at),
      },
      { field: 'workflow_type', value: String(binding?.workflow_type ?? '-') },
      { field: 'template_key', value: String(binding?.template_key ?? '-') },
      { field: 'template_version', value: String(binding?.template_version ?? '-') },
      { field: 'connectors', value: String(connectors.length) },
      {
        field: 'context_sources',
        value: String(
          Array.isArray(automationConfig?.context_sources)
            ? automationConfig.context_sources.length
            : 0,
        ),
      },
      {
        field: 'tool_definitions',
        value: String(
          Array.isArray(automationConfig?.tool_definitions)
            ? automationConfig.tool_definitions.length
            : 0,
        ),
      },
    ];

    console.log(chalk.bold(`  Effective Config: ${brandSlug}`));
    console.log(formatTable(rows, ['field', 'value']));

    if (automationConfig) {
      console.log(chalk.bold('  Automation Config'));
      console.log(chalk.gray(`  ${formatJsonBlock(automationConfig)}`));
    }

    if (connectors.length > 0) {
      console.log(chalk.bold('  Connectors'));
      const connectorRows = connectors.map((connector) => ({
        key: String(connector.connector_key ?? connector.key ?? '-'),
        type: String(connector.connector_type ?? connector.type ?? '-'),
        direction: String(connector.direction ?? '-'),
        enabled: connector.enabled === false ? 'no' : 'yes',
      }));
      console.log(formatTable(connectorRows, ['key', 'type', 'direction', 'enabled']));
    }
    return true;
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
    return false;
  }
}

export async function createBrandFromFile(filePath: string, cwd = process.cwd()): Promise<boolean> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return false;
  }

  const client = new EngineClient(config);
  try {
    const rawPayload = readJsonObjectFromFile(filePath, cwd);
    const hasWorkflowBindings =
      Array.isArray(rawPayload.workflow_bindings) && rawPayload.workflow_bindings.length > 0;
    const { payload, templateId } = normalizeCreateBrandPayload(rawPayload, config.tenantId);
    const createPayload = hasWorkflowBindings
      ? payload
      : { ...payload, workflow_bindings: [buildBootstrapBinding()] };
    const createResult = await client.createBrand(createPayload);
    let brand = (
      isObject(createResult) && isObject(createResult.brand) ? createResult.brand : createResult
    ) as RemoteBrandRecord;
    let finalResult: unknown = createResult;
    const brandSlug = getBrandSlug(brand) || String(payload.slug ?? '').trim();
    const brandId = getBrandId(brand);

    if (!hasWorkflowBindings && brandId && brandSlug) {
      finalResult = await client.updateBrand(brandId, {
        workflow_bindings: [
          buildResponseAutomationBinding({
            brandId,
            brandSlug,
            deterministicConfig: createWorkflowStudioAutomationConfigFromTemplate(templateId, {
              brandId,
              brandSlug,
            }),
          }),
        ],
      });
      if (isObject(finalResult)) {
        brand = finalResult as RemoteBrandRecord;
      }
    }

    console.log(
      chalk.green(
        `  Brand created${brandSlug ? `: ${brandSlug}` : ''}${brandId ? ` (${brandId.slice(0, 8)})` : ''}.`,
      ),
    );
    if (templateId && !hasWorkflowBindings) {
      console.log(
        chalk.gray(`  Bootstrapped response-automation config with template=${templateId}.`),
      );
    }
    console.log(chalk.gray(`  ${JSON.stringify(finalResult, null, 2)}`));
    return true;
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
    return false;
  }
}

export async function updateBrandFromFile(
  brandRef: string,
  filePath: string,
  cwd = process.cwd(),
): Promise<boolean> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return false;
  }

  const client = new EngineClient(config);
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(brand);
    const brandSlug = getBrandSlug(brand) || brandRef;
    if (!brandId) {
      throw new Error('Remote brand is missing id.');
    }

    const patch = normalizeUpdateBrandPayload(
      readJsonObjectFromFile(filePath, cwd),
      brand.metadata,
    );
    const result = await client.updateBrand(brandId, patch);
    console.log(chalk.green(`  Brand updated: ${brandSlug}.`));
    console.log(chalk.gray(`  ${JSON.stringify(result, null, 2)}`));
    return true;
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
    return false;
  }
}

async function activateResolvedBrandConfig(
  client: EngineClient,
  brand: RemoteBrandRecord,
  expectedConfigVersion?: number,
): Promise<{
  brand: RemoteBrandRecord;
  validation: Record<string, unknown> | null;
  expectedConfigVersion?: number;
}> {
  const brandId = getBrandId(brand);
  if (!brandId) {
    throw new Error('Remote brand is missing id.');
  }

  let nextExpectedVersion = expectedConfigVersion;
  if (nextExpectedVersion === undefined) {
    const configSnapshot = await client.getBrandConfig(brandId);
    if (isObject(configSnapshot)) {
      nextExpectedVersion = parseConfigVersion(configSnapshot.config_version);
    }
  }

  const result = (await client.activateBrand(brandId, nextExpectedVersion)) as Record<
    string,
    unknown
  >;

  return {
    brand: isObject(result.brand) ? (result.brand as RemoteBrandRecord) : brand,
    validation: isObject(result.validation) ? (result.validation as Record<string, unknown>) : null,
    expectedConfigVersion: nextExpectedVersion,
  };
}

export async function bootstrapBrandStudio(
  brandRef: string,
  opts: {
    displayName?: string;
    templateId?: string;
    activate?: boolean;
  } = {},
): Promise<boolean> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return false;
  }

  const client = new EngineClient(config);
  try {
    if (!UUID_PATTERN.test(brandRef) && !config.tenantId) {
      throw new Error(
        'Brand bootstrap requires tenant_id when creating or finding a brand by slug. Set WORKFLOW_ENGINE_TENANT_ID in CLI config first.',
      );
    }

    let templateName = opts.templateId;
    if (opts.templateId) {
      const catalog = await client.listBootstrapTemplates().catch(() => []);
      const templates = Array.isArray(catalog)
        ? catalog
            .filter(isObject)
            .map((template) => ({
              id: String(template.id ?? '').trim(),
              name:
                typeof template.name === 'string' && template.name.trim()
                  ? template.name.trim()
                  : undefined,
            }))
            .filter((template) => template.id.length > 0)
        : [];

      if (templates.length > 0) {
        const matchedTemplate = templates.find((template) => template.id === opts.templateId);
        if (!matchedTemplate) {
          throw new Error(
            `Unknown workflow-studio template "${opts.templateId}". Expected one of: ${templates.map((template) => template.id).join(', ')}`,
          );
        }
        templateName = matchedTemplate.name ?? matchedTemplate.id;
      }
    }

    const result = await client.bootstrapBrand({
      ...(UUID_PATTERN.test(brandRef)
        ? { brand_id: brandRef }
        : {
            tenant_id: config.tenantId,
            slug: brandRef,
            display_name: opts.displayName?.trim() || slugToDisplayName(brandRef) || brandRef,
          }),
      ...(opts.templateId ? { template: opts.templateId } : {}),
      activate: Boolean(opts.activate),
    });

    const resultObject = isObject(result) ? result : {};
    const activatedBrand = isObject(resultObject.brand)
      ? (resultObject.brand as RemoteBrandRecord)
      : (result as RemoteBrandRecord);
    const created = resultObject.created === true;
    const validation = isObject(resultObject.validation)
      ? (resultObject.validation as Record<string, unknown>)
      : null;
    const activated = resultObject.activated === true;
    const finalSlug =
      getBrandSlug(activatedBrand) || (!UUID_PATTERN.test(brandRef) ? brandRef : brandRef);

    console.log(chalk.green(`  Bootstrap ready for ${finalSlug}.`));
    console.log(
      chalk.gray(
        `  ${created ? 'Created' : 'Using existing'} brand${templateName ? `  Template: ${templateName}` : ''}${activated ? '  Activated' : ''}`,
      ),
    );
    if (validation) {
      const valid = validation.valid !== false;
      const errors = Array.isArray(validation.errors) ? validation.errors.length : 0;
      const warnings = Array.isArray(validation.warnings) ? validation.warnings.length : 0;
      console.log(
        chalk.gray(
          `  Validation: ${valid ? 'valid' : 'invalid'} (${errors} error(s), ${warnings} warning(s))`,
        ),
      );
    }
    console.log(chalk.gray(`  ${JSON.stringify(resultObject, null, 2)}`));
    return true;
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
    return false;
  }
}

export async function checkHealth(): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const result = await client.health();
    console.log(chalk.green('  Engine healthy'));
    if (result && typeof result === 'object') {
      console.log(chalk.gray(`  ${JSON.stringify(result, null, 2)}`));
    }
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Engine unreachable: ${msg}`));
  }
}

export async function showDispatchHealthDashboard(
  filters: {
    tenantId?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const result = (await client.getDispatchHealthDashboard({
      tenantId: filters.tenantId,
      limit: filters.limit,
      offset: filters.offset,
    })) as Record<string, unknown>;
    const summary = isObject(result.summary) ? result.summary : {};
    const items = Array.isArray(result.items)
      ? (result.items as Array<Record<string, unknown>>)
      : [];

    console.log(chalk.bold(`  Dispatch Health${filters.tenantId ? ` (${filters.tenantId})` : ''}`));
    console.log(
      chalk.gray(
        `  Tenants: ${formatOptionalNumber(summary.active_tenants)}  Brands: ${formatOptionalNumber(summary.active_brands)}  Healthy: ${formatOptionalNumber(summary.healthy_brands)}  Warning: ${formatOptionalNumber(summary.warning_brands)}  Critical: ${formatOptionalNumber(summary.critical_brands)}`,
      ),
    );
    console.log(
      chalk.gray(
        `  Pending: ${formatOptionalNumber(summary.pending_count)}  Processing: ${formatOptionalNumber(summary.processing_count)}  Failed: ${formatOptionalNumber(summary.failed_count)}  DLQ: ${formatOptionalNumber(summary.dead_letter_count)}  Max mismatch: ${formatRatio(summary.max_parity_mismatch_rate_24h)}`,
      ),
    );

    if (!items.length) {
      console.log(chalk.gray('  No dispatch-health rows found.'));
      return;
    }

    const rows = items.map((item) => ({
      brand: String(item.brand_slug ?? '-'),
      health: String(item.health_status ?? '-'),
      routing: String(item.routing_mode ?? '-'),
      pending: formatOptionalNumber(item.pending_count),
      failed: formatOptionalNumber(item.failed_count),
      dlq: formatOptionalNumber(item.dead_letter_count),
      mismatch_24h: formatRatio(item.parity_mismatch_rate_24h),
      alerts: Array.isArray(item.alerts) ? item.alerts.length.toString() : '0',
    }));
    console.log(
      formatTable(rows, [
        'brand',
        'health',
        'routing',
        'pending',
        'failed',
        'dlq',
        'mismatch_24h',
        'alerts',
      ]),
    );
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function runDispatchGuardView(
  options: {
    tenantId?: string;
    apply?: boolean;
    minimumHealthStatus?: 'warning' | 'critical';
    maxActions?: number;
  } = {},
): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const result = (await client.runDispatchGuard({
      tenantId: options.tenantId,
      apply: options.apply,
      minimumHealthStatus: options.minimumHealthStatus,
      maxActions: options.maxActions,
    })) as Record<string, unknown>;
    const summary = isObject(result.summary) ? result.summary : {};
    const actions = Array.isArray(result.actions)
      ? (result.actions as Array<Record<string, unknown>>)
      : [];
    const applyMode = result.apply === true ? 'apply' : 'plan';

    console.log(
      chalk.bold(
        `  Dispatch Guard (${applyMode})${options.tenantId ? `  ${options.tenantId}` : ''}`,
      ),
    );
    console.log(
      chalk.gray(
        `  Threshold: ${String(result.minimum_health_status ?? options.minimumHealthStatus ?? 'critical')}  Max actions: ${formatOptionalNumber(result.max_actions ?? options.maxActions)}`,
      ),
    );
    console.log(
      chalk.gray(
        `  Scanned: ${formatOptionalNumber(summary.total_brands_scanned)}  Candidates: ${formatOptionalNumber(summary.candidate_brands)}  Planned: ${formatOptionalNumber(summary.planned_actions)}  Applied: ${formatOptionalNumber(summary.applied_actions)}  Failed: ${formatOptionalNumber(summary.failed_actions)}`,
      ),
    );

    if (!actions.length) {
      console.log(chalk.gray('  No guard actions required.'));
      return;
    }

    const rows = actions.map((action) => ({
      brand: String(action.brand_slug ?? '-'),
      health: String(action.health_status ?? '-'),
      action: String(action.action ?? '-'),
      target_stage: String(action.target_stage ?? '-'),
      target_mode: String(action.target_routing_mode ?? '-'),
      applied: action.applied ? 'yes' : 'no',
      reason: String(action.reason ?? '-').slice(0, 48),
    }));
    console.log(
      formatTable(rows, [
        'brand',
        'health',
        'action',
        'target_stage',
        'target_mode',
        'applied',
        'reason',
      ]),
    );
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function showBrandConfigHistory(brandRef: string, limit = 20): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(brand);
    const brandSlug = getBrandSlug(brand) || brandRef;

    if (!brandId) {
      throw new Error('Remote brand is missing id.');
    }

    let supported = true;
    let versions: Array<Record<string, unknown>> = [];

    try {
      const history = (await client.listBrandConfigVersions(brandId, { limit })) as {
        items?: Array<Record<string, unknown>>;
      };
      versions = asItems(history);
    } catch (err) {
      if (err instanceof EngineClientError && err.status === 404) {
        supported = false;
      } else {
        throw err;
      }
    }

    if (!versions.length) {
      const currentVersion = parseConfigVersion(brand.config_version);
      if (currentVersion !== undefined) {
        versions = [
          {
            version: currentVersion,
            fingerprint: brand.config_fingerprint ?? null,
            published_at: brand.activated_at ?? null,
            is_active: brand.status === 'active',
            status: brand.status ?? 'unknown',
            snapshot_available: brand.status === 'active',
          },
        ];
      }
    }

    if (!versions.length) {
      console.log(chalk.gray(`  No config history found for ${brandSlug}.`));
      return;
    }

    console.log(chalk.bold(`  Config History: ${brandSlug}`));
    if (!supported) {
      console.log(
        chalk.gray(
          '  Engine config-versions endpoint not available; showing current version only.',
        ),
      );
    }
    const rows = versions.map((version) => ({
      version: String(version.version ?? '-'),
      status: String(version.status ?? (version.is_active ? 'active' : 'unknown')),
      active: version.is_active ? 'yes' : 'no',
      published_at: formatDateTime(version.published_at),
      fingerprint: String(version.fingerprint ?? '-').slice(0, 12),
    }));
    console.log(formatTable(rows, ['version', 'status', 'active', 'published_at', 'fingerprint']));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function activateBrandConfig(
  brandRef: string,
  expectedConfigVersion?: number,
): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(brand);
    const brandSlug = getBrandSlug(brand) || brandRef;

    if (!brandId) {
      throw new Error('Remote brand is missing id.');
    }

    const {
      brand: resultBrand,
      validation,
      expectedConfigVersion: nextExpectedVersion,
    } = await activateResolvedBrandConfig(client, brand, expectedConfigVersion);

    console.log(chalk.green(`  Activated brand ${brandSlug}.`));
    console.log(
      chalk.gray(
        `  Status: ${String(resultBrand.status ?? 'active')}${nextExpectedVersion !== undefined ? `  Config version: ${nextExpectedVersion}` : ''}`,
      ),
    );
    if (validation) {
      const valid = validation.valid !== false;
      const errors = Array.isArray(validation.errors) ? validation.errors.length : 0;
      const warnings = Array.isArray(validation.warnings) ? validation.warnings.length : 0;
      console.log(
        chalk.gray(
          `  Validation: ${valid ? 'valid' : 'invalid'} (${errors} error(s), ${warnings} warning(s))`,
        ),
      );
    }
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function listBrandExecutions(
  brandRef: string,
  filters: { status?: string; limit?: number; offset?: number } = {},
): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(brand);
    const brandSlug = getBrandSlug(brand) || brandRef;

    if (!brandId) {
      throw new Error('Remote brand is missing id.');
    }

    const result = (await client.listBrandWorkflows(brandId, {
      status: filters.status,
      limit: filters.limit ?? 20,
      offset: filters.offset ?? 0,
    })) as {
      items?: Array<Record<string, unknown>>;
      total?: number;
    };
    const items = asItems(result);

    if (!items.length) {
      console.log(chalk.gray(`  No workflow executions found for ${brandSlug}.`));
      return;
    }

    console.log(
      chalk.bold(`  Workflow Executions: ${brandSlug} (${result.total ?? items.length})`),
    );
    const rows = items.map((item) => ({
      workflow_id: String(item.workflow_id ?? item.id ?? '').slice(0, 24),
      status: String(item.status ?? 'unknown'),
      phase: String(item.current_phase ?? '-'),
      external_id: String(item.external_id ?? '-').slice(0, 18),
      started_at: formatDateTime(item.started_at),
    }));
    console.log(formatTable(rows, ['workflow_id', 'status', 'phase', 'external_id', 'started_at']));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function showBrandConnectors(brandRef: string): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(brand);
    const brandSlug = getBrandSlug(brand) || brandRef;

    if (!brandId) {
      throw new Error('Remote brand is missing id.');
    }

    const items = asItems(await client.listConnectors(brandId));
    if (!items.length) {
      console.log(chalk.gray(`  No connectors found for ${brandSlug}.`));
      return;
    }

    console.log(chalk.bold(`  Connectors: ${brandSlug}`));
    const rows = items.map((connector) => ({
      id: String(connector.id ?? '').slice(0, 8),
      key: String(connector.connector_key ?? connector.key ?? '-'),
      type: String(connector.connector_type ?? connector.type ?? '-'),
      enabled: connector.enabled === false ? 'no' : 'yes',
      direction: String(connector.direction ?? '-'),
    }));
    console.log(formatTable(rows, ['id', 'key', 'type', 'enabled', 'direction']));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function checkBrandConnectorHealth(
  brandRef: string,
  connectorId: string,
): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(brand);
    if (!brandId) {
      throw new Error('Remote brand is missing id.');
    }

    const result = await client.checkConnectorHealth(brandId, connectorId);
    console.log(chalk.green(`  Connector health check completed for ${connectorId}.`));
    console.log(chalk.gray(`  ${JSON.stringify(result, null, 2)}`));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function createBrandConnectorFromFile(
  brandRef: string,
  filePath: string,
  cwd = process.cwd(),
): Promise<boolean> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return false;
  }

  const client = new EngineClient(config);
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(brand);
    const brandSlug = getBrandSlug(brand) || brandRef;

    if (!brandId) {
      throw new Error('Remote brand is missing id.');
    }

    const payload = readJsonObjectFromFile(filePath, cwd);
    const result = await client.createConnector(brandId, payload);
    console.log(chalk.green(`  Connector created for ${brandSlug}.`));
    console.log(chalk.gray(`  ${JSON.stringify(result, null, 2)}`));
    return true;
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
    return false;
  }
}

function resolveConnectorSyncPreferences(
  brandSlug: string,
  remoteBrand: RemoteBrandRecord | null,
  cwd: string,
  loopMode?: LoopSyncMode,
): LoopSyncMode {
  if (loopMode) {
    return loopMode;
  }

  if (brandStudioExists(brandSlug, cwd)) {
    try {
      const bundle = loadBrandStudioBundle(brandSlug, cwd);
      return getConnectorPreferencesFromMetadata(bundle.manifest.metadata).loop_mode;
    } catch {
      // Fall back to remote metadata when the local bundle cannot be parsed.
    }
  }

  return getConnectorPreferencesFromMetadata(remoteBrand?.metadata).loop_mode;
}

function printConnectorSyncPlan(
  brandSlug: string,
  plan: LocalConnectorSyncPlan,
  engineConnectors: Array<Record<string, unknown>>,
  source: ConnectorSyncSource,
): void {
  console.log(chalk.bold(`  Connector Sync Plan: ${brandSlug}`));
  console.log(chalk.gray(`  Source: ${source}`));
  console.log(chalk.gray(`  Loop mode: ${plan.connectorPreferences.loop_mode}`));
  console.log(chalk.gray(`  Brand env prefix: ${plan.brandEnvPrefix}`));
  console.log(chalk.gray(`  Existing engine connectors: ${engineConnectors.length}`));

  if (plan.connectors.length === 0) {
    console.log(chalk.gray(`  No syncable connectors detected from ${source} inputs.`));
  } else {
    const existingIdentities = new Set(
      engineConnectors.map((connector) => connectorIdentity(connector)),
    );
    const rows = plan.connectors.map((connector) => ({
      key: connector.connector_key,
      type: connector.connector_type,
      direction: connector.direction,
      engine_connected: existingIdentities.has(connectorIdentity(connector)) ? 'yes' : 'no',
      secret_ref: connector.auth.secret_ref,
    }));
    console.log(formatTable(rows, ['key', 'type', 'direction', 'engine_connected', 'secret_ref']));
  }

  if (plan.requiredEnvVars.length > 0) {
    console.log(chalk.bold('  Required Secret Env Vars'));
    const rows = plan.requiredEnvVars.map((entry) => ({
      env: entry.name,
      present: entry.presentInShell ? 'yes' : 'no',
      purpose: entry.purpose,
    }));
    console.log(formatTable(rows, ['env', 'present', 'purpose']));
  }

  if (plan.unsupportedServices.length > 0) {
    console.log(
      chalk.bold(`  Unsupported ${source === 'platform' ? 'Platform' : 'Local'} Integrations`),
    );
    const rows = plan.unsupportedServices.map((entry) => ({
      service: entry.service,
      connector_type: entry.connector_type,
      reason: entry.reason,
    }));
    console.log(formatTable(rows, ['service', 'connector_type', 'reason']));
  }

  for (const warning of plan.warnings) {
    console.log(chalk.yellow(`  Warning: ${warning}`));
  }
}

async function buildConnectorSyncPlan(
  brandSlug: string,
  loopMode: LoopSyncMode,
  cwd: string,
  source: ConnectorSyncSource,
): Promise<LocalConnectorSyncPlan> {
  if (source === 'platform') {
    const credentials = await fetchCurrentOrgPlatformConnectorCredentials();
    if (!credentials) {
      throw new Error('No platform credentials found for the current organization.');
    }
    return buildPlatformConnectorSyncPlanFromCredentials(brandSlug, credentials, {
      loop_mode: loopMode,
    });
  }

  return buildLocalConnectorSyncPlan(brandSlug, { loop_mode: loopMode }, cwd);
}

export async function showBrandConnectorSyncPlan(
  brandRef: string,
  options: { cwd?: string; loopMode?: LoopSyncMode; source?: ConnectorSyncSource } = {},
): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  const cwd = options.cwd ?? process.cwd();
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(brand);
    const brandSlug = getBrandSlug(brand) || brandRef;

    if (!brandId) {
      throw new Error('Remote brand is missing id.');
    }

    const loopMode = resolveConnectorSyncPreferences(brandSlug, brand, cwd, options.loopMode);
    const source = options.source ?? 'local';
    const plan = await buildConnectorSyncPlan(brandSlug, loopMode, cwd, source);
    const engineConnectors = asItems(await client.listConnectors(brandId));
    printConnectorSyncPlan(brandSlug, plan, engineConnectors, source);
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

async function resolveLocalConnectorSecretEnvPlan(
  brandRef: string,
  options: { cwd?: string; loopMode?: LoopSyncMode } = {},
): Promise<
  | {
      brandSlug: string;
      plan: ReturnType<typeof buildLocalConnectorSecretEnvPlan>;
    }
  | { error: string }
> {
  const cwd = options.cwd ?? process.cwd();
  const config = getWorkflowEngineConfig();
  let remoteBrand: RemoteBrandRecord | null = null;
  let brandSlug = brandRef;

  if (config) {
    const client = new EngineClient(config);
    try {
      remoteBrand = await resolveRemoteBrand(client, brandRef);
      brandSlug = getBrandSlug(remoteBrand) || brandSlug;
    } catch (err) {
      if (UUID_PATTERN.test(brandRef)) {
        return {
          error: err instanceof EngineClientError ? err.message : String(err),
        };
      }
    }
  } else if (UUID_PATTERN.test(brandRef)) {
    printNotConfigured();
    return { error: 'Workflow engine not configured.' };
  }

  try {
    const loopMode = resolveConnectorSyncPreferences(brandSlug, remoteBrand, cwd, options.loopMode);
    return {
      brandSlug,
      plan: buildLocalConnectorSecretEnvPlan(brandSlug, { loop_mode: loopMode }, cwd),
    };
  } catch (err) {
    return {
      error: err instanceof EngineClientError ? err.message : String(err),
    };
  }
}

export async function showBrandConnectorSecretEnv(
  brandRef: string,
  options: {
    cwd?: string;
    loopMode?: LoopSyncMode;
    format?: SecretRenderFormat;
    outPath?: string;
    allowUnsafePath?: boolean;
  } = {},
): Promise<boolean> {
  const cwd = options.cwd ?? process.cwd();
  const resolved = await resolveLocalConnectorSecretEnvPlan(brandRef, options);
  if ('error' in resolved) {
    if (resolved.error !== 'Workflow engine not configured.') {
      console.log(chalk.red(`  Error: ${resolved.error}`));
    }
    return false;
  }

  try {
    const { brandSlug, plan } = resolved;
    console.log(chalk.bold(`  Connector Secret Env: ${brandSlug}`));
    console.log(chalk.gray(`  Loop mode: ${plan.connectorPreferences.loop_mode}`));
    console.log(chalk.gray(`  Brand env prefix: ${plan.brandEnvPrefix}`));

    if (plan.entries.length === 0) {
      console.log(
        chalk.gray('  No connector secret env vars are required for the current local plan.'),
      );
    } else {
      console.log(
        formatTable(maskConnectorSecretEntries(plan.entries), [
          'env',
          'available',
          'source',
          'connectors',
          'value_preview',
          'purpose',
        ]),
      );
    }

    for (const warning of plan.warnings) {
      console.log(chalk.yellow(`  Warning: ${warning}`));
    }

    if (options.outPath) {
      const format = options.format ?? 'dotenv';
      const resolvedPath = resolveSafeOutputPath(resolveInputPath(options.outPath, cwd), {
        allowedRoots: [cwd, path.join(cwd, '.stateset')],
        allowOutside: options.allowUnsafePath,
        label: 'Connector env output path',
      });
      writePrivateTextFile(resolvedPath, renderLocalConnectorSecretEnvPlan(plan, format), {
        label: 'Connector env output',
      });
      console.log(chalk.green(`  Wrote ${format} connector env file to ${resolvedPath}.`));
    }

    return true;
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
    return false;
  }
}

export async function applyBrandToLocalStack(
  brandRef: string,
  options: {
    cwd?: string;
    loopMode?: LoopSyncMode;
    outPath?: string;
    composeFilePath?: string;
    services?: string[];
    writeOnly?: boolean;
    allowUnsafePath?: boolean;
  } = {},
): Promise<boolean> {
  const cwd = options.cwd ?? process.cwd();
  const resolved = await resolveLocalConnectorSecretEnvPlan(brandRef, options);
  if ('error' in resolved) {
    if (resolved.error !== 'Workflow engine not configured.') {
      console.log(chalk.red(`  Error: ${resolved.error}`));
    }
    return false;
  }

  try {
    const { brandSlug, plan } = resolved;
    const defaultOutputPath = path.join(cwd, '.stateset', brandSlug, 'engine-secrets.env');
    const outputPath = resolveSafeOutputPath(
      resolveInputPath(options.outPath ?? defaultOutputPath, cwd),
      {
        allowedRoots: [cwd, path.join(cwd, '.stateset')],
        allowOutside: options.allowUnsafePath,
        label: 'Local stack env output path',
      },
    );
    writePrivateTextFile(outputPath, renderLocalConnectorSecretEnvPlan(plan, 'dotenv'), {
      label: 'Local stack env output',
    });

    const commandPlan = buildLocalStackApplyCommand({
      cwd,
      composeFilePath: options.composeFilePath,
      envFilePath: outputPath,
      services: options.services,
    });

    console.log(chalk.bold(`  Local Stack Apply: ${brandSlug}`));
    console.log(chalk.gray(`  Loop mode: ${plan.connectorPreferences.loop_mode}`));
    console.log(chalk.gray(`  Env file: ${outputPath}`));
    console.log(chalk.gray(`  Compose file: ${commandPlan.composeFilePath}`));
    console.log(chalk.gray(`  Services: ${commandPlan.services.join(', ')}`));
    console.log(chalk.gray(`  Command: ${commandPlan.command}`));

    for (const warning of plan.warnings) {
      console.log(chalk.yellow(`  Warning: ${warning}`));
    }
    if (plan.entries.some((entry) => !entry.available)) {
      console.log(
        chalk.yellow(
          '  Missing secrets will fall back to the compose defaults unless you populate them in the env file.',
        ),
      );
    }

    if (options.writeOnly) {
      console.log(chalk.green('  Wrote local stack env file. Skipped docker compose execution.'));
      return true;
    }

    const result = spawnSync('docker', commandPlan.args, {
      cwd: commandPlan.composeProjectDir,
      stdio: 'inherit',
      env: { ...process.env },
      windowsHide: true,
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      console.log(chalk.red(`  docker compose exited with status ${result.status ?? 1}.`));
      return false;
    }

    console.log(chalk.green('  Local stack services updated.'));
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
    return false;
  }
}

export async function syncBrandConnectors(
  brandRef: string,
  options: { cwd?: string; loopMode?: LoopSyncMode; source?: ConnectorSyncSource } = {},
): Promise<boolean> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return false;
  }

  const client = new EngineClient(config);
  const cwd = options.cwd ?? process.cwd();
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(brand);
    const brandSlug = getBrandSlug(brand) || brandRef;
    const displayName = getBrandDisplayName(brand);

    if (!brandId) {
      throw new Error('Remote brand is missing id.');
    }

    const loopMode = resolveConnectorSyncPreferences(brandSlug, brand, cwd, options.loopMode);
    const source = options.source ?? 'local';
    const plan = await buildConnectorSyncPlan(brandSlug, loopMode, cwd, source);
    const nextRemoteMetadata = mergeConnectorPreferencesIntoMetadata(brand.metadata, {
      loop_mode: loopMode,
    });

    let localBundle: BrandStudioBundle;
    if (brandStudioExists(brandSlug, cwd)) {
      localBundle = loadBrandStudioBundle(brandSlug, cwd);
    } else {
      const pulled = await pullBrandStudioConfig(brandRef, cwd);
      if (pulled && brandStudioExists(brandSlug, cwd)) {
        localBundle = loadBrandStudioBundle(brandSlug, cwd);
      } else {
        const defaultManifest = buildDefaultManifest(brandSlug, displayName);
        const manifest = {
          ...defaultManifest,
          slug: brandSlug,
          display_name: displayName,
          metadata: isObject(brand.metadata) ? (brand.metadata as Record<string, unknown>) : {},
          workflow_bindings: Array.isArray(brand.workflow_bindings)
            ? (brand.workflow_bindings as typeof defaultManifest.workflow_bindings)
            : defaultManifest.workflow_bindings,
          connectors: [],
        };
        localBundle = buildBrandStudioBundle({
          brandSlug,
          cwd,
          displayName,
          manifest,
          connectors: [],
        });
      }
    }

    const nextLocalMetadata = mergeConnectorPreferencesIntoMetadata(localBundle.manifest.metadata, {
      loop_mode: loopMode,
    });
    const nextBundle = buildBrandStudioBundle({
      brandSlug,
      cwd,
      displayName: localBundle.manifest.display_name || displayName,
      manifest: {
        ...localBundle.manifest,
        metadata: nextLocalMetadata,
      },
      automationConfig: localBundle.automationConfig,
      connectors: mergeConnectorSpecs(localBundle.connectors, plan.connectors),
      skipRules: localBundle.skipRules,
      escalationPatterns: localBundle.escalationPatterns,
    });
    writeBrandStudioBundle(nextBundle);

    await client.updateBrand(brandId, { metadata: nextRemoteMetadata });

    const engineConnectors = asItems(await client.listConnectors(brandId));
    const existingIdentities = new Set(
      engineConnectors.map((connector) => connectorIdentity(connector)),
    );
    let created = 0;
    let failed = 0;

    for (const connector of plan.connectors) {
      if (existingIdentities.has(connectorIdentity(connector))) {
        continue;
      }
      try {
        await client.createConnector(brandId, connector as unknown as Record<string, unknown>);
        existingIdentities.add(connectorIdentity(connector));
        created += 1;
      } catch (err) {
        failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.log(
          chalk.yellow(
            `  Warning: could not create ${connector.connector_type} connector (${msg}).`,
          ),
        );
      }
    }

    console.log(chalk.green(`  Synced connector plan for ${brandSlug}.`));
    console.log(chalk.gray(`  Source: ${source}.`));
    console.log(chalk.gray(`  Local bundle updated at ${nextBundle.dir}.`));
    console.log(chalk.gray(`  Remote connector preferences set to loop_mode=${loopMode}.`));
    console.log(chalk.gray(`  Created ${created} missing connector(s); ${failed} failed.`));
    if (plan.requiredEnvVars.length > 0) {
      const missingSecretRefs = plan.requiredEnvVars.filter((entry) => !entry.presentInShell);
      if (missingSecretRefs.length > 0) {
        console.log(
          chalk.yellow(
            `  Warning: ${missingSecretRefs.length} expected secret env var(s) are not set in the current shell.`,
          ),
        );
      }
    }
    if (plan.unsupportedServices.length > 0) {
      console.log(
        chalk.gray(
          `  ${plan.unsupportedServices.length} unsupported ${source} integration(s) were left unchanged.`,
        ),
      );
    }
    return failed === 0;
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
    return false;
  }
}

export async function runWorkflowStudioTest(brandRef: string, ticketId: string): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(brand);
    const brandSlug = getBrandSlug(brand);
    if (!brandId || !brandSlug) {
      throw new Error('Remote brand is missing id or slug.');
    }

    const binding = findResponseAutomationBinding(brand.workflow_bindings);
    const workflowType = String(binding?.workflow_type ?? 'response-automation-v2');
    const startData = (await client.ingestEvent(
      brandSlug,
      {
        event_type: 'message_received',
        workflow_type: workflowType,
        source: 'workflow-studio-cli-test',
        external_id: `test-${ticketId}`,
        payload: {
          ticket_id: Number.parseInt(ticketId, 10) || ticketId,
          dry_run: true,
        },
      },
      `test-${brandId}-${ticketId}-${Date.now()}`,
    )) as Record<string, unknown>;

    console.log(chalk.green(`  Test workflow dispatched for ${brandSlug}.`));
    const workflowId = String(startData.workflow_id ?? '').trim();
    if (!workflowId) {
      console.log(chalk.gray(`  ${JSON.stringify(startData, null, 2)}`));
      return;
    }

    for (const delay of TEST_STATUS_POLL_DELAYS_MS) {
      if (delay > 0) {
        await sleep(delay);
      }

      try {
        const statusData = (await client.getWorkflowStatusForType(
          workflowId,
          workflowType,
        )) as Record<string, unknown>;
        const status = String(statusData.status ?? '');
        const phaseCount = isObject(statusData.phases) ? Object.keys(statusData.phases).length : 0;
        if (
          ['completed', 'failed', 'skipped', 'cancelled'].includes(status) ||
          phaseCount > 3 ||
          delay === TEST_STATUS_POLL_DELAYS_MS[TEST_STATUS_POLL_DELAYS_MS.length - 1]
        ) {
          console.log(
            chalk.gray(
              `  ${JSON.stringify({ ...startData, workflow_status: statusData }, null, 2)}`,
            ),
          );
          return;
        }
      } catch (err) {
        if (err instanceof EngineClientError && err.status === 404) {
          break;
        }
      }
    }

    console.log(chalk.gray(`  ${JSON.stringify(startData, null, 2)}`));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function ingestBrandEventFromFile(
  brandRef: string,
  filePath: string,
  cwd = process.cwd(),
  idempotencyKey?: string,
): Promise<boolean> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return false;
  }

  const client = new EngineClient(config);
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(brand);
    const brandSlug = getBrandSlug(brand);
    if (!brandId || !brandSlug) {
      throw new Error('Remote brand is missing id or slug.');
    }

    const payload = readJsonObjectFromFile(filePath, cwd);
    const nextIdempotencyKey = idempotencyKey?.trim() || `cli-event-${brandId}-${Date.now()}`;
    const result = await client.ingestEvent(brandSlug, payload, nextIdempotencyKey);

    console.log(chalk.green(`  Event ingested for ${brandSlug}.`));
    console.log(chalk.gray(`  Idempotency key: ${nextIdempotencyKey}`));
    console.log(chalk.gray(`  ${JSON.stringify(result, null, 2)}`));
    return true;
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
    return false;
  }
}

export async function showBrandMigrationState(brandRef: string): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(brand);
    const brandSlug = getBrandSlug(brand) || brandRef;
    if (!brandId) {
      throw new Error('Remote brand is missing id.');
    }

    const result = await client.getBrandMigrationState(brandId);
    console.log(chalk.bold(`  Migration State: ${brandSlug}`));
    console.log(chalk.gray(`  ${JSON.stringify(result, null, 2)}`));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function updateBrandMigrationStateFromFile(
  brandRef: string,
  filePath: string,
  cwd = process.cwd(),
): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(brand);
    if (!brandId) {
      throw new Error('Remote brand is missing id.');
    }

    const patch = readJsonObjectFromFile(filePath, cwd);
    const result = await client.updateBrandMigrationState(brandId, patch);
    console.log(chalk.green(`  Migration state updated for ${getBrandSlug(brand) || brandRef}.`));
    console.log(chalk.gray(`  ${JSON.stringify(result, null, 2)}`));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function showBrandParityDashboard(
  brandRef: string,
  filters: { from?: string; to?: string } = {},
): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(brand);
    const brandSlug = getBrandSlug(brand) || brandRef;
    if (!brandId) {
      throw new Error('Remote brand is missing id.');
    }

    const result = (await client.getBrandParityDashboard(brandId, filters)) as Record<
      string,
      unknown
    >;
    const summary = isObject(result.summary) ? (result.summary as Record<string, unknown>) : null;
    console.log(chalk.bold(`  Parity Dashboard: ${brandSlug}`));
    if (summary) {
      console.log(
        chalk.gray(
          `  Total: ${String(summary.total_events ?? 0)}  Match: ${String(summary.parity_match ?? 0)}  Mismatch: ${String(summary.parity_mismatch ?? 0)}  Unknown: ${String(summary.parity_unknown ?? 0)}  Rate: ${String(summary.mismatch_rate ?? 0)}`,
        ),
      );
    }
    console.log(chalk.gray(`  ${JSON.stringify(result, null, 2)}`));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function listWorkflowTemplatesView(key?: string, version?: number): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    if (key) {
      const result = await client.getWorkflowTemplate(key, version);
      console.log(chalk.gray(JSON.stringify(result, null, 2)));
    } else {
      const result = (await client.listWorkflowTemplates({ limit: 50 })) as {
        items?: Array<Record<string, unknown>>;
      };
      const items = result?.items ?? (Array.isArray(result) ? result : []);
      if (!items.length) {
        console.log(chalk.gray('  No workflow templates found.'));
        return;
      }
      console.log(chalk.bold(`  Workflow Templates (${items.length})`));
      for (const t of items) {
        const key = t.template_key ?? t.key ?? 'unknown';
        const name = t.name ?? '-';
        const version = t.version ?? '-';
        const status = t.status ?? 'unknown';
        console.log(
          `  ${chalk.white(String(key).padEnd(30))} v${version}  ${chalk.gray(String(name).padEnd(24))} ${chalk.gray(String(status))}`,
        );
      }
    }
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function createWorkflowTemplateFromFile(
  filePath: string,
  cwd = process.cwd(),
): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const payload = readJsonObjectFromFile(filePath, cwd);
    const result = await client.createWorkflowTemplate(payload);
    console.log(chalk.green('  Workflow template created.'));
    console.log(chalk.gray(`  ${JSON.stringify(result, null, 2)}`));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function updateWorkflowTemplateFromFile(
  templateKey: string,
  version: number,
  filePath: string,
  cwd = process.cwd(),
): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const patch = readJsonObjectFromFile(filePath, cwd);
    const result = await client.updateWorkflowTemplate(templateKey, version, patch);
    console.log(chalk.green(`  Workflow template ${templateKey} v${version} updated.`));
    console.log(chalk.gray(`  ${JSON.stringify(result, null, 2)}`));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function listPolicySetsView(policySetKey?: string, version?: number): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    if (policySetKey) {
      const result = await client.getPolicySet(policySetKey, version);
      console.log(chalk.gray(JSON.stringify(result, null, 2)));
      return;
    }

    const result = (await client.listPolicySets({ limit: 50 })) as {
      items?: Array<Record<string, unknown>>;
    };
    const items = asItems(result);
    if (!items.length) {
      console.log(chalk.gray('  No policy sets found.'));
      return;
    }

    console.log(chalk.bold(`  Policy Sets (${items.length})`));
    const rows = items.map((item) => ({
      key: String(item.policy_set_key ?? '-'),
      version: String(item.version ?? '-'),
      status: String(item.status ?? 'unknown'),
      id: String(item.id ?? '').slice(0, 8),
    }));
    console.log(formatTable(rows, ['key', 'version', 'status', 'id']));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function createPolicySetFromFile(
  filePath: string,
  cwd = process.cwd(),
): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const payload = readJsonObjectFromFile(filePath, cwd);
    const result = await client.createPolicySet(payload);
    console.log(chalk.green('  Policy set created.'));
    console.log(chalk.gray(`  ${JSON.stringify(result, null, 2)}`));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function updatePolicySetFromFile(
  policySetKey: string,
  version: number,
  filePath: string,
  cwd = process.cwd(),
): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const patch = readJsonObjectFromFile(filePath, cwd);
    const result = await client.updatePolicySet(policySetKey, version, patch);
    console.log(chalk.green(`  Policy set ${policySetKey} v${version} updated.`));
    console.log(chalk.gray(`  ${JSON.stringify(result, null, 2)}`));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function handleEngineCommand(input: string, ctx: ChatContext): Promise<CommandResult> {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed.startsWith('/engine')) {
    return NOT_HANDLED;
  }

  const parts = input.trim().split(/\s+/).slice(1);
  const subcommand = parts[0]?.toLowerCase() ?? '';

  switch (subcommand) {
    case '':
      await showEngineStatus();
      return { handled: true };

    case 'status':
      await showEngineStatus();
      return { handled: true };

    case 'setup':
      await runSetup(ctx);
      return { handled: true };

    case 'brands': {
      const action = parts[1]?.toLowerCase();
      if (action === 'show') {
        const brandRef = parts[2];
        if (!brandRef) {
          console.log(chalk.red('  Usage: /engine brands show <brand-slug|brand-id>'));
          return { handled: true };
        }
        await showBrandDetails(brandRef);
        return { handled: true };
      }
      if (action === 'create') {
        const filePath = parts[2];
        if (!filePath) {
          console.log(chalk.red('  Usage: /engine brands create <json-file>'));
          return { handled: true };
        }
        await createBrandFromFile(filePath, ctx.cwd);
        return { handled: true };
      }
      if (action === 'bootstrap') {
        const brandRef = parts[2];
        const extraArgs = parts.slice(3);
        if (!brandRef) {
          console.log(
            chalk.red(
              '  Usage: /engine brands bootstrap <brand-slug|brand-id> [template-id] [activate]',
            ),
          );
          return { handled: true };
        }

        let templateId: string | undefined;
        let activate = false;
        for (const arg of extraArgs) {
          const normalized = arg.toLowerCase();
          if (normalized === 'activate') {
            activate = true;
            continue;
          }
          if (!templateId) {
            templateId = normalized;
            continue;
          }
          console.log(
            chalk.red(
              '  Usage: /engine brands bootstrap <brand-slug|brand-id> [template-id] [activate]',
            ),
          );
          return { handled: true };
        }

        await bootstrapBrandStudio(brandRef, { templateId, activate });
        return { handled: true };
      }
      if (action === 'update') {
        const brandRef = parts[2];
        const filePath = parts[3];
        if (!brandRef || !filePath) {
          console.log(
            chalk.red('  Usage: /engine brands update <brand-slug|brand-id> <json-file>'),
          );
          return { handled: true };
        }
        await updateBrandFromFile(brandRef, filePath, ctx.cwd);
        return { handled: true };
      }
      const slugFilter = parts[1];
      await listBrands(slugFilter);
      return { handled: true };
    }

    case 'onboard': {
      const action = parts[1]?.toLowerCase();
      if (action === 'list') {
        const brandRef = parts[2];
        if (!brandRef) {
          console.log(chalk.red('  Usage: /engine onboard list <brand-slug|brand-id>'));
          return { handled: true };
        }
        await listOnboardingRunsView(brandRef, ctx.cwd);
        return { handled: true };
      }
      if (action === 'show') {
        const brandRef = parts[2];
        const runId = parts[3];
        if (!brandRef || !runId) {
          console.log(chalk.red('  Usage: /engine onboard show <brand-slug|brand-id> <run-id>'));
          return { handled: true };
        }
        await showOnboardingRunView(brandRef, runId, ctx.cwd);
        return { handled: true };
      }
      if (action === 'update') {
        const brandRef = parts[2];
        const runId = parts[3];
        const status = parts[4];
        const notes = parts.slice(5).join(' ').trim() || undefined;
        if (!brandRef || !runId || !status) {
          console.log(
            chalk.red(
              '  Usage: /engine onboard update <brand-slug|brand-id> <run-id> <status> [notes]',
            ),
          );
          return { handled: true };
        }
        await updateOnboardingRunView(brandRef, runId, { status, notes }, ctx.cwd);
        return { handled: true };
      }

      const brandRef = parts[1];
      if (!brandRef) {
        console.log(chalk.red('  Usage: /engine onboard <brand-slug|brand-id> [notes]'));
        return { handled: true };
      }
      const notes = parts.slice(2).join(' ').trim() || undefined;
      await startOnboardingRun(brandRef, notes, ctx.cwd);
      return { handled: true };
    }

    case 'init': {
      // Delegate to onboard init
      const initSlug = parts[1];
      return handleOnboardCommand(`/onboard init${initSlug ? ` ${initSlug}` : ''}`, ctx);
    }

    case 'config': {
      const action = parts[1]?.toLowerCase() ?? '';
      const brandRef = parts[2];
      if (action === 'show') {
        if (!brandRef) {
          console.log(chalk.red('  Usage: /engine config show <brand-slug|brand-id>'));
          return { handled: true };
        }
        await showEffectiveBrandConfig(brandRef);
        return { handled: true };
      }
      if (action === 'pull') {
        if (!brandRef) {
          console.log(chalk.red('  Usage: /engine config pull <brand-slug|brand-id>'));
          return { handled: true };
        }
        await pullBrandStudioConfig(brandRef, ctx.cwd);
        return { handled: true };
      }
      if (action === 'push') {
        if (!brandRef) {
          console.log(chalk.red('  Usage: /engine config push <brand-slug>'));
          return { handled: true };
        }
        await pushBrandStudioConfig(brandRef, ctx.cwd);
        return { handled: true };
      }
      if (action === 'validate') {
        if (!brandRef) {
          console.log(chalk.red('  Usage: /engine config validate <brand-slug>'));
          return { handled: true };
        }
        validateBrandStudioConfig(brandRef, ctx.cwd);
        return { handled: true };
      }
      if (action === 'history') {
        if (!brandRef) {
          console.log(chalk.red('  Usage: /engine config history <brand-slug|brand-id>'));
          return { handled: true };
        }
        await showBrandConfigHistory(brandRef);
        return { handled: true };
      }
      console.log(chalk.red('  Usage: /engine config [show|pull|push|validate|history] <brand>'));
      return { handled: true };
    }

    case 'activate': {
      const brandRef = parts[1];
      if (!brandRef) {
        console.log(chalk.red('  Usage: /engine activate <brand-slug|brand-id> [config-version]'));
        return { handled: true };
      }
      const expectedConfigVersion = parts[2] ? Number.parseInt(parts[2], 10) : undefined;
      await activateBrandConfig(
        brandRef,
        Number.isFinite(expectedConfigVersion) ? expectedConfigVersion : undefined,
      );
      return { handled: true };
    }

    case 'validate': {
      const brandRef = parts[1];
      if (!brandRef) {
        console.log(chalk.red('  Usage: /engine validate <brand-slug|brand-id>'));
        return { handled: true };
      }
      await validateEngineBrand(brandRef);
      return { handled: true };
    }

    case 'executions': {
      const brandRef = parts[1];
      if (!brandRef) {
        console.log(chalk.red('  Usage: /engine executions <brand-slug|brand-id> [status]'));
        return { handled: true };
      }
      await listBrandExecutions(brandRef, { status: parts[2], limit: 20, offset: 0 });
      return { handled: true };
    }

    case 'connectors': {
      const brandRef = parts[1];
      const action = parts[2]?.toLowerCase();
      if (!brandRef) {
        console.log(
          chalk.red(
            '  Usage: /engine connectors <brand-slug|brand-id> [create <json-file>|health <connector-id>|plan [loop-mode] [--source local|platform]|sync [loop-mode] [--source local|platform]|env [loop-mode] [dotenv|shell|json] [out=path] [--unsafe-path]]',
          ),
        );
        return { handled: true };
      }
      if (action === 'create') {
        const filePath = parts[3];
        if (!filePath) {
          console.log(chalk.red('  Usage: /engine connectors <brand> create <json-file>'));
          return { handled: true };
        }
        await createBrandConnectorFromFile(brandRef, filePath, ctx.cwd);
        return { handled: true };
      }
      if (action === 'health') {
        const connectorId = parts[3];
        if (!connectorId) {
          console.log(chalk.red('  Usage: /engine connectors <brand> health <connector-id>'));
          return { handled: true };
        }
        await checkBrandConnectorHealth(brandRef, connectorId);
        return { handled: true };
      }
      if (action === 'plan') {
        let parsed;
        try {
          parsed = parseCommandArgs(parts.slice(3));
        } catch (err) {
          console.log(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`));
          console.log(
            chalk.red(
              '  Usage: /engine connectors <brand> plan [subscriptions|returns|both] [--source local|platform]',
            ),
          );
          return { handled: true };
        }
        const loopMode = parseLoopMode(parsed.positionals[0]);
        const source = parseConnectorSyncSource(parsed.options.source);
        if ((parsed.positionals[0] && !loopMode) || (parsed.options.source && !source)) {
          console.log(
            chalk.red(
              '  Usage: /engine connectors <brand> plan [subscriptions|returns|both] [--source local|platform]',
            ),
          );
          return { handled: true };
        }
        await showBrandConnectorSyncPlan(brandRef, { cwd: ctx.cwd, loopMode, source });
        return { handled: true };
      }
      if (action === 'sync') {
        let parsed;
        try {
          parsed = parseCommandArgs(parts.slice(3));
        } catch (err) {
          console.log(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`));
          console.log(
            chalk.red(
              '  Usage: /engine connectors <brand> sync [subscriptions|returns|both] [--source local|platform]',
            ),
          );
          return { handled: true };
        }
        const loopMode = parseLoopMode(parsed.positionals[0]);
        const source = parseConnectorSyncSource(parsed.options.source);
        if ((parsed.positionals[0] && !loopMode) || (parsed.options.source && !source)) {
          console.log(
            chalk.red(
              '  Usage: /engine connectors <brand> sync [subscriptions|returns|both] [--source local|platform]',
            ),
          );
          return { handled: true };
        }
        await syncBrandConnectors(brandRef, { cwd: ctx.cwd, loopMode, source });
        return { handled: true };
      }
      if (action === 'env') {
        let loopMode: LoopSyncMode | undefined;
        let format: SecretRenderFormat | undefined;
        let outPath: string | undefined;
        let allowUnsafePath = false;
        for (const token of parts.slice(3)) {
          if (token === '--unsafe-path') {
            allowUnsafePath = true;
            continue;
          }
          if (token.startsWith('out=')) {
            outPath = token.slice(4);
            continue;
          }
          const nextLoopMode = parseLoopMode(token);
          if (nextLoopMode && !loopMode) {
            loopMode = nextLoopMode;
            continue;
          }
          const nextFormat = parseSecretRenderFormat(token);
          if (nextFormat && !format) {
            format = nextFormat;
            continue;
          }
          console.log(
            chalk.red(
              '  Usage: /engine connectors <brand> env [subscriptions|returns|both] [dotenv|shell|json] [out=path] [--unsafe-path]',
            ),
          );
          return { handled: true };
        }
        await showBrandConnectorSecretEnv(brandRef, {
          cwd: ctx.cwd,
          loopMode,
          format,
          outPath,
          allowUnsafePath,
        });
        return { handled: true };
      }
      await showBrandConnectors(brandRef);
      return { handled: true };
    }

    case 'local': {
      const action = parts[1]?.toLowerCase();
      if (action !== 'apply') {
        console.log(
          chalk.red(
            '  Usage: /engine local apply <brand-slug|brand-id> [subscriptions|returns|both] [out=path] [compose=path] [services=a,b,c] [--write-only] [--unsafe-path]',
          ),
        );
        return { handled: true };
      }
      const brandRef = parts[2];
      if (!brandRef) {
        console.log(
          chalk.red(
            '  Usage: /engine local apply <brand-slug|brand-id> [subscriptions|returns|both] [out=path] [compose=path] [services=a,b,c] [--write-only] [--unsafe-path]',
          ),
        );
        return { handled: true };
      }
      let loopMode: LoopSyncMode | undefined;
      let outPath: string | undefined;
      let composeFilePath: string | undefined;
      let services: string[] | undefined;
      let writeOnly = false;
      let allowUnsafePath = false;
      for (const token of parts.slice(3)) {
        if (token === '--write-only') {
          writeOnly = true;
          continue;
        }
        if (token === '--unsafe-path') {
          allowUnsafePath = true;
          continue;
        }
        if (token.startsWith('out=')) {
          outPath = token.slice(4);
          continue;
        }
        if (token.startsWith('compose=')) {
          composeFilePath = token.slice(8);
          continue;
        }
        if (token.startsWith('services=')) {
          try {
            services = parseLocalStackServices(token.slice(9));
          } catch (err) {
            console.log(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`));
            return { handled: true };
          }
          continue;
        }
        const nextLoopMode = parseLoopMode(token);
        if (nextLoopMode && !loopMode) {
          loopMode = nextLoopMode;
          continue;
        }
        console.log(
          chalk.red(
            '  Usage: /engine local apply <brand-slug|brand-id> [subscriptions|returns|both] [out=path] [compose=path] [services=a,b,c] [--write-only] [--unsafe-path]',
          ),
        );
        return { handled: true };
      }
      await applyBrandToLocalStack(brandRef, {
        cwd: ctx.cwd,
        loopMode,
        outPath,
        composeFilePath,
        services,
        writeOnly,
        allowUnsafePath,
      });
      return { handled: true };
    }

    case 'test': {
      const brandRef = parts[1];
      const ticketId = parts[2];
      if (!brandRef || !ticketId) {
        console.log(chalk.red('  Usage: /engine test <brand-slug|brand-id> <ticket-id>'));
        return { handled: true };
      }
      await runWorkflowStudioTest(brandRef, ticketId);
      return { handled: true };
    }

    case 'event': {
      const brandRef = parts[1];
      const filePath = parts[2];
      const idempotencyKey = parts[3];
      if (!brandRef || !filePath) {
        console.log(
          chalk.red('  Usage: /engine event <brand-slug|brand-id> <json-file> [idempotency-key]'),
        );
        return { handled: true };
      }
      await ingestBrandEventFromFile(brandRef, filePath, ctx.cwd, idempotencyKey);
      return { handled: true };
    }

    case 'health':
      await checkHealth();
      return { handled: true };

    case 'dispatch-health': {
      let options: Record<string, string>;
      try {
        ({ options } = parseCommandArgs(parts.slice(1)));
      } catch (err) {
        console.log(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`));
        console.log(
          chalk.red(
            '  Usage: /engine dispatch-health [--tenant-id <tenant-id>] [--limit <n>] [--offset <n>]',
          ),
        );
        return { handled: true };
      }

      const limit = options.limit !== undefined ? Number.parseInt(options.limit, 10) : undefined;
      const offset = options.offset !== undefined ? Number.parseInt(options.offset, 10) : undefined;
      await showDispatchHealthDashboard({
        tenantId: options['tenant-id'],
        limit: Number.isFinite(limit) ? limit : undefined,
        offset: Number.isFinite(offset) ? offset : undefined,
      });
      return { handled: true };
    }

    case 'dispatch-guard': {
      let options: Record<string, string>;
      try {
        ({ options } = parseCommandArgs(parts.slice(1)));
      } catch (err) {
        console.log(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`));
        console.log(
          chalk.red(
            '  Usage: /engine dispatch-guard [--tenant-id <tenant-id>] [--apply true|false] [--minimum-health-status warning|critical] [--max-actions <n>]',
          ),
        );
        return { handled: true };
      }

      const applyRaw = options.apply?.trim().toLowerCase();
      const apply =
        applyRaw === undefined
          ? undefined
          : applyRaw === 'true'
            ? true
            : applyRaw === 'false'
              ? false
              : undefined;
      const maxActions =
        options['max-actions'] !== undefined
          ? Number.parseInt(options['max-actions'], 10)
          : undefined;
      const thresholdRaw = options['minimum-health-status']?.trim().toLowerCase();

      if (options.apply !== undefined && apply === undefined) {
        console.log(chalk.red('  Error: --apply must be true or false.'));
        return { handled: true };
      }
      if (thresholdRaw && thresholdRaw !== 'warning' && thresholdRaw !== 'critical') {
        console.log(chalk.red('  Error: --minimum-health-status must be warning or critical.'));
        return { handled: true };
      }

      await runDispatchGuardView({
        tenantId: options['tenant-id'],
        apply,
        minimumHealthStatus: normalizeDispatchGuardThreshold(thresholdRaw),
        maxActions: Number.isFinite(maxActions) ? maxActions : undefined,
      });
      return { handled: true };
    }

    case 'migration': {
      const action = parts[1]?.toLowerCase();
      if (action === 'update') {
        const brandRef = parts[2];
        const filePath = parts[3];
        if (!brandRef || !filePath) {
          console.log(
            chalk.red('  Usage: /engine migration update <brand-slug|brand-id> <json-file>'),
          );
          return { handled: true };
        }
        await updateBrandMigrationStateFromFile(brandRef, filePath, ctx.cwd);
        return { handled: true };
      }
      const brandRef = parts[1];
      if (!brandRef) {
        console.log(chalk.red('  Usage: /engine migration <brand-slug|brand-id>'));
        return { handled: true };
      }
      await showBrandMigrationState(brandRef);
      return { handled: true };
    }

    case 'parity': {
      const brandRef = parts[1];
      if (!brandRef) {
        console.log(chalk.red('  Usage: /engine parity <brand-slug|brand-id> [from] [to]'));
        return { handled: true };
      }
      await showBrandParityDashboard(brandRef, { from: parts[2], to: parts[3] });
      return { handled: true };
    }

    case 'templates': {
      const action = parts[1]?.toLowerCase();
      if (action === 'create') {
        const filePath = parts[2];
        if (!filePath) {
          console.log(chalk.red('  Usage: /engine templates create <json-file>'));
          return { handled: true };
        }
        await createWorkflowTemplateFromFile(filePath, ctx.cwd);
        return { handled: true };
      }
      if (action === 'update') {
        const templateKey = parts[2];
        const versionText = parts[3];
        const filePath = parts[4];
        const version = versionText ? Number.parseInt(versionText, 10) : NaN;
        if (!templateKey || !filePath || !Number.isFinite(version)) {
          console.log(
            chalk.red('  Usage: /engine templates update <template-key> <version> <json-file>'),
          );
          return { handled: true };
        }
        await updateWorkflowTemplateFromFile(templateKey, version, filePath, ctx.cwd);
        return { handled: true };
      }
      const key = parts[1];
      const versionText = parts[2];
      const version = versionText ? Number.parseInt(versionText, 10) : NaN;
      await listWorkflowTemplatesView(key, Number.isFinite(version) ? version : undefined);
      return { handled: true };
    }

    case 'policy-sets': {
      const action = parts[1]?.toLowerCase();
      if (action === 'create') {
        const filePath = parts[2];
        if (!filePath) {
          console.log(chalk.red('  Usage: /engine policy-sets create <json-file>'));
          return { handled: true };
        }
        await createPolicySetFromFile(filePath, ctx.cwd);
        return { handled: true };
      }
      if (action === 'update') {
        const policySetKey = parts[2];
        const versionText = parts[3];
        const filePath = parts[4];
        const version = versionText ? Number.parseInt(versionText, 10) : NaN;
        if (!policySetKey || !filePath || !Number.isFinite(version)) {
          console.log(
            chalk.red('  Usage: /engine policy-sets update <policy-set-key> <version> <json-file>'),
          );
          return { handled: true };
        }
        await updatePolicySetFromFile(policySetKey, version, filePath, ctx.cwd);
        return { handled: true };
      }
      if (action === 'get') {
        const policySetKey = parts[2];
        const versionText = parts[3];
        const version = versionText ? Number.parseInt(versionText, 10) : NaN;
        if (!policySetKey) {
          console.log(chalk.red('  Usage: /engine policy-sets get <policy-set-key> [version]'));
          return { handled: true };
        }
        await listPolicySetsView(policySetKey, Number.isFinite(version) ? version : undefined);
        return { handled: true };
      }
      const policySetKey = parts[1];
      await listPolicySetsView(policySetKey);
      return { handled: true };
    }

    case 'dlq': {
      const action = parts[1]?.toLowerCase();
      if (action === 'retry') {
        const brandRef = parts[2];
        const dlqId = parts[3];
        if (!brandRef || !dlqId) {
          console.log(chalk.red('  Usage: /engine dlq retry <brand-slug|brand-id> <dlq-id>'));
          return { handled: true };
        }
        await retryBrandDlqItem(brandRef, dlqId, ctx.cwd);
        return { handled: true };
      }
      if (action === 'resolve') {
        const brandRef = parts[2];
        const dlqId = parts[3];
        const resolutionAction = parts[4];
        const notes = parts.slice(5).join(' ').trim() || undefined;
        if (!brandRef || !dlqId) {
          console.log(
            chalk.red(
              '  Usage: /engine dlq resolve <brand-slug|brand-id> <dlq-id> [action] [notes]',
            ),
          );
          return { handled: true };
        }
        await resolveBrandDlqItem(
          brandRef,
          dlqId,
          {
            action: resolutionAction,
            notes,
          },
          ctx.cwd,
        );
        return { handled: true };
      }

      const brandRef = parts[1];
      if (!brandRef) {
        console.log(chalk.red('  Usage: /engine dlq <brand-slug|brand-id> [status]'));
        return { handled: true };
      }
      await showBrandDlq(brandRef, { status: parts[2], limit: 20, offset: 0 }, ctx.cwd);
      return { handled: true };
    }

    default:
      // Fall through to agent for natural language engine queries
      return {
        handled: true,
        sendMessage: `Use the workflow engine tools to: ${parts.join(' ')}`,
      };
  }
}

export async function handleWorkflowsCommand(
  input: string,
  _ctx: ChatContext,
): Promise<CommandResult> {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed.startsWith('/workflows') && !trimmed.startsWith('/wf')) {
    return NOT_HANDLED;
  }

  const parts = input.trim().split(/\s+/).slice(1);
  const subcommand = parts[0]?.toLowerCase() ?? '';
  const arg = parts[1] ?? '';

  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return { handled: true };
  }

  const client = new EngineClient(config);

  switch (subcommand) {
    case '':
    case 'list': {
      const brandRef = parts[1];
      if (!brandRef) {
        console.log(chalk.red('  Usage: /workflows list <brand-slug|brand-id> [status]'));
        return { handled: true };
      }
      await listBrandExecutions(brandRef, { status: parts[2], limit: 20, offset: 0 });
      return { handled: true };
    }

    case 'status': {
      if (!arg) {
        console.log(chalk.red('  Usage: /workflows status <workflow-id>'));
        return { handled: true };
      }
      try {
        const result = await client.getWorkflowStatus(arg);
        console.log(chalk.gray(JSON.stringify(result, null, 2)));
      } catch (err) {
        const msg = err instanceof EngineClientError ? err.message : String(err);
        console.log(chalk.red(`  Error: ${msg}`));
      }
      return { handled: true };
    }

    case 'cancel': {
      if (!arg) {
        console.log(chalk.red('  Usage: /workflows cancel <workflow-id>'));
        return { handled: true };
      }
      try {
        await client.cancelWorkflow(arg);
        console.log(chalk.green(`  Workflow ${arg} cancelled.`));
      } catch (err) {
        const msg = err instanceof EngineClientError ? err.message : String(err);
        console.log(chalk.red(`  Error: ${msg}`));
      }
      return { handled: true };
    }

    case 'terminate': {
      if (!arg) {
        console.log(chalk.red('  Usage: /workflows terminate <workflow-id>'));
        return { handled: true };
      }
      try {
        await client.terminateWorkflow(arg);
        console.log(chalk.green(`  Workflow ${arg} terminated.`));
      } catch (err) {
        const msg = err instanceof EngineClientError ? err.message : String(err);
        console.log(chalk.red(`  Error: ${msg}`));
      }
      return { handled: true };
    }

    case 'restart': {
      if (!arg) {
        console.log(chalk.red('  Usage: /workflows restart <workflow-id>'));
        return { handled: true };
      }
      try {
        await client.restartWorkflow(arg);
        console.log(chalk.green(`  Workflow ${arg} restarted.`));
      } catch (err) {
        const msg = err instanceof EngineClientError ? err.message : String(err);
        console.log(chalk.red(`  Error: ${msg}`));
      }
      return { handled: true };
    }

    case 'review': {
      if (!arg) {
        console.log(
          chalk.red('  Usage: /workflows review <workflow-id> <approve|reject> [reason]'),
        );
        return { handled: true };
      }
      const decisionToken = parts[2]?.toLowerCase();
      if (
        !decisionToken ||
        !['approve', 'approved', 'reject', 'rejected'].includes(decisionToken)
      ) {
        console.log(
          chalk.red('  Usage: /workflows review <workflow-id> <approve|reject> [reason]'),
        );
        return { handled: true };
      }
      const approved = decisionToken === 'approve' || decisionToken === 'approved';
      const reason = parts.slice(3).join(' ').trim() || undefined;
      try {
        await client.reviewWorkflow(arg, { approved, reason });
        console.log(
          chalk.green(`  Workflow ${arg} review sent (${approved ? 'approved' : 'rejected'}).`),
        );
      } catch (err) {
        const msg = err instanceof EngineClientError ? err.message : String(err);
        console.log(chalk.red(`  Error: ${msg}`));
      }
      return { handled: true };
    }

    case 'start': {
      // Delegate to agent for interactive workflow start
      const brand = parts[1] ?? '';
      const ticketId = parts[2] ?? '';
      if (!brand || !ticketId) {
        return {
          handled: true,
          sendMessage:
            'Start a workflow: I need a brand slug and ticket ID. Use the engine_start_workflow tool.',
        };
      }
      return {
        handled: true,
        sendMessage: `Start a response automation workflow for brand "${brand}" with ticket ID "${ticketId}".`,
      };
    }

    case 'retry': {
      if (!arg) {
        console.log(chalk.red('  Usage: /workflows retry <brand-id>'));
        console.log(chalk.gray('  Lists and retries failed DLQ items for a brand.'));
        return { handled: true };
      }
      try {
        const result = (await client.listDlq(arg, { status: 'pending', limit: 10 })) as {
          items?: Array<Record<string, unknown>>;
        };
        const items =
          result?.items ??
          (Array.isArray(result) ? (result as Array<Record<string, unknown>>) : []);
        if (!items.length) {
          console.log(chalk.gray('  No pending DLQ items to retry.'));
          return { handled: true };
        }
        console.log(chalk.bold(`  Retrying ${items.length} DLQ items...`));
        let retried = 0;
        for (const item of items) {
          try {
            await client.retryDlqItem(arg, String(item.id));
            retried++;
          } catch {
            console.log(chalk.yellow(`  Failed to retry ${String(item.id).slice(0, 8)}`));
          }
        }
        console.log(chalk.green(`  Retried ${retried}/${items.length} items.`));
      } catch (err) {
        const msg = err instanceof EngineClientError ? err.message : String(err);
        console.log(chalk.red(`  Error: ${msg}`));
      }
      return { handled: true };
    }

    default:
      return {
        handled: true,
        sendMessage: `Use the workflow engine tools to: workflows ${parts.join(' ')}`,
      };
  }
}
