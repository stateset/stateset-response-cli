import fs from 'node:fs';
import path from 'node:path';
import { getStateSetDir } from '../session.js';
import { ensureDirExists } from './utils.js';
import type { PermissionStore } from './types.js';

export function getPermissionStorePath(): string {
  return path.join(getStateSetDir(), 'permissions.json');
}

export function readPermissionStore(): PermissionStore {
  const filePath = getPermissionStorePath();
  if (!fs.existsSync(filePath)) return { toolHooks: {} };
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as PermissionStore;
    return parsed && parsed.toolHooks ? parsed : { toolHooks: {} };
  } catch {
    return { toolHooks: {} };
  }
}

export function writePermissionStore(store: PermissionStore): void {
  const filePath = getPermissionStorePath();
  ensureDirExists(filePath);
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

export function getPolicyOverridesPath(cwd: string): string {
  return path.join(cwd, '.stateset', 'policies.json');
}

export function parsePolicyFile(filePath: string): { toolHooks: Record<string, string> } {
  if (!fs.existsSync(filePath)) return { toolHooks: {} };
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as { toolHooks?: Record<string, string> };
    const toolHooks: Record<string, string> = {};
    if (parsed?.toolHooks && typeof parsed.toolHooks === 'object') {
      for (const [key, value] of Object.entries(parsed.toolHooks)) {
        if (value === 'allow' || value === 'deny') {
          toolHooks[key] = value;
        }
      }
    }
    return { toolHooks };
  } catch {
    return { toolHooks: {} };
  }
}

export function readPolicyOverridesDetailed(cwd: string): {
  localPath: string;
  globalPath: string;
  local: { toolHooks: Record<string, string> };
  global: { toolHooks: Record<string, string> };
  merged: { toolHooks: Record<string, string> };
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

export function writePolicyOverrides(
  cwd: string,
  data: { toolHooks: Record<string, string> },
): void {
  const pathToWrite = getPolicyOverridesPath(cwd);
  ensureDirExists(pathToWrite);
  fs.writeFileSync(pathToWrite, JSON.stringify(data, null, 2), 'utf-8');
}

export function readPolicyFile(pathInput: string): { toolHooks: Record<string, string> } {
  const resolved = path.resolve(pathInput);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Policy file not found: ${resolved}`);
  }
  return parsePolicyFile(resolved);
}

export function makeHookPermissionKey(hookName: string, toolName: string): string {
  return `${hookName}::${toolName}`;
}
