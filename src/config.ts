import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { encryptSecret, decryptSecret, isEncrypted } from './lib/secrets.js';

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

const CONFIG_DIR = path.join(os.homedir(), '.stateset');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

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

export function loadConfig(): StateSetConfig {
  if (!configExists()) {
    throw new Error(
      'No configuration found. Run "response auth login" to set up your credentials.'
    );
  }
  const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
  const config = JSON.parse(raw) as StateSetConfig;

  // Decrypt secrets on load
  if (config.anthropicApiKey) {
    config.anthropicApiKey = decryptSecret(config.anthropicApiKey);
  }
  for (const orgId of Object.keys(config.organizations)) {
    const org = config.organizations[orgId];
    if (org.cliToken) {
      org.cliToken = decryptSecret(org.cliToken);
    }
    if (org.adminSecret) {
      org.adminSecret = decryptSecret(org.adminSecret);
    }
  }

  return config;
}

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

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(configToSave, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  try {
    fs.chmodSync(CONFIG_FILE, 0o600);
  } catch {
    // Best-effort on non-POSIX systems
  }
}

export function getCurrentOrg(): { orgId: string; config: OrgConfig } {
  const cfg = loadConfig();
  const orgConfig = cfg.organizations[cfg.currentOrg];
  if (!orgConfig) {
    throw new Error(
      `Organization "${cfg.currentOrg}" not found in config. Run "response auth login" or "response auth switch <org-id>".`
    );
  }
  if (!orgConfig.cliToken && !orgConfig.adminSecret) {
    throw new Error(
      `Organization "${cfg.currentOrg}" is missing credentials. Run "response auth login" to set up your credentials.`
    );
  }
  return { orgId: cfg.currentOrg, config: orgConfig };
}

export function getAnthropicApiKey(): string {
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) return envKey;

  if (configExists()) {
    const cfg = loadConfig();
    if (cfg.anthropicApiKey) return cfg.anthropicApiKey;
  }

  throw new Error(
    'No Anthropic API key found. Set ANTHROPIC_API_KEY env var or run "response auth login".'
  );
}

export function getConfiguredModel(): ModelId {
  if (configExists()) {
    const cfg = loadConfig();
    if (cfg.model) return cfg.model;
  }
  return DEFAULT_MODEL;
}

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
  const config = JSON.parse(raw) as StateSetConfig;
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
