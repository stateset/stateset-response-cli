import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import { encryptSecret, decryptSecret, isEncrypted } from './lib/secrets.js';
import { ConfigurationError, getErrorMessage } from './lib/errors.js';
import { readJsonFile } from './utils/file-read.js';
import { ensurePrivateDirectory, writePrivateTextFileSecure } from './utils/secure-file.js';

export interface WorkflowEngineConfig {
  url: string;
  apiKey: string;
  tenantId?: string;
}

export interface OrgConfig {
  name: string;
  graphqlEndpoint: string;
  adminSecret?: string;
  cliToken?: string;
  workflowEngine?: WorkflowEngineConfig;
}

export const MODEL_IDS = [
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-6-20250514',
] as const;

export type ModelId = (typeof MODEL_IDS)[number];
type LegacyModelId = 'claude-sonnet-4-6-20250514';
type AllowedModelId = ModelId | LegacyModelId;

export const DEFAULT_MODEL: ModelId = MODEL_IDS[0];
export const MODEL_ALIAS_NAMES = ['sonnet', 'haiku', 'opus'] as const;

export const MODEL_ALIASES: Record<(typeof MODEL_ALIAS_NAMES)[number], ModelId> = {
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
  opus: 'claude-opus-4-6-20250514',
};
const LEGACY_MODEL_ALIASES: Record<LegacyModelId, ModelId> = {
  'claude-sonnet-4-6-20250514': 'claude-sonnet-4-6',
};
const ALLOWED_MODEL_IDS = [...MODEL_IDS, ...Object.keys(LEGACY_MODEL_ALIASES)] as const;
const MODEL_ID_SET = new Set<ModelId>(MODEL_IDS);

export function getModelAliasText(style: 'or' | 'list' = 'or'): string {
  if (style === 'list') {
    return MODEL_ALIAS_NAMES.join(', ');
  }
  if (MODEL_ALIAS_NAMES.length <= 1) {
    return MODEL_ALIAS_NAMES[0];
  }
  return `${MODEL_ALIAS_NAMES.slice(0, -1).join(', ')}, or ${MODEL_ALIAS_NAMES[MODEL_ALIAS_NAMES.length - 1]}`;
}

export function formatUnknownModelError(input: string, style: 'use' | 'valid' = 'use'): string {
  const aliases = getModelAliasText(style === 'use' ? 'or' : 'list');
  return style === 'valid'
    ? `Unknown model "${input}". Valid: ${aliases}`
    : `Unknown model "${input}". Use ${aliases}`;
}

export function resolveModelOrThrow(input: string, style: 'use' | 'valid' = 'use'): ModelId {
  const resolved = resolveModel(input);
  if (!resolved) {
    throw new Error(formatUnknownModelError(input, style));
  }
  return resolved;
}

export interface StateSetConfig {
  currentOrg: string;
  anthropicApiKey?: string;
  model?: ModelId;
  organizations: Record<string, OrgConfig>;
}

// Zod schemas for runtime validation
const WorkflowEngineConfigSchema = z.object({
  url: z.string().min(1),
  apiKey: z.string().min(1),
  tenantId: z.string().optional(),
});

const OrgConfigSchema = z.object({
  name: z.string().min(1),
  graphqlEndpoint: z.string().min(1),
  adminSecret: z.string().optional(),
  cliToken: z.string().optional(),
  workflowEngine: WorkflowEngineConfigSchema.optional(),
});

const StateSetConfigSchema = z.object({
  currentOrg: z.string().min(1),
  anthropicApiKey: z.string().optional(),
  model: z.enum(ALLOWED_MODEL_IDS).optional(),
  organizations: z.record(z.string(), OrgConfigSchema),
});

function getConfigDir(): string {
  return process.env.STATESET_STATE_DIR?.trim() || path.join(os.homedir(), '.stateset');
}

function getConfigFile(): string {
  return process.env.STATESET_CONFIG_PATH?.trim() || path.join(getConfigDir(), 'config.json');
}

/** Returns the absolute path to ~/.stateset/config.json. */
export function getConfigPath(): string {
  return getConfigFile();
}

type DecryptResult = { value: string | undefined; error?: string };

function tryDecryptConfigSecret(value: string, label: string): DecryptResult {
  try {
    const decrypted = decryptSecret(value).trim();
    return { value: decrypted.length > 0 ? decrypted : undefined };
  } catch (error) {
    return {
      value: undefined,
      error: `${label}: ${getErrorMessage(error)}`,
    };
  }
}

export function ensureConfigDir(): void {
  ensurePrivateDirectory(getConfigDir(), {
    symlinkErrorPrefix: 'Refusing to use symlinked config directory',
    nonDirectoryErrorPrefix: 'Config directory path is not a directory',
  });
}

export function configExists(): boolean {
  return fs.existsSync(getConfigFile());
}

/** Reads, validates, and decrypts the config from disk. Throws ConfigurationError on failure. */
export function loadConfig(): StateSetConfig {
  if (!configExists()) {
    throw new ConfigurationError(
      'No configuration found. Run "response auth login" to set up your credentials.',
    );
  }
  try {
    migrateConfigSecrets();
  } catch {
    // Keep migration best-effort; config loading should continue even if migration fails.
  }
  let parsed: unknown;
  try {
    parsed = readJsonFile(getConfigFile(), { label: 'config file', expectObject: true });
  } catch (e) {
    const message = getErrorMessage(e);
    if (message.includes('Invalid JSON in')) {
      if (message.includes('Invalid JSON in config file')) {
        throw new ConfigurationError(message);
      }
      throw new ConfigurationError(`Invalid JSON in config file: ${message}`);
    }
    throw new ConfigurationError(`Failed to read config file: ${message}`);
  }

  const result = StateSetConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new ConfigurationError(
      `Invalid configuration:\n${issues}\n\nFix the config at ${getConfigFile()} or run "response auth login".`,
    );
  }

  const parsedConfig = result.data as Omit<StateSetConfig, 'model'> & { model?: AllowedModelId };
  const normalizedModel = parsedConfig.model ? resolveModel(parsedConfig.model) : null;
  if (parsedConfig.model && !normalizedModel) {
    throw new ConfigurationError(
      `Invalid configuration:\n  - model: Unknown model "${parsedConfig.model}"`,
    );
  }
  const config: StateSetConfig = {
    ...parsedConfig,
    model: normalizedModel ?? undefined,
  };

  // Decrypt secrets on load
  if (config.anthropicApiKey) {
    const decrypted = tryDecryptConfigSecret(config.anthropicApiKey, 'ANTHROPIC API key');
    if (decrypted.error) {
      throw new ConfigurationError(decrypted.error);
    }
    config.anthropicApiKey = decrypted.value;
  }

  // Decrypt only the current organization's credentials to avoid failure if unrelated
  // organizations have legacy or corrupted secret values.
  const activeOrg = config.organizations[config.currentOrg];
  if (activeOrg) {
    const hadActiveOrgCliToken =
      typeof activeOrg.cliToken === 'string' && activeOrg.cliToken.trim().length > 0;
    const hadActiveOrgAdminSecret =
      typeof activeOrg.adminSecret === 'string' && activeOrg.adminSecret.trim().length > 0;
    const activeOrgErrors: string[] = [];

    if (activeOrg.cliToken) {
      const decrypted = tryDecryptConfigSecret(
        activeOrg.cliToken,
        `cli token for organization "${config.currentOrg}"`,
      );
      if (decrypted.error) {
        activeOrg.cliToken = undefined;
        activeOrgErrors.push(decrypted.error);
      } else {
        activeOrg.cliToken = decrypted.value;
      }
    }
    if (activeOrg.adminSecret) {
      const decrypted = tryDecryptConfigSecret(
        activeOrg.adminSecret,
        `admin secret for organization "${config.currentOrg}"`,
      );
      if (decrypted.error) {
        activeOrg.adminSecret = undefined;
        activeOrgErrors.push(decrypted.error);
      } else {
        activeOrg.adminSecret = decrypted.value;
      }
    }

    const hasNoUsableActiveOrgCredentials = !activeOrg.cliToken && !activeOrg.adminSecret;
    if (
      hasNoUsableActiveOrgCredentials &&
      (hadActiveOrgCliToken || hadActiveOrgAdminSecret) &&
      activeOrgErrors.length > 0
    ) {
      throw new ConfigurationError(
        `Failed to decrypt credentials for organization "${config.currentOrg}": ${activeOrgErrors.join(' ')}`,
      );
    }

    if (activeOrg.workflowEngine?.apiKey) {
      const decrypted = tryDecryptConfigSecret(
        activeOrg.workflowEngine.apiKey,
        `workflow engine API key for organization "${config.currentOrg}"`,
      );
      if (decrypted.error) {
        activeOrg.workflowEngine.apiKey = '';
      } else if (decrypted.value) {
        activeOrg.workflowEngine.apiKey = decrypted.value;
      }
    }
  }

  return config;
}

/** Encrypts secrets and writes config to disk with restrictive file permissions (0o600). */
export function saveConfig(config: StateSetConfig): void {
  ensureConfigDir();

  // Deep copy and encrypt secrets before saving
  const configToSave: StateSetConfig = {
    ...config,
    organizations: { ...config.organizations },
  };

  if (configToSave.anthropicApiKey) {
    configToSave.anthropicApiKey = encryptSecret(configToSave.anthropicApiKey);
  }
  for (const orgId of Object.keys(configToSave.organizations)) {
    const org = { ...configToSave.organizations[orgId] };
    if (org.cliToken) {
      org.cliToken = encryptSecret(org.cliToken);
    }
    if (org.adminSecret) {
      org.adminSecret = encryptSecret(org.adminSecret);
    }
    if (org.workflowEngine?.apiKey) {
      org.workflowEngine = {
        ...org.workflowEngine,
        apiKey: encryptSecret(org.workflowEngine.apiKey),
      };
    }
    configToSave.organizations[orgId] = org;
  }

  try {
    writePrivateTextFileSecure(getConfigFile(), JSON.stringify(configToSave, null, 2), {
      label: 'Config file path',
    });
  } catch (e) {
    throw new ConfigurationError(`Failed to write config file: ${getErrorMessage(e)}`);
  }
}

/** Returns the currently active org ID and its config. Throws if credentials are missing. */
export function getCurrentOrg(): { orgId: string; config: OrgConfig } {
  const cfg = loadConfig();
  const orgConfig = cfg.organizations[cfg.currentOrg];
  if (!orgConfig) {
    throw new ConfigurationError(
      `Organization "${cfg.currentOrg}" not found in config. Run "response auth login" or "response auth switch <org-id>".`,
    );
  }
  const hasCliToken =
    typeof orgConfig.cliToken === 'string' && orgConfig.cliToken.trim().length > 0;
  const hasAdminSecret =
    typeof orgConfig.adminSecret === 'string' && orgConfig.adminSecret.trim().length > 0;
  if (!hasCliToken && !hasAdminSecret) {
    throw new ConfigurationError(
      `Organization "${cfg.currentOrg}" is missing credentials. Run "response auth login" to set up your credentials.`,
    );
  }
  return { orgId: cfg.currentOrg, config: orgConfig };
}

export interface RuntimeContext {
  orgId: string;
  orgConfig: OrgConfig;
  anthropicApiKey: string;
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
}

function allowInsecureHttp(): boolean {
  return isTruthyEnv(process.env.STATESET_ALLOW_INSECURE_HTTP);
}

export function getRuntimeContext(): RuntimeContext {
  const { orgId, config: orgConfig } = getCurrentOrg();
  const anthropicApiKey = getAnthropicApiKey();
  return { orgId, orgConfig, anthropicApiKey };
}

/**
 * Eagerly validate the full runtime config (org, credentials, endpoint, API key).
 * Call this at startup to surface all config problems immediately rather than
 * discovering them lazily during the first API call.
 */
export function validateRuntimeConfig(): RuntimeContext {
  const ctx = getRuntimeContext();

  // Validate GraphQL endpoint URL
  const endpoint = ctx.orgConfig.graphqlEndpoint?.trim();
  if (!endpoint) {
    throw new ConfigurationError(
      `Organization "${ctx.orgId}" has no GraphQL endpoint configured. Run "response auth login" to set up your organization.`,
    );
  }
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('unsupported protocol');
    }
    if (parsed.protocol === 'http:' && !allowInsecureHttp()) {
      throw new Error('insecure protocol');
    }
  } catch {
    const protocolHint = allowInsecureHttp() ? 'valid HTTP(S)' : 'valid HTTPS';
    throw new ConfigurationError(
      `Organization "${ctx.orgId}" has an invalid GraphQL endpoint: "${endpoint}". Expected a ${protocolHint} URL.`,
    );
  }

  return ctx;
}

/**
 * Basic format check for Anthropic API keys.
 * Rejects obviously invalid values without being overly strict.
 */
function isPlausibleApiKey(key: string): boolean {
  return key.startsWith('sk-ant-') && key.length >= 20;
}

/** Returns the Anthropic API key from ANTHROPIC_API_KEY env var, falling back to config. */
export function getAnthropicApiKey(): string {
  const envKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (envKey) {
    if (!isPlausibleApiKey(envKey)) {
      throw new ConfigurationError(
        'ANTHROPIC_API_KEY does not look like a valid Anthropic key (expected "sk-ant-..." prefix). ' +
          'Check that you copied the full key from https://console.anthropic.com.',
      );
    }
    return envKey;
  }

  if (configExists()) {
    const cfg = loadConfig();
    const trimmed = cfg.anthropicApiKey?.trim();
    if (trimmed) return trimmed;
  }

  throw new ConfigurationError(
    'No Anthropic API key found. Set ANTHROPIC_API_KEY env var or run "response auth login".',
  );
}

/**
 * Returns the workflow engine config for the current org, if configured.
 * Also checks WORKFLOW_ENGINE_URL / WORKFLOW_ENGINE_API_KEY env vars as overrides.
 */
export function getWorkflowEngineConfig(): WorkflowEngineConfig | null {
  const envUrl = process.env.WORKFLOW_ENGINE_URL?.trim();
  const envKey = process.env.WORKFLOW_ENGINE_API_KEY?.trim();

  if (envUrl && envKey) {
    return {
      url: envUrl,
      apiKey: envKey,
      tenantId: process.env.WORKFLOW_ENGINE_TENANT_ID?.trim(),
    };
  }

  if (!configExists()) return null;
  try {
    const cfg = loadConfig();
    const org = cfg.organizations[cfg.currentOrg];
    return org?.workflowEngine ?? null;
  } catch {
    return null;
  }
}

/** Returns the model from config, defaulting to DEFAULT_MODEL if unset. */
export function getConfiguredModel(): ModelId {
  if (configExists()) {
    const cfg = loadConfig();
    if (cfg.model) {
      const resolved = resolveModel(cfg.model);
      if (resolved) return resolved;
    }
  }
  return DEFAULT_MODEL;
}

/** Maps a model alias (e.g. "sonnet", "opus") or full ID to a valid ModelId. Returns null if unrecognized. */
export function resolveModel(input: string): ModelId | null {
  const lower = input.toLowerCase().trim();
  const alias = lower as (typeof MODEL_ALIAS_NAMES)[number];
  if (alias in MODEL_ALIASES) return MODEL_ALIASES[alias];
  if (MODEL_ID_SET.has(lower as ModelId)) return lower as ModelId;
  const legacy = LEGACY_MODEL_ALIASES[lower as LegacyModelId];
  if (legacy) return legacy;
  return null;
}

/**
 * Migrate existing plaintext config to encrypted format.
 * This is idempotent - already encrypted values are left unchanged.
 * Returns true if any values were migrated.
 */
export function migrateConfigSecrets(): boolean {
  if (!configExists()) {
    return false;
  }

  try {
    const parsed = readJsonFile(getConfigFile(), { label: 'config file', expectObject: true });
    const parsedConfig = StateSetConfigSchema.safeParse(parsed);
    if (!parsedConfig.success) {
      return false;
    }

    const config = { ...parsedConfig.data } as Omit<StateSetConfig, 'model'> & {
      model?: AllowedModelId;
    };
    const normalizedModel = config.model ? resolveModel(config.model) : null;
    const normalizedConfig: StateSetConfig = {
      currentOrg: config.currentOrg,
      model: normalizedModel ?? undefined,
      anthropicApiKey: config.anthropicApiKey,
      organizations: { ...config.organizations },
    };

    let migrated = false;
    if (config.model && normalizedModel && normalizedModel !== config.model) {
      migrated = true;
    }
    const next: StateSetConfig = {
      ...normalizedConfig,
      anthropicApiKey: normalizedConfig.anthropicApiKey,
      organizations: { ...normalizedConfig.organizations },
    };

    if (next.anthropicApiKey && !isEncrypted(next.anthropicApiKey)) {
      next.anthropicApiKey = encryptSecret(next.anthropicApiKey);
      migrated = true;
    }
    for (const orgId of Object.keys(next.organizations)) {
      const org = next.organizations[orgId];
      const current = { ...org };
      if (org.cliToken && !isEncrypted(org.cliToken)) {
        current.cliToken = encryptSecret(org.cliToken);
        migrated = true;
      }
      if (org.adminSecret && !isEncrypted(org.adminSecret)) {
        current.adminSecret = encryptSecret(org.adminSecret);
        migrated = true;
      }
      if (current.workflowEngine?.apiKey && !isEncrypted(current.workflowEngine.apiKey)) {
        current.workflowEngine = {
          ...current.workflowEngine,
          apiKey: encryptSecret(current.workflowEngine.apiKey),
        };
        migrated = true;
      }
      next.organizations[orgId] = current;
    }

    if (migrated) {
      try {
        saveConfig(next);
      } catch {
        return false;
      }
    }

    return migrated;
  } catch {
    return false;
  }
}
