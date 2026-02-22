import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import { encryptSecret, decryptSecret, isEncrypted } from './lib/secrets.js';
import { ConfigurationError, getErrorMessage } from './lib/errors.js';
import { readJsonFile } from './utils/file-read.js';

export interface OrgConfig {
  name: string;
  graphqlEndpoint: string;
  adminSecret?: string;
  cliToken?: string;
}

export const MODEL_IDS = [
  'claude-sonnet-4-6-20250514',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-6-20250514',
] as const;

export type ModelId = (typeof MODEL_IDS)[number];

export const DEFAULT_MODEL: ModelId = MODEL_IDS[0];
export const MODEL_ALIAS_NAMES = ['sonnet', 'haiku', 'opus'] as const;

export const MODEL_ALIASES: Record<(typeof MODEL_ALIAS_NAMES)[number], ModelId> = {
  sonnet: 'claude-sonnet-4-6-20250514',
  haiku: 'claude-haiku-4-5-20251001',
  opus: 'claude-opus-4-6-20250514',
};
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
const OrgConfigSchema = z.object({
  name: z.string().min(1),
  graphqlEndpoint: z.string().min(1),
  adminSecret: z.string().optional(),
  cliToken: z.string().optional(),
});

const StateSetConfigSchema = z.object({
  currentOrg: z.string().min(1),
  anthropicApiKey: z.string().optional(),
  model: z.enum(MODEL_IDS).optional(),
  organizations: z.record(z.string(), OrgConfigSchema),
});

const CONFIG_DIR = path.join(os.homedir(), '.stateset');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

/** Returns the absolute path to ~/.stateset/config.json. */
export function getConfigPath(): string {
  return CONFIG_FILE;
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
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  try {
    fs.chmodSync(CONFIG_DIR, 0o700);
  } catch {
    // Best-effort on non-POSIX systems
  }
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_FILE);
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
    parsed = readJsonFile(CONFIG_FILE, { label: 'config file', expectObject: true });
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
      `Invalid configuration:\n${issues}\n\nFix the config at ${CONFIG_FILE} or run "response auth login".`,
    );
  }

  const config = result.data as StateSetConfig;

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
    configToSave.organizations[orgId] = org;
  }

  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configToSave, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  } catch (e) {
    throw new ConfigurationError(`Failed to write config file: ${getErrorMessage(e)}`);
  }
  try {
    fs.chmodSync(CONFIG_FILE, 0o600);
  } catch {
    // Best-effort on non-POSIX systems
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

export function getRuntimeContext(): RuntimeContext {
  const { orgId, config: orgConfig } = getCurrentOrg();
  const anthropicApiKey = getAnthropicApiKey();
  return { orgId, orgConfig, anthropicApiKey };
}

/** Returns the Anthropic API key from ANTHROPIC_API_KEY env var, falling back to config. */
export function getAnthropicApiKey(): string {
  const envKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (envKey) return envKey;

  if (configExists()) {
    const cfg = loadConfig();
    const trimmed = cfg.anthropicApiKey?.trim();
    if (trimmed) return trimmed;
  }

  throw new Error(
    'No Anthropic API key found. Set ANTHROPIC_API_KEY env var or run "response auth login".',
  );
}

/** Returns the model from config, defaulting to DEFAULT_MODEL if unset. */
export function getConfiguredModel(): ModelId {
  if (configExists()) {
    const cfg = loadConfig();
    if (cfg.model) return cfg.model;
  }
  return DEFAULT_MODEL;
}

/** Maps a model alias (e.g. "sonnet", "opus") or full ID to a valid ModelId. Returns null if unrecognized. */
export function resolveModel(input: string): ModelId | null {
  const lower = input.toLowerCase().trim();
  const alias = lower as (typeof MODEL_ALIAS_NAMES)[number];
  if (alias in MODEL_ALIASES) return MODEL_ALIASES[alias];
  if (MODEL_ID_SET.has(lower as ModelId)) return lower as ModelId;
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
    const parsed = readJsonFile(CONFIG_FILE, { label: 'config file', expectObject: true });
    const parsedConfig = StateSetConfigSchema.safeParse(parsed);
    if (!parsedConfig.success) {
      return false;
    }

    const config = { ...parsedConfig.data } as StateSetConfig;
    const normalizedConfig: StateSetConfig = {
      currentOrg: config.currentOrg,
      model: config.model,
      anthropicApiKey: config.anthropicApiKey,
      organizations: { ...config.organizations },
    };

    let migrated = false;
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
