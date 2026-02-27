import fs from 'node:fs';
import path from 'node:path';
import { getStateSetDir } from '../session.js';
import { readJsonFile } from '../utils/file-read.js';
import { ensureDirExists } from './utils.js';
import type { PermissionDecision, PermissionStore } from './types.js';

export function getPermissionStorePath(): string {
  return path.join(getStateSetDir(), 'permissions.json');
}

export function readPermissionStore(): PermissionStore {
  const filePath = getPermissionStorePath();
  try {
    const parsed = parsePolicyFile(filePath);
    return parsed;
  } catch {
    return { toolHooks: {} };
  }
}

export function writePermissionStore(store: PermissionStore): void {
  const filePath = getPermissionStorePath();
  ensureDirExists(filePath);
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

export function getPolicyOverridesPath(cwd: string): string {
  return path.join(cwd, '.stateset', 'policies.json');
}

export function parsePolicyFile(filePath: string): PermissionStore {
  try {
    const parsed = readJsonFile(filePath, {
      label: 'policy file',
      maxBytes: MAX_POLICY_FILE_SIZE_BYTES,
      expectObject: true,
    });
    return normalizeToolHooks(parsed);
  } catch {
    return { toolHooks: {} };
  }
}

const MAX_POLICY_FILE_SIZE_BYTES = 1_048_576;

export function readPolicyOverridesDetailed(cwd: string): {
  localPath: string;
  globalPath: string;
  local: PermissionStore;
  global: PermissionStore;
  merged: PermissionStore;
} {
  const localPath = getPolicyOverridesPath(cwd);
  const globalPath = path.join(getStateSetDir(), 'policies.json');
  const local = parsePolicyFile(localPath);
  const global = parsePolicyFile(globalPath);
  return {
    localPath,
    globalPath,
    local,
    global,
    merged: { toolHooks: { ...global.toolHooks, ...local.toolHooks } },
  };
}

export function writePolicyOverrides(cwd: string, data: PermissionStore): void {
  const pathToWrite = getPolicyOverridesPath(cwd);
  ensureDirExists(pathToWrite);
  fs.writeFileSync(pathToWrite, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

export function readPolicyFile(pathInput: string): PermissionStore {
  const resolved = path.resolve(pathInput);
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(resolved);
  } catch {
    throw new Error(`Policy file not found: ${resolved}`);
  }
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to read policy from symlink: ${resolved}`);
  }
  if (!stats.isFile()) {
    throw new Error(`Policy import path must be a file: ${resolved}`);
  }
  if (stats.size > MAX_POLICY_FILE_SIZE_BYTES) {
    throw new Error(`Policy file too large (${stats.size} bytes): ${resolved}`);
  }
  let parsed: unknown;
  try {
    parsed = readJsonFile(resolved, {
      label: 'policy file',
      maxBytes: MAX_POLICY_FILE_SIZE_BYTES,
      expectObject: true,
    });
  } catch {
    throw new Error(`Failed to parse policy file: ${resolved}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid policy format in file: ${resolved}`);
  }
  const rawToolHooks = (parsed as { toolHooks?: unknown }).toolHooks;
  if (!rawToolHooks || typeof rawToolHooks !== 'object' || Array.isArray(rawToolHooks)) {
    throw new Error(`Invalid policy format in file: ${resolved}`);
  }
  const toolHooks: Record<string, PermissionDecision> = {};
  for (const [key, value] of Object.entries(rawToolHooks as Record<string, unknown>)) {
    if (value === 'allow' || value === 'deny') {
      toolHooks[key] = value;
    }
  }
  return { toolHooks };
}

function normalizeToolHooks(value: unknown): PermissionStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { toolHooks: {} };
  }
  const rawToolHooks = (value as { toolHooks?: unknown }).toolHooks;
  const toolHooks: Record<string, PermissionDecision> = {};
  if (rawToolHooks && typeof rawToolHooks === 'object' && !Array.isArray(rawToolHooks)) {
    for (const [key, value] of Object.entries(rawToolHooks)) {
      if (value === 'allow' || value === 'deny') {
        toolHooks[key] = value;
      }
    }
  }
  return { toolHooks };
}

export function makeHookPermissionKey(hookName: string, toolName: string): string {
  return `${hookName}::${toolName}`;
}
