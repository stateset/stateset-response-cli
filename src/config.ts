import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import { encryptSecret, decryptSecret, isEncrypted } from './lib/secrets.js';
import { ConfigurationError } from './lib/errors.js';

export interface OrgConfig {
  name: string;
  graphqlEndpoint: string;
  adminSecret?: string;
  cliToken?: string;
}

export type ModelId =
  | 'claude-sonnet-4-20250514'
  | 'claude-haiku-35-20241022'
  | 'claude-opus-4-20250514';

export const DEFAULT_MODEL: ModelId = 'claude-sonnet-4-20250514';

export const MODEL_ALIASES: Record<string, ModelId> = {
  sonnet: 'claude-sonnet-4-20250514',
  haiku: 'claude-haiku-35-20241022',
  opus: 'claude-opus-4-20250514',
};

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
  model: z
    .enum(['claude-sonnet-4-20250514', 'claude-haiku-35-20241022', 'claude-opus-4-20250514'])
    .optional(),
  organizations: z.record(z.string(), OrgConfigSchema),
});

const CONFIG_DIR = path.join(os.homedir(), '.stateset');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

/** Returns the absolute path to ~/.stateset/config.json. */
export function getConfigPath(): string {
  return CONFIG_FILE;
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
  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
  } catch (e) {
    throw new ConfigurationError(
      `Failed to read config file: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ConfigurationError(
      `Invalid JSON in config file: ${e instanceof Error ? e.message : String(e)}`,
    );
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
    const decrypted = decryptSecret(config.anthropicApiKey).trim();
    config.anthropicApiKey = decrypted.length > 0 ? decrypted : undefined;
  }
  for (const orgId of Object.keys(config.organizations)) {
    const org = config.organizations[orgId];
    if (org.cliToken) {
      const decrypted = decryptSecret(org.cliToken).trim();
      org.cliToken = decrypted.length > 0 ? decrypted : undefined;
    }
    if (org.adminSecret) {
      const decrypted = decryptSecret(org.adminSecret).trim();
      org.adminSecret = decrypted.length > 0 ? decrypted : undefined;
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
    throw new ConfigurationError(
      `Failed to write config file: ${e instanceof Error ? e.message : String(e)}`,
    );
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
    throw new Error(
      `Organization "${cfg.currentOrg}" not found in config. Run "response auth login" or "response auth switch <org-id>".`,
    );
  }
  const hasCliToken =
    typeof orgConfig.cliToken === 'string' && orgConfig.cliToken.trim().length > 0;
  const hasAdminSecret =
    typeof orgConfig.adminSecret === 'string' && orgConfig.adminSecret.trim().length > 0;
  if (!hasCliToken && !hasAdminSecret) {
    throw new Error(
      `Organization "${cfg.currentOrg}" is missing credentials. Run "response auth login" to set up your credentials.`,
    );
  }
  return { orgId: cfg.currentOrg, config: orgConfig };
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
  if (MODEL_ALIASES[lower]) return MODEL_ALIASES[lower];
  const valid: ModelId[] = [
    'claude-sonnet-4-20250514',
    'claude-haiku-35-20241022',
    'claude-opus-4-20250514',
  ];
  if (valid.includes(lower as ModelId)) return lower as ModelId;
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

  const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
  let config: StateSetConfig;
  try {
    config = JSON.parse(raw) as StateSetConfig;
  } catch {
    return false;
  }
  let migrated = false;

  // Check if any secrets need encryption
  if (config.anthropicApiKey && !isEncrypted(config.anthropicApiKey)) {
    migrated = true;
  }
  for (const orgId of Object.keys(config.organizations)) {
    const org = config.organizations[orgId];
    if (org.cliToken && !isEncrypted(org.cliToken)) {
      migrated = true;
    }
    if (org.adminSecret && !isEncrypted(org.adminSecret)) {
      migrated = true;
    }
  }

  if (migrated) {
    // Load (which decrypts already encrypted values) and save (which encrypts all)
    const loadedConfig = loadConfig();
    saveConfig(loadedConfig);
  }

  return migrated;
}
