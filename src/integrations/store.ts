import fs from 'node:fs';
import path from 'node:path';
import { getStateSetDir } from '../session.js';
import { decryptConfigSecrets, encryptConfigSecrets } from '../lib/secrets.js';
import { readJsonFile } from '../utils/file-read.js';
import { type IntegrationId, getIntegrationSecretKeys } from './registry.js';

export interface IntegrationEntry {
  enabled?: boolean;
  config?: Record<string, string>;
  updatedAt?: string;
}

export interface IntegrationsStore {
  version: number;
  integrations: Record<string, IntegrationEntry>;
}

export type IntegrationStoreScope = 'local' | 'global';

const STORE_VERSION = 1;

function normalizeStore(raw: IntegrationsStore | null): IntegrationsStore {
  if (!raw || typeof raw !== 'object') {
    return { version: STORE_VERSION, integrations: {} };
  }
  return {
    version: raw.version || STORE_VERSION,
    integrations: raw.integrations && typeof raw.integrations === 'object' ? raw.integrations : {},
  };
}

export function getIntegrationsPath(cwd: string, scope: IntegrationStoreScope): string {
  if (scope === 'local') {
    return path.join(cwd, '.stateset', 'integrations.json');
  }
  return path.join(getStateSetDir(), 'integrations.json');
}

function readStoreFile(filePath: string): IntegrationsStore | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = readJsonFile(filePath, {
      label: 'integrations store',
      expectObject: true,
    }) as IntegrationsStore;
    return normalizeStore(raw);
  } catch {
    return null;
  }
}

function writeStoreFile(filePath: string, store: IntegrationsStore): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

function decryptEntry(id: IntegrationId, entry: IntegrationEntry): IntegrationEntry {
  if (!entry.config) return entry;
  const secretKeys = getIntegrationSecretKeys(id);
  return {
    ...entry,
    config: decryptConfigSecrets(entry.config, secretKeys),
  };
}

function encryptEntry(id: IntegrationId, entry: IntegrationEntry): IntegrationEntry {
  if (!entry.config) return entry;
  const secretKeys = getIntegrationSecretKeys(id);
  return {
    ...entry,
    config: encryptConfigSecrets(entry.config, secretKeys),
  };
}

export function loadIntegrationsStore(cwd: string = process.cwd()): {
  scope: IntegrationStoreScope | null;
  path?: string;
  store: IntegrationsStore;
} {
  const localPath = getIntegrationsPath(cwd, 'local');
  const globalPath = getIntegrationsPath(cwd, 'global');

  const local = readStoreFile(localPath);
  if (local) {
    return { scope: 'local', path: localPath, store: decryptStore(local) };
  }

  const global = readStoreFile(globalPath);
  if (global) {
    return { scope: 'global', path: globalPath, store: decryptStore(global) };
  }

  return { scope: null, store: { version: STORE_VERSION, integrations: {} } };
}

export function loadIntegrationsStoreForScope(
  cwd: string,
  scope: IntegrationStoreScope,
): { path: string; store: IntegrationsStore } {
  const filePath = getIntegrationsPath(cwd, scope);
  const raw = readStoreFile(filePath);
  const store = raw ? decryptStore(raw) : { version: STORE_VERSION, integrations: {} };
  return { path: filePath, store };
}

export function saveIntegrationsStore(
  cwd: string,
  scope: IntegrationStoreScope,
  store: IntegrationsStore,
): string {
  const filePath = getIntegrationsPath(cwd, scope);
  const encrypted = encryptStore(store);
  writeStoreFile(filePath, encrypted);
  return filePath;
}

export function getIntegrationConfigFromStore(
  id: IntegrationId,
  cwd: string = process.cwd(),
): Record<string, string> | null {
  const { store } = loadIntegrationsStore(cwd);
  const entry = store.integrations[id];
  if (!entry) return null;
  if (entry.enabled === false) return null;
  return entry.config ?? null;
}

export function getIntegrationEntryFromStore(
  id: IntegrationId,
  cwd: string = process.cwd(),
): IntegrationEntry | null {
  const { store } = loadIntegrationsStore(cwd);
  return store.integrations[id] ?? null;
}

export function decryptStore(store: IntegrationsStore): IntegrationsStore {
  const integrations: Record<string, IntegrationEntry> = {};
  for (const [id, entry] of Object.entries(store.integrations || {})) {
    if (!entry) continue;
    if (id in store.integrations) {
      integrations[id] = decryptEntry(id as IntegrationId, entry);
    }
  }
  return { version: store.version || STORE_VERSION, integrations };
}

export function encryptStore(store: IntegrationsStore): IntegrationsStore {
  const integrations: Record<string, IntegrationEntry> = {};
  for (const [id, entry] of Object.entries(store.integrations || {})) {
    if (!entry) continue;
    integrations[id] = encryptEntry(id as IntegrationId, entry);
  }
  return { version: store.version || STORE_VERSION, integrations };
}
