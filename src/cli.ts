#!/usr/bin/env node

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import * as readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  loadConfig,
  saveConfig,
  configExists,
  ensureConfigDir,
  getCurrentOrg,
  getAnthropicApiKey,
  getConfiguredModel,
  resolveModel,
  type StateSetConfig,
  type ModelId,
} from './config.js';
import { StateSetAgent } from './agent.js';
import { SessionStore, sanitizeSessionId, getSessionsDir, getStateSetDir, getSessionDir, type StoredMessage } from './session.js';
import { getSessionExportPath, resolveExportFilePath } from './utils/session-exports.js';
import { buildSystemPrompt } from './prompt.js';
import { loadMemory } from './memory.js';
import { buildUserContent } from './attachments.js';
import { EventsRunner, validateEventsPrereqs } from './events.js';
import { listIntegrations, type IntegrationDefinition, type IntegrationId } from './integrations/registry.js';
import {
  loadIntegrationsStore,
  loadIntegrationsStoreForScope,
  saveIntegrationsStore,
  type IntegrationStoreScope,
} from './integrations/store.js';
import {
  printWelcome,
  printAuthHelp,
  printHelp,
  formatAssistantMessage,
  formatError,
  formatSuccess,
  formatWarning,
  formatElapsed,
  formatToolCall,
  formatTable,
  formatUsage,
} from './utils/display.js';
import { exportOrg, importOrg } from './export-import.js';
import { getPromptTemplate, listPromptTemplates, getPromptTemplateFile, getSkill, listSkills } from './resources.js';
import { ExtensionManager } from './extensions.js';
const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version?: string };

const program = new Command();
assertNodeVersion();

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeInstanceUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  return trimmed;
}

function assertNodeVersion(): void {
  const raw = process.versions.node || '0.0.0';
  const major = Number.parseInt(raw.split('.')[0] || '0', 10);
  if (!Number.isFinite(major) || major < 18) {
    console.error(formatError(`Node.js 18+ is required. Detected ${raw}.`));
    process.exit(1);
  }
}

function parseToggleValue(value: string | undefined | null): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (['on', 'true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['off', 'false', '0', 'no', 'n'].includes(normalized)) return false;
  return undefined;
}

type InlineFlags = {
  apply?: boolean;
  redact?: boolean;
};

function extractInlineFlags(input: string): { text: string; flags: InlineFlags } {
  let text = input.trimEnd();
  const flags: InlineFlags = {};
  const pattern = /(?:^|\s)(--apply|--redact)\s*$/;

  let match = pattern.exec(text);
  while (match) {
    const flag = match[1];
    if (flag === '--apply') flags.apply = true;
    if (flag === '--redact') flags.redact = true;
    text = text.slice(0, match.index).trimEnd();
    match = pattern.exec(text);
  }

  return { text, flags };
}

function readBooleanEnv(name: string): boolean {
  return parseToggleValue(process.env[name]) ?? false;
}

function readFirstEnvValue(names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function getIntegrationEnvStatus(def: IntegrationDefinition): { status: string; anySet: boolean } {
  const requiredFields = def.fields.filter((field) => field.required !== false);
  const requiredSet = requiredFields.filter((field) => Boolean(readFirstEnvValue(field.envVars))).length;
  const anySet = def.fields.some((field) => Boolean(readFirstEnvValue(field.envVars)));
  if (!anySet) return { status: '-', anySet };
  if (requiredSet === requiredFields.length) return { status: 'set', anySet };
  return { status: 'partial', anySet };
}

function printIntegrationStatus(cwd: string): void {
  const integrations = listIntegrations();
  const { scope, path: storePath, store } = loadIntegrationsStore(cwd);
  const rows = integrations.map((def) => {
    const envStatus = getIntegrationEnvStatus(def).status;
    const entry = store.integrations[def.id];
    let configStatus = '-';
    if (entry) {
      if (entry.enabled === false) configStatus = 'disabled';
      else if (entry.config && Object.keys(entry.config).length > 0) configStatus = 'set';
      else configStatus = 'empty';
    }
    if (configStatus !== '-' && scope) {
      configStatus = `${configStatus} (${scope})`;
    }
    return {
      integration: def.label,
      env: envStatus,
      config: configStatus,
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

async function runIntegrationsSetup(cwd: string): Promise<void> {
  const { scope: existingScope } = loadIntegrationsStore(cwd);
  const { scope } = await inquirer.prompt([{
    type: 'list',
    name: 'scope',
    message: 'Where should integration settings be saved?',
    choices: [
      { name: 'Global (~/.stateset/integrations.json)', value: 'global' },
      { name: 'Project (.stateset/integrations.json)', value: 'local' },
    ],
    default: existingScope ?? 'global',
  }]);

  const { store } = loadIntegrationsStoreForScope(cwd, scope as IntegrationStoreScope);
  const definitions = listIntegrations();
  const defaults = definitions
    .filter((def) => store.integrations[def.id]?.enabled)
    .map((def) => def.id);

  const { selected } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'selected',
    message: 'Select integrations to configure',
    pageSize: Math.min(12, definitions.length),
    choices: definitions.map((def) => ({
      name: `${def.label} — ${def.description}`,
      value: def.id,
      checked: defaults.includes(def.id),
    })),
  }]);

  const selectedIds = (selected as IntegrationId[]) ?? [];
  const selectedSet = new Set(selectedIds);

  const disableCandidates = definitions
    .filter((def) => store.integrations[def.id] && !selectedSet.has(def.id))
    .map((def) => def.id);
  let disableOthers = false;
  if (disableCandidates.length > 0) {
    const response = await inquirer.prompt([{
      type: 'confirm',
      name: 'disable',
      message: 'Disable integrations that were not selected?',
      default: true,
    }]);
    disableOthers = Boolean(response.disable);
  }

  for (const def of definitions) {
    const existing = store.integrations[def.id]?.config ?? {};
    if (!selectedSet.has(def.id)) {
      if (disableOthers && store.integrations[def.id]) {
        store.integrations[def.id] = {
          ...store.integrations[def.id],
          enabled: false,
          updatedAt: new Date().toISOString(),
        };
      }
      continue;
    }

    const nextConfig: Record<string, string> = { ...existing };
    for (const field of def.fields) {
      const existingValue = existing[field.key];
      const defaultValue = existingValue || field.defaultValue || '';
      const isSecret = Boolean(field.secret);
      const envHint = field.envVars[0] ? ` (${field.envVars[0]})` : '';
      const promptLabel = `${def.label}: ${field.label}${envHint}`;
      const prompt = {
        type: isSecret ? 'password' : 'input',
        name: field.key,
        message: existingValue && isSecret
          ? `${promptLabel} (leave blank to keep existing)`
          : promptLabel,
        default: isSecret ? undefined : defaultValue,
        mask: isSecret ? '*' : undefined,
        validate: (value: string) => {
          const trimmed = String(value ?? '').trim();
          if (trimmed) return true;
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
      } else if (!raw && field.defaultValue && !nextConfig[field.key]) {
        nextConfig[field.key] = field.defaultValue;
      }
    }

    store.integrations[def.id] = {
      enabled: true,
      config: nextConfig,
      updatedAt: new Date().toISOString(),
    };
  }

  const filePath = saveIntegrationsStore(cwd, scope as IntegrationStoreScope, store);
  console.log(formatSuccess(`Saved integrations to ${filePath}`));
  const enabled = definitions
    .filter((def) => store.integrations[def.id]?.enabled)
    .map((def) => def.label);
  console.log(chalk.gray(`  Enabled: ${enabled.length ? enabled.join(', ') : 'none'}`));
  console.log(chalk.gray('  Environment variables always override stored settings.'));
}

type SessionMeta = {
  tags?: string[];
  archived?: boolean;
};

type SessionSummary = {
  id: string;
  dir: string;
  updatedAtMs: number;
  messageCount: number;
  tags: string[];
  archived: boolean;
};

type SessionExportEntry = StoredMessage & { ts?: string };
type PromptHistoryEntry = {
  ts: string;
  template: string;
  variables: Record<string, string>;
};
type ToolAuditEntry = {
  ts: string;
  type: 'tool_call' | 'tool_result';
  session: string;
  name: string;
  args?: Record<string, unknown>;
  decision?: string;
  reason?: string;
  durationMs?: number;
  isError?: boolean;
  resultLength?: number;
  resultExcerpt?: string;
};
type PermissionDecision = 'allow' | 'deny';
type PermissionStore = {
  toolHooks: Record<string, PermissionDecision>;
};

function readSessionMeta(sessionDir: string): SessionMeta {
  const metaPath = path.join(sessionDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return {};
  try {
    const content = fs.readFileSync(metaPath, 'utf-8');
    const parsed = JSON.parse(content) as SessionMeta;
    return parsed || {};
  } catch {
    return {};
  }
}

function writeSessionMeta(sessionDir: string, meta: SessionMeta): void {
  const metaPath = path.join(sessionDir, 'meta.json');
  ensureDirExists(metaPath);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
}

function listSessionSummaries(options?: { includeArchived?: boolean }): SessionSummary[] {
  const sessionsDir = getSessionsDir();
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const sessions: SessionSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const dir = path.join(sessionsDir, id);
    const contextPath = path.join(dir, 'context.jsonl');
    const meta = readSessionMeta(dir);
    const archived = Boolean(meta.archived);
    if (!options?.includeArchived && archived) continue;

    let updatedAtMs = 0;
    try {
      updatedAtMs = fs.statSync(contextPath).mtimeMs;
    } catch {
      try {
        updatedAtMs = fs.statSync(dir).mtimeMs;
      } catch {
        updatedAtMs = 0;
      }
    }

    let messageCount = 0;
    try {
      const content = fs.readFileSync(contextPath, 'utf-8');
      messageCount = content.split(/\n/).filter(Boolean).length;
    } catch {
      messageCount = 0;
    }

    sessions.push({
      id,
      dir,
      updatedAtMs,
      messageCount,
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      archived,
    });
  }

  return sessions.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'unknown';
  return new Date(ms).toLocaleString();
}

function normalizeTag(tag: string): string | null {
  const cleaned = tag.trim().toLowerCase();
  return cleaned ? cleaned : null;
}

function readSessionEntries(sessionId: string): SessionExportEntry[] {
  const sanitized = sanitizeSessionId(sessionId);
  const contextPath = path.join(getSessionsDir(), sanitized, 'context.jsonl');
  if (!fs.existsSync(contextPath)) return [];
  const content = fs.readFileSync(contextPath, 'utf-8');
  const lines = content.split(/\n/).filter(Boolean);
  const entries: SessionExportEntry[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as SessionExportEntry;
      if (!parsed || (parsed.role !== 'user' && parsed.role !== 'assistant')) continue;
      entries.push(parsed);
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

function formatContentForExport(content: StoredMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');

  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') {
      parts.push(String(part));
      continue;
    }

    if ('type' in part && part.type === 'text') {
      parts.push(String((part as any).text ?? ''));
      continue;
    }

    if ('type' in part && part.type === 'tool_use') {
      const name = (part as any).name ? String((part as any).name) : 'unknown';
      const input = (part as any).input ? JSON.stringify((part as any).input, null, 2) : '';
      parts.push(`[tool_use] ${name}${input ? `\n${input}` : ''}`);
      continue;
    }

    if ('type' in part && part.type === 'tool_result') {
      const toolContent = (part as any).content;
      if (Array.isArray(toolContent)) {
        const rendered = toolContent.map((c: any) => {
          if (c?.type === 'text') return c.text ?? '';
          return JSON.stringify(c);
        }).join('\n');
        parts.push(`[tool_result]\n${rendered}`);
      } else {
        parts.push(`[tool_result] ${typeof toolContent === 'string' ? toolContent : JSON.stringify(toolContent)}`);
      }
      continue;
    }

    if ('type' in part) {
      parts.push(`[${(part as any).type}]`);
      continue;
    }

    parts.push(JSON.stringify(part));
  }

  return parts.join('\n\n').trim();
}

function exportSessionToMarkdown(sessionId: string, entries: SessionExportEntry[]): string {
  const lines: string[] = [];
  const now = new Date().toISOString();
  lines.push(`# Session Export: ${sessionId}`);
  lines.push('');
  lines.push(`Generated: ${now}`);
  lines.push(`Messages: ${entries.length}`);
  lines.push('');

  for (const entry of entries) {
    const role = entry.role === 'assistant' ? 'Assistant' : 'User';
    const ts = entry.ts ? ` (${entry.ts})` : '';
    lines.push(`## ${role}${ts}`);
    lines.push('');
    const body = formatContentForExport(entry.content);
    lines.push(body || '(empty)');
    lines.push('');
  }

  return lines.join('\n');
}

function ensureDirExists(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function listExportFiles(sessionId: string): Array<{ name: string; path: string; updatedAtMs: number; size: number }> {
  const dir = getSessionExportPath(sessionId);
  if (!fs.existsSync(dir)) return [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filePath = path.join(dir, entry.name);
      try {
        const stat = fs.statSync(filePath);
        return { name: entry.name, path: filePath, updatedAtMs: stat.mtimeMs, size: stat.size };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { name: string; path: string; updatedAtMs: number; size: number } => Boolean(entry));
  return files.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

function deleteExportFile(sessionId: string, filename: string): boolean {
  const filePath = resolveExportFilePath(sessionId, filename);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

function getSessionMetaSummary(sessionId: string): {
  id: string;
  dir: string;
  updatedAtMs: number;
  messages: number;
  tags: string[];
  archived: boolean;
  memory: { global: boolean; session: boolean };
  exports: number;
  auditEntries: number;
} {
  const sanitized = sanitizeSessionId(sessionId);
  const dir = getSessionDir(sanitized);
  const contextPath = path.join(dir, 'context.jsonl');
  let updatedAtMs = 0;
  try {
    updatedAtMs = fs.statSync(contextPath).mtimeMs;
  } catch {
    try {
      updatedAtMs = fs.statSync(dir).mtimeMs;
    } catch {
      updatedAtMs = 0;
    }
  }

  const meta = readSessionMeta(dir);
  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  const archived = Boolean(meta.archived);

  const messages = readSessionEntries(sanitized).length;
  const memoryGlobal = fs.existsSync(path.join(getStateSetDir(), 'MEMORY.md'));
  const memorySession = fs.existsSync(path.join(dir, 'MEMORY.md'));
  const exportsCount = listExportFiles(sanitized).length;
  const auditEntries = readToolAudit(sanitized).length;

  return {
    id: sanitized,
    dir,
    updatedAtMs,
    messages,
    tags,
    archived,
    memory: { global: memoryGlobal, session: memorySession },
    exports: exportsCount,
    auditEntries,
  };
}

function getPromptHistoryPath(): string {
  return path.join(getStateSetDir(), 'prompt-history.jsonl');
}

function appendPromptHistory(entry: PromptHistoryEntry): void {
  const filePath = getPromptHistoryPath();
  ensureDirExists(filePath);
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
}

function readPromptHistory(limit = 20): PromptHistoryEntry[] {
  const filePath = getPromptHistoryPath();
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\n/).filter(Boolean);
  const entries: PromptHistoryEntry[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as PromptHistoryEntry;
      if (!parsed?.ts || !parsed?.template) continue;
      entries.push(parsed);
    } catch {
      // skip malformed lines
    }
  }
  return entries.slice(-limit).reverse();
}

function getToolAuditPath(sessionId: string): string {
  return path.join(getSessionsDir(), sanitizeSessionId(sessionId), 'tool-audit.jsonl');
}

function appendToolAudit(sessionId: string, entry: ToolAuditEntry): void {
  const filePath = getToolAuditPath(sessionId);
  ensureDirExists(filePath);
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
}

function readToolAudit(sessionId: string): ToolAuditEntry[] {
  const filePath = getToolAuditPath(sessionId);
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\n/).filter(Boolean);
  const entries: ToolAuditEntry[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as ToolAuditEntry;
      if (!parsed?.type || !parsed?.name) continue;
      entries.push(parsed);
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

function getPermissionStorePath(): string {
  return path.join(getStateSetDir(), 'permissions.json');
}

function readPermissionStore(): PermissionStore {
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

function writePermissionStore(store: PermissionStore): void {
  const filePath = getPermissionStorePath();
  ensureDirExists(filePath);
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

function getPolicyOverridesPath(cwd: string): string {
  return path.join(cwd, '.stateset', 'policies.json');
}

function parsePolicyFile(filePath: string): { toolHooks: Record<string, string> } {
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

function readPolicyOverridesDetailed(cwd: string): {
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

function writePolicyOverrides(cwd: string, data: { toolHooks: Record<string, string> }): void {
  const pathToWrite = getPolicyOverridesPath(cwd);
  ensureDirExists(pathToWrite);
  fs.writeFileSync(pathToWrite, JSON.stringify(data, null, 2), 'utf-8');
}

function readPolicyFile(pathInput: string): { toolHooks: Record<string, string> } {
  const resolved = path.resolve(pathInput);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Policy file not found: ${resolved}`);
  }
  return parsePolicyFile(resolved);
}

function makeHookPermissionKey(hookName: string, toolName: string): string {
  return `${hookName}::${toolName}`;
}

const REDACT_KEY_RE = /(secret|token|authorization|api[-_]?key|password|admin|email|phone|address|customer_email|customer_phone|customer_name|first_name|last_name)/i;

function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[truncated]';
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeAuditValue(v, depth + 1));
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (REDACT_KEY_RE.test(key)) {
        out[key] = '[redacted]';
      } else {
        out[key] = sanitizeAuditValue(val, depth + 1);
      }
    }
    return out;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 200) {
      return trimmed.slice(0, 197) + '...';
    }
    return trimmed;
  }
  return value;
}

function sanitizeToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  return sanitizeAuditValue(args) as Record<string, unknown>;
}

async function postJson<T = Record<string, unknown>>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as { error?: string; message?: string }).error || (data as { message?: string }).message;
    throw new Error(message || `Request failed: ${response.status}`);
  }
  return data as T;
}

async function startDeviceFlow(instanceUrl: string) {
  return await postJson<{
    device_code: string;
    user_code: string;
    verification_url: string;
    expires_in: number;
    interval: number;
  }>(`${instanceUrl}/api/cli/device/start`, {});
}

async function pollDeviceFlow(instanceUrl: string, deviceCode: string, interval: number, expiresIn: number) {
  const expiresAt = Date.now() + expiresIn * 1000;
  while (Date.now() < expiresAt) {
    let data: {
      status?: string;
      error?: string;
      token?: string;
      org?: { id: string; name: string };
      graphqlEndpoint?: string;
    };

    try {
      const response = await fetch(`${instanceUrl}/api/cli/device/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_code: deviceCode }),
      });
      data = await response.json().catch(() => ({}));
    } catch {
      // Network error – wait and retry
      await sleep(interval * 1000);
      continue;
    }

    if (data.status === 'authorized') {
      return data;
    }

    const error = data.error;
    if (error && error !== 'authorization_pending' && error !== 'server_error' && error !== 'slow_down') {
      throw new Error(error);
    }

    await sleep(interval * 1000);
  }
  throw new Error('Device code expired. Please try again.');
}

program
  .name('response')
  .description('AI-powered CLI for managing the StateSet Response platform')
  .version(pkg.version || '0.0.0');

// Auth commands
const auth = program.command('auth').description('Manage authentication and organizations');

auth
  .command('login')
  .description('Configure credentials for an organization')
  .action(async () => {
    ensureConfigDir();

    const { loginMethod } = await inquirer.prompt([
      {
        type: 'list',
        name: 'loginMethod',
        message: 'Choose an authentication method:',
        choices: [
          { name: 'Browser/device code (recommended)', value: 'device' },
        ],
      },
    ]);

    const { anthropicApiKey } = await inquirer.prompt([
      {
        type: 'password',
        name: 'anthropicApiKey',
        message: 'Anthropic API key (or set ANTHROPIC_API_KEY env var):',
      },
    ]);

    const existing: StateSetConfig = configExists()
      ? loadConfig()
      : { currentOrg: '', organizations: {} };

    if (loginMethod === 'device') {
      const { instanceUrl } = await inquirer.prompt([
        {
          type: 'input',
          name: 'instanceUrl',
          message: 'StateSet ResponseCX instance URL:',
          default: process.env.STATESET_INSTANCE_URL || '',
          validate: (v: string) => v.trim().length >= 1 || 'Instance URL is required',
        },
      ]);

      const normalizedInstance = normalizeInstanceUrl(instanceUrl);
      const { device_code, user_code, verification_url, expires_in, interval } =
        await startDeviceFlow(normalizedInstance);

      console.log('');
      console.log(chalk.bold('  Authorize the CLI'));
      console.log(chalk.gray(`  Visit: ${verification_url}`));
      console.log(chalk.gray(`  Code:  ${user_code}`));
      console.log('');

      const spinner = ora('Waiting for authorization...').start();
      const result = await pollDeviceFlow(normalizedInstance, device_code, interval, expires_in);
      spinner.succeed('Authorized');

      if (!result.token || !result.org?.id || !result.graphqlEndpoint) {
        throw new Error('Authorization response missing required data.');
      }

      existing.currentOrg = result.org.id;
      existing.organizations[result.org.id] = {
        name: result.org.name || result.org.id,
        graphqlEndpoint: result.graphqlEndpoint,
        cliToken: result.token,
      };
    } else {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'orgId',
          message: 'Organization ID:',
          validate: (v: string) => v.length >= 1 || 'Organization ID is required',
        },
        {
          type: 'input',
          name: 'orgName',
          message: 'Organization name:',
          validate: (v: string) => v.length >= 1 || 'Name is required',
        },
        {
          type: 'input',
          name: 'graphqlEndpoint',
          message: 'GraphQL endpoint:',
          default: process.env.STATESET_GRAPHQL_ENDPOINT || '',
        },
        {
          type: 'password',
          name: 'adminSecret',
          message: 'Hasura admin secret:',
          validate: (v: string) => v.length >= 1 || 'Admin secret is required',
        },
      ]);

      existing.currentOrg = answers.orgId;
      existing.organizations[answers.orgId] = {
        name: answers.orgName,
        graphqlEndpoint: answers.graphqlEndpoint,
        adminSecret: answers.adminSecret,
      };
    }

    if (anthropicApiKey) {
      existing.anthropicApiKey = anthropicApiKey;
    }

    saveConfig(existing);
    const { orgId, config: orgConfig } = getCurrentOrg();
    console.log(chalk.green(`\n  Logged in to "${orgConfig.name}" (${orgId})\n`));
  });

auth
  .command('switch <org-id>')
  .description('Switch to a different organization')
  .action((orgId: string) => {
    const config = loadConfig();
    if (!config.organizations[orgId]) {
      console.error(formatError(`Organization "${orgId}" not found. Run "response auth login" first.`));
      process.exit(1);
    }
    config.currentOrg = orgId;
    saveConfig(config);
    console.log(chalk.green(`\n  Switched to "${config.organizations[orgId].name}" (${orgId})\n`));
  });

auth
  .command('status')
  .description('Show current authentication status')
  .action(() => {
    if (!configExists()) {
      printAuthHelp();
      return;
    }
    try {
      const { orgId, config: orgConfig } = getCurrentOrg();
      const cfg = loadConfig();
      console.log('');
      console.log(chalk.bold('  Current Organization'));
      console.log(chalk.gray(`  ID:       ${orgId}`));
      console.log(chalk.gray(`  Name:     ${orgConfig.name}`));
      console.log(chalk.gray(`  Endpoint: ${orgConfig.graphqlEndpoint}`));
      console.log(
        chalk.gray(`  Auth:     ${orgConfig.cliToken ? 'CLI token' : 'Admin secret'}`)
      );
      console.log('');
      const orgCount = Object.keys(cfg.organizations).length;
      if (orgCount > 1) {
        console.log(chalk.gray(`  ${orgCount} organizations configured. Use "response auth switch <org-id>" to change.`));
        for (const [id, org] of Object.entries(cfg.organizations)) {
          const marker = id === orgId ? chalk.green(' *') : '  ';
          console.log(chalk.gray(`  ${marker} ${id} (${org.name})`));
        }
        console.log('');
      }
    } catch (e: unknown) {
      console.error(formatError(e instanceof Error ? e.message : String(e)));
    }
  });

// Integrations
const integrations = program.command('integrations').description('Configure and inspect integrations');

integrations
  .command('status')
  .description('Show integration configuration status')
  .action(() => {
    printIntegrationStatus(process.cwd());
  });

integrations
  .command('setup')
  .description('Interactive integration configuration wizard')
  .action(async () => {
    await runIntegrationsSetup(process.cwd());
  });

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

// Export command
program
  .command('export')
  .description('Export entire org configuration to a JSON file')
  .argument('[file]', 'Output file path', 'stateset-export.json')
  .action(async (file: string) => {
    if (!configExists()) {
      printAuthHelp();
      process.exit(1);
    }
    const { orgId } = getCurrentOrg();
    const spinner = ora(`Exporting organization ${orgId}...`).start();
    try {
      const data = await exportOrg(file);
      const counts = [
        `${data.agents.length} agents`,
        `${data.rules.length} rules`,
        `${data.skills.length} skills`,
        `${data.attributes.length} attributes`,
        `${data.functions.length} functions`,
        `${data.examples.length} examples`,
        `${data.evals.length} evals`,
        `${data.datasets.length} datasets`,
        `${data.agentSettings.length} agent settings`,
      ];
      spinner.succeed(`Exported to ${file}`);
      console.log(chalk.gray(`  ${counts.join(', ')}`));
    } catch (e: unknown) {
      spinner.fail('Export failed');
      console.error(formatError(e instanceof Error ? e.message : String(e)));
      process.exit(1);
    }
  });

// Import command
program
  .command('import')
  .description('Import org configuration from a JSON export file')
  .argument('<file>', 'Input file path')
  .action(async (file: string) => {
    if (!configExists()) {
      printAuthHelp();
      process.exit(1);
    }
    if (!fs.existsSync(file)) {
      console.error(formatError(`File not found: ${file}`));
      process.exit(1);
    }
    const { orgId } = getCurrentOrg();
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: `Import into organization "${orgId}"? This will create new resources.`,
      default: false,
    }]);
    if (!confirm) {
      console.log(chalk.gray('  Import cancelled.'));
      process.exit(0);
    }
    const spinner = ora('Importing...').start();
    try {
      const result = await importOrg(file);
      spinner.succeed('Import complete');
      const counts = Object.entries(result)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');
      console.log(chalk.gray(`  Imported: ${counts || 'nothing (all resources may already exist)'}`));
    } catch (e: unknown) {
      spinner.fail('Import failed');
      console.error(formatError(e instanceof Error ? e.message : String(e)));
      process.exit(1);
    }
  });

// Events watcher
program
  .command('events')
  .description('Run the event watcher for scheduled agent runs')
  .option('--model <model>', 'Model to use (sonnet, haiku, opus)')
  .option('--session <name>', 'Default session name', 'default')
  .option('--apply', 'Allow write operations for integration tools')
  .option('--redact', 'Redact customer emails in integration outputs')
  .option('--usage', 'Show token usage summaries')
  .option('--stdout', 'Print event responses to stdout')
  .action(async (options: { model?: string; session?: string; apply?: boolean; redact?: boolean; usage?: boolean; stdout?: boolean }) => {
    if (!configExists()) {
      printAuthHelp();
      process.exit(1);
    }

    try {
      validateEventsPrereqs();
    } catch (e: unknown) {
      console.error(formatError(e instanceof Error ? e.message : String(e)));
      process.exit(1);
    }

    if (options.apply) {
      process.env.STATESET_ALLOW_APPLY = 'true';
    }
    if (options.redact) {
      process.env.STATESET_REDACT = 'true';
    }

    let model: ModelId = getConfiguredModel();
    if (options.model) {
      const resolved = resolveModel(options.model);
      if (!resolved) {
        console.error(formatError(`Unknown model "${options.model}". Use sonnet, haiku, or opus.`));
        process.exit(1);
      }
      model = resolved;
    }

    const sessionId = sanitizeSessionId(options.session || 'default');
    const runner = new EventsRunner({
      model,
      defaultSession: sessionId,
      showUsage: Boolean(options.usage),
      stdout: Boolean(options.stdout),
    });

    runner.start();

    const shutdown = async () => {
      console.log('\nStopping events watcher...');
      await runner.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

// Default command: interactive agent session
program
  .command('chat', { isDefault: true })
  .description('Start an interactive AI agent session')
  .option('--model <model>', 'Model to use (sonnet, haiku, opus)')
  .option('--session <name>', 'Session name (default: "default")')
  .option('--file <path>', 'Attach a file (repeatable)', (value: string, previous: string[]) => {
    previous.push(value);
    return previous;
  }, [])
  .option('--apply', 'Allow write operations for integration tools')
  .option('--redact', 'Redact customer emails in integration outputs')
  .option('--usage', 'Show token usage summaries')
  .action(async (options: { model?: string; session?: string; file?: string[]; apply?: boolean; redact?: boolean; usage?: boolean }) => {
    // Check config
    if (!configExists()) {
      printAuthHelp();
      process.exit(1);
    }

    let orgId: string;
    try {
      const org = getCurrentOrg();
      orgId = org.orgId;
    } catch (e: unknown) {
      console.error(formatError(e instanceof Error ? e.message : String(e)));
      process.exit(1);
    }

    let apiKey: string;
    try {
      apiKey = getAnthropicApiKey();
    } catch (e: unknown) {
      console.error(formatError(e instanceof Error ? e.message : String(e)));
      process.exit(1);
    }

    // Integration flags (propagate to MCP server via env)
    if (options.apply) {
      process.env.STATESET_ALLOW_APPLY = 'true';
    }
    if (options.redact) {
      process.env.STATESET_REDACT = 'true';
    }

    // Resolve model
    let model: ModelId = getConfiguredModel();
    if (options.model) {
      const resolved = resolveModel(options.model);
      if (!resolved) {
        console.error(formatError(`Unknown model "${options.model}". Use sonnet, haiku, or opus.`));
        process.exit(1);
      }
      model = resolved;
    }

    let sessionId = sanitizeSessionId(options.session || 'default');
    let sessionStore = new SessionStore(sessionId);
    const agent = new StateSetAgent(apiKey, model);
    const cwd = process.cwd();
    const activeSkills: string[] = [];
    const extensions = new ExtensionManager();
    agent.useSessionStore(sessionStore);
    agent.setSystemPrompt(buildSystemPrompt({ sessionId, memory: loadMemory(sessionId), cwd, activeSkills }));

    const spinner = ora('Connecting to StateSet Response...').start();
    try {
      await agent.connect();
      spinner.succeed('Connected');
    } catch (e: unknown) {
      spinner.fail('Failed to connect');
      console.error(formatError(e instanceof Error ? e.message : String(e)));
      process.exit(1);
    }

    try {
      await extensions.load(cwd);
    } catch (err) {
      console.error(formatError(err instanceof Error ? err.message : String(err)));
    }

    printWelcome(orgId, pkg.version, model);
    console.log(chalk.gray(`  Session: ${sessionId}`));
    console.log('');

    // Graceful shutdown
    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log('');
      const exitSpinner = ora('Disconnecting...').start();
      await agent.disconnect();
      exitSpinner.succeed('Disconnected');
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('response> '),
    });

    let processing = false;
    let multiLineBuffer = '';
    let pendingAttachments = Array.isArray(options.file) ? [...options.file] : [];
    let showUsage = Boolean(options.usage) || process.env.STATESET_SHOW_USAGE === 'true';
    let auditEnabled = process.env.STATESET_TOOL_AUDIT === 'true';
    let auditIncludeExcerpt = process.env.STATESET_TOOL_AUDIT_DETAIL === 'true';
    let permissionStore = readPermissionStore();
    const switchSession = (nextSessionId: string) => {
      sessionId = sanitizeSessionId(nextSessionId || 'default');
      sessionStore = new SessionStore(sessionId);
      agent.useSessionStore(sessionStore);
      pendingAttachments = [];
      const memory = loadMemory(sessionId);
      agent.setSystemPrompt(buildSystemPrompt({ sessionId, memory, cwd, activeSkills }));
      console.log(formatSuccess(`Switched to session: ${sessionId}`));
      console.log(chalk.gray(`  Path: ${sessionStore.getSessionDir()}`));
    };

    const buildExtensionContext = () => ({
      cwd,
      sessionId,
      setSession: switchSession,
      listSessions: () => listSessionSummaries({ includeArchived: true }),
      log: (message: string) => console.log(message),
      success: (message: string) => console.log(formatSuccess(message)),
      warn: (message: string) => console.log(formatWarning(message)),
      error: (message: string) => console.error(formatError(message)),
    });

    const buildToolHookContext = () => ({
      cwd,
      sessionId,
      sessionTags: Array.isArray(readSessionMeta(sessionStore.getSessionDir()).tags)
        ? (readSessionMeta(sessionStore.getSessionDir()).tags as string[])
        : [],
      allowApply: readBooleanEnv('STATESET_ALLOW_APPLY'),
      redact: readBooleanEnv('STATESET_REDACT'),
      policy: extensions.getPolicyOverrides ? extensions.getPolicyOverrides() : {},
      log: (message: string) => console.log(message),
      success: (message: string) => console.log(formatSuccess(message)),
      warn: (message: string) => console.log(formatWarning(message)),
      error: (message: string) => console.error(formatError(message)),
    });

    const reconnectAgent = async () => {
      const spinner = ora('Reconnecting to StateSet Response...').start();
      try {
        await agent.disconnect();
        await agent.connect();
        spinner.succeed('Reconnected');
      } catch (err) {
        spinner.fail('Reconnect failed');
        throw err;
      }
    };

    // Handle Ctrl+C: cancel current request or show prompt
    process.on('SIGINT', () => {
      if (processing) {
        agent.abort();
        processing = false;
        console.log(chalk.yellow('\n  Request cancelled.'));
        console.log('');
        rl.prompt();
      } else {
        // Double Ctrl+C to exit
        console.log(chalk.gray('\n  Press Ctrl+C again or type "exit" to quit.'));
        rl.prompt();
        // Set a one-time listener for a second SIGINT
        const onSecondSigint = () => {
          shutdown();
        };
        process.once('SIGINT', onSecondSigint);
        // Reset after 2 seconds
        setTimeout(() => {
          process.removeListener('SIGINT', onSecondSigint);
        }, 2000);
      }
    });

    rl.prompt();

    const handleLine = async (line: string) => {
      // Multi-line support: trailing backslash continues input
      if (line.endsWith('\\')) {
        multiLineBuffer += line.slice(0, -1) + '\n';
        process.stdout.write(chalk.gray('... '));
        return;
      }

      const input = (multiLineBuffer + line).trim();
      multiLineBuffer = '';

      if (!input) {
        rl.prompt();
        return;
      }

      let finalInput = input;

      if (!input.startsWith('/')) {
        const inline = extractInlineFlags(input);
        finalInput = inline.text;

        const currentApply = process.env.STATESET_ALLOW_APPLY === 'true';
        const currentRedact = process.env.STATESET_REDACT === 'true';
        const nextApply = inline.flags.apply ? true : currentApply;
        const nextRedact = inline.flags.redact ? true : currentRedact;

        if (nextApply !== currentApply || nextRedact !== currentRedact) {
          process.env.STATESET_ALLOW_APPLY = nextApply ? 'true' : 'false';
          process.env.STATESET_REDACT = nextRedact ? 'true' : 'false';
          try {
            await reconnectAgent();
          } catch (err) {
            process.env.STATESET_ALLOW_APPLY = currentApply ? 'true' : 'false';
            process.env.STATESET_REDACT = currentRedact ? 'true' : 'false';
            console.error(formatError(err instanceof Error ? err.message : String(err)));
            console.log('');
            rl.prompt();
            return;
          }
          const memory = loadMemory(sessionId);
          agent.setSystemPrompt(buildSystemPrompt({ sessionId, memory, cwd, activeSkills }));
          if (nextApply !== currentApply) {
            console.log(formatSuccess(`Writes ${nextApply ? 'enabled' : 'disabled'} (inline --apply).`));
          }
          if (nextRedact !== currentRedact) {
            console.log(formatSuccess(`Redaction ${nextRedact ? 'enabled' : 'disabled'} (inline --redact).`));
          }
          console.log('');
        }

        if (!finalInput) {
          rl.prompt();
          return;
        }

        if (finalInput === 'exit' || finalInput === 'quit') {
          await shutdown();
          return;
        }
      }

      // Slash commands
      if (input === '/help') {
        printHelp();
        rl.prompt();
        return;
      }

      if (input === '/clear') {
        agent.clearHistory();
        sessionStore.clear();
        console.log(formatSuccess('Conversation history cleared.'));
        console.log('');
        rl.prompt();
        return;
      }

      if (input === '/history') {
        const count = agent.getHistoryLength();
        console.log(formatSuccess(`Conversation history: ${count} messages.`));
        console.log('');
        rl.prompt();
        return;
      }

      if (input === '/extensions') {
        const loaded = extensions.listExtensions();
        const diagnostics = extensions.listDiagnostics();
        if (loaded.length === 0) {
          console.log(formatSuccess('No extensions loaded.'));
        } else {
          console.log(formatSuccess('Loaded extensions:'));
          const rows = loaded.map(ext => ({
            name: ext.name,
            commands: ext.commands.map(cmd => cmd.name).join(', ') || '-',
            hooks: ext.toolHooks.length > 0 || ext.toolResultHooks.length > 0
              ? `pre:${ext.toolHooks.length} post:${ext.toolResultHooks.length}`
              : '-',
            path: ext.path,
          }));
          console.log(formatTable(rows, ['name', 'commands', 'hooks', 'path']));
        }

        if (diagnostics.length > 0) {
          console.log(formatWarning('Extension diagnostics:'));
          for (const diag of diagnostics) {
            console.log(chalk.gray(`  - ${diag.source}: ${diag.message}`));
          }
        }

        console.log('');
        rl.prompt();
        return;
      }

      if (input === '/reload') {
        try {
          await extensions.load(cwd);
          console.log(formatSuccess('Extensions reloaded.'));
        } catch (err) {
          console.error(formatError(err instanceof Error ? err.message : String(err)));
        }
        console.log('');
        rl.prompt();
        return;
      }

      if (input === '/session') {
        const memory = loadMemory(sessionId);
        const meta = readSessionMeta(sessionStore.getSessionDir());
        const tags = Array.isArray(meta.tags) ? meta.tags : [];
        console.log(formatSuccess(`Session: ${sessionId}`));
        console.log(chalk.gray(`  Path: ${sessionStore.getSessionDir()}`));
        console.log(chalk.gray(`  Messages: ${agent.getHistoryLength()}`));
        console.log(chalk.gray(`  Tags: ${tags.length ? tags.join(', ') : '-'}`));
        console.log(chalk.gray(`  Archived: ${meta.archived ? 'yes' : 'no'}`));
        console.log(chalk.gray(`  Memory: ${memory ? 'loaded' : 'none'}`));
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/apply')) {
        const arg = input.slice('/apply'.length).trim();
        const parsed = parseToggleValue(arg);
        const current = process.env.STATESET_ALLOW_APPLY === 'true';
        if (!arg) {
          console.log(formatSuccess(`Writes enabled: ${current ? 'yes' : 'no'}`));
          console.log(chalk.gray('  Usage: /apply on|off'));
          console.log('');
          rl.prompt();
          return;
        }
        if (parsed === undefined) {
          console.log(formatWarning('Usage: /apply on|off'));
          console.log('');
          rl.prompt();
          return;
        }
        if (parsed === current) {
          console.log(formatSuccess(`Writes already ${current ? 'enabled' : 'disabled'}.`));
          console.log('');
          rl.prompt();
          return;
        }

        process.env.STATESET_ALLOW_APPLY = parsed ? 'true' : 'false';
        try {
          await reconnectAgent();
        } catch (err) {
          process.env.STATESET_ALLOW_APPLY = current ? 'true' : 'false';
          console.error(formatError(err instanceof Error ? err.message : String(err)));
        }
        const memory = loadMemory(sessionId);
        agent.setSystemPrompt(buildSystemPrompt({ sessionId, memory, cwd, activeSkills }));
        console.log(formatSuccess(`Writes ${parsed ? 'enabled' : 'disabled'}.`));
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/redact')) {
        const arg = input.slice('/redact'.length).trim();
        const parsed = parseToggleValue(arg);
        const current = process.env.STATESET_REDACT === 'true';
        if (!arg) {
          console.log(formatSuccess(`Redaction: ${current ? 'enabled' : 'disabled'}`));
          console.log(chalk.gray('  Usage: /redact on|off'));
          console.log('');
          rl.prompt();
          return;
        }
        if (parsed === undefined) {
          console.log(formatWarning('Usage: /redact on|off'));
          console.log('');
          rl.prompt();
          return;
        }
        if (parsed === current) {
          console.log(formatSuccess(`Redaction already ${current ? 'enabled' : 'disabled'}.`));
          console.log('');
          rl.prompt();
          return;
        }

        process.env.STATESET_REDACT = parsed ? 'true' : 'false';
        try {
          await reconnectAgent();
        } catch (err) {
          process.env.STATESET_REDACT = current ? 'true' : 'false';
          console.error(formatError(err instanceof Error ? err.message : String(err)));
        }
        const memory = loadMemory(sessionId);
        agent.setSystemPrompt(buildSystemPrompt({ sessionId, memory, cwd, activeSkills }));
        console.log(formatSuccess(`Redaction ${parsed ? 'enabled' : 'disabled'}.`));
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/usage')) {
        const arg = input.slice('/usage'.length).trim();
        const parsed = parseToggleValue(arg);
        if (!arg) {
          console.log(formatSuccess(`Usage summaries: ${showUsage ? 'enabled' : 'disabled'}`));
          console.log(chalk.gray('  Usage: /usage on|off'));
          console.log('');
          rl.prompt();
          return;
        }
        if (parsed === undefined) {
          console.log(formatWarning('Usage: /usage on|off'));
          console.log('');
          rl.prompt();
          return;
        }
        showUsage = parsed;
        process.env.STATESET_SHOW_USAGE = parsed ? 'true' : 'false';
        console.log(formatSuccess(`Usage summaries ${parsed ? 'enabled' : 'disabled'}.`));
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/audit')) {
        const args = input.split(/\s+/).slice(1);
        const mode = args[0];
        if (!mode) {
          console.log(formatSuccess(`Tool audit: ${auditEnabled ? 'enabled' : 'disabled'}`));
          console.log(chalk.gray(`  Path: ${getToolAuditPath(sessionId)}`));
          console.log(chalk.gray(`  Excerpts: ${auditIncludeExcerpt ? 'enabled' : 'disabled'}`));
          console.log(chalk.gray('  Usage: /audit on|off [detail]'));
          console.log('');
          rl.prompt();
          return;
        }

        const toggle = parseToggleValue(mode);
        if (toggle === undefined) {
          console.log(formatWarning('Usage: /audit on|off [detail]'));
          console.log('');
          rl.prompt();
          return;
        }

        auditEnabled = toggle;
        process.env.STATESET_TOOL_AUDIT = toggle ? 'true' : 'false';
        if (args[1]) {
          const detailToggle = parseToggleValue(args[1]);
          if (detailToggle !== undefined) {
            auditIncludeExcerpt = detailToggle;
            process.env.STATESET_TOOL_AUDIT_DETAIL = detailToggle ? 'true' : 'false';
          }
        }
        console.log(formatSuccess(`Tool audit ${auditEnabled ? 'enabled' : 'disabled'}.`));
        console.log(chalk.gray(`  Excerpts: ${auditIncludeExcerpt ? 'enabled' : 'disabled'}`));
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/audit-show')) {
        const tokens = input.split(/\s+/).slice(1);
        let targetSession = sessionId;
        let toolFilter: string | null = null;
        let errorsOnly = false;
        let limit = 20;

        for (const token of tokens) {
          if (!token) continue;
          if (token === 'errors' || token === 'error') {
            errorsOnly = true;
            continue;
          }
          if (token.startsWith('tool=')) {
            toolFilter = token.slice('tool='.length).trim() || null;
            continue;
          }
          if (token.startsWith('limit=')) {
            const val = Number(token.slice('limit='.length));
            if (Number.isFinite(val) && val > 0) {
              limit = Math.min(100, Math.floor(val));
            }
            continue;
          }
          if (!token.includes('=')) {
            targetSession = sanitizeSessionId(token);
          }
        }

        const entries = readToolAudit(targetSession);
        if (entries.length === 0) {
          console.log(formatSuccess('No audit entries found.'));
          console.log('');
          rl.prompt();
          return;
        }

        let filtered = entries;
        if (toolFilter) {
          const lower = toolFilter.toLowerCase();
          filtered = filtered.filter((entry) => entry.name.toLowerCase().includes(lower));
        }
        if (errorsOnly) {
          filtered = filtered.filter((entry) => entry.isError);
        }

        const display = filtered.slice(-limit).reverse();
        if (display.length === 0) {
          console.log(formatSuccess('No matching audit entries.'));
          console.log('');
          rl.prompt();
          return;
        }

        console.log(formatSuccess(`Audit entries (${display.length}) for "${targetSession}":`));
        const rows = display.map(entry => ({
          time: entry.ts ? new Date(entry.ts).toLocaleString() : '',
          type: entry.type,
          tool: entry.name,
          status: entry.isError ? 'error' : 'ok',
          duration: entry.durationMs ? `${entry.durationMs}ms` : '',
        }));
        console.log(formatTable(rows, ['time', 'type', 'tool', 'status', 'duration']));
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/audit-clear')) {
        const target = sanitizeSessionId(input.slice('/audit-clear'.length).trim() || sessionId);
        const auditPath = getToolAuditPath(target);
        if (!fs.existsSync(auditPath)) {
          console.log(formatSuccess('No audit log found.'));
          console.log('');
          rl.prompt();
          return;
        }
        rl.pause();
        const { confirmClear } = await inquirer.prompt([
          { type: 'confirm', name: 'confirmClear', message: `Clear audit log for "${target}"?`, default: false },
        ]);
        rl.resume();
        if (!confirmClear) {
          console.log(formatWarning('Audit clear cancelled.'));
          console.log('');
          rl.prompt();
          return;
        }
        try {
          fs.writeFileSync(auditPath, '', 'utf-8');
          console.log(formatSuccess(`Cleared audit log for "${target}".`));
        } catch (err) {
          console.error(formatError(err instanceof Error ? err.message : String(err)));
        }
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/session-meta')) {
        const tokens = input.split(/\s+/).slice(1);
        let target = sessionId;
        let format: 'text' | 'json' | 'md' = 'text';
        let outPath: string | null = null;

        for (const token of tokens) {
          if (!token) continue;
          if (token === 'json') {
            format = 'json';
            continue;
          }
          if (token === 'md' || token === 'markdown') {
            format = 'md';
            continue;
          }
          if (token.startsWith('out=')) {
            outPath = token.slice('out='.length);
            continue;
          }
          if (!token.includes('=')) {
            target = sanitizeSessionId(token);
          }
        }

        if (!fs.existsSync(getSessionDir(target))) {
          console.log(formatWarning(`Session "${target}" not found.`));
          console.log('');
          rl.prompt();
          return;
        }

        const meta = getSessionMetaSummary(target);
        const payload = {
          id: meta.id,
          dir: meta.dir,
          updated: meta.updatedAtMs ? new Date(meta.updatedAtMs).toISOString() : null,
          messages: meta.messages,
          tags: meta.tags,
          archived: meta.archived,
          memory: meta.memory,
          exports: meta.exports,
          audit_entries: meta.auditEntries,
        };

        let outputText = '';
        if (format === 'json') {
          outputText = JSON.stringify(payload, null, 2);
        } else if (format === 'md') {
          const lines = [
            `# Session Meta: ${meta.id}`,
            '',
            `- Path: ${meta.dir}`,
            `- Updated: ${payload.updated || 'unknown'}`,
            `- Messages: ${meta.messages}`,
            `- Tags: ${meta.tags.length ? meta.tags.join(', ') : '-'}`,
            `- Archived: ${meta.archived ? 'yes' : 'no'}`,
            `- Memory (global): ${meta.memory.global ? 'yes' : 'no'}`,
            `- Memory (session): ${meta.memory.session ? 'yes' : 'no'}`,
            `- Exports: ${meta.exports}`,
            `- Audit entries: ${meta.auditEntries}`,
            '',
          ];
          outputText = lines.join('\n');
        } else {
          console.log(formatSuccess(`Session meta: ${meta.id}`));
          const rows = [
            { key: 'Path', value: meta.dir },
            { key: 'Updated', value: payload.updated || 'unknown' },
            { key: 'Messages', value: String(meta.messages) },
            { key: 'Tags', value: meta.tags.length ? meta.tags.join(', ') : '-' },
            { key: 'Archived', value: meta.archived ? 'yes' : 'no' },
            { key: 'Memory (global)', value: meta.memory.global ? 'yes' : 'no' },
            { key: 'Memory (session)', value: meta.memory.session ? 'yes' : 'no' },
            { key: 'Exports', value: String(meta.exports) },
            { key: 'Audit entries', value: String(meta.auditEntries) },
          ];
          console.log(formatTable(rows, ['key', 'value']));
          console.log('');
          rl.prompt();
          return;
        }

        if (outPath) {
          const resolved = path.resolve(outPath);
          try {
            ensureDirExists(resolved);
            fs.writeFileSync(resolved, outputText, 'utf-8');
            console.log(formatSuccess(`Session meta saved to ${resolved}`));
          } catch (err) {
            console.error(formatError(err instanceof Error ? err.message : String(err)));
          }
        } else {
          console.log(formatSuccess(`Session meta (${format}):`));
          console.log(chalk.gray(outputText));
        }

        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/permissions')) {
        const tokens = input.split(/\s+/).slice(1);
        const action = tokens[0];
        if (!action || action === 'list') {
          const entries = Object.entries(permissionStore.toolHooks || {});
          if (entries.length === 0) {
            console.log(formatSuccess('No stored permissions.'));
          } else {
            console.log(formatSuccess('Stored permissions:'));
            const rows = entries.map(([key, decision]) => {
              const [hook, tool] = key.split('::');
              return { hook: hook || key, tool: tool || '-', decision };
            });
            console.log(formatTable(rows, ['hook', 'tool', 'decision']));
          }
          console.log('');
          rl.prompt();
          return;
        }

        if (action === 'clear') {
          rl.pause();
          const { confirmClear } = await inquirer.prompt([
            { type: 'confirm', name: 'confirmClear', message: 'Clear all stored permissions?', default: false },
          ]);
          rl.resume();
          if (!confirmClear) {
            console.log(formatWarning('Permissions clear cancelled.'));
            console.log('');
            rl.prompt();
            return;
          }
          permissionStore = { toolHooks: {} };
          writePermissionStore(permissionStore);
          console.log(formatSuccess('Stored permissions cleared.'));
          console.log('');
          rl.prompt();
          return;
        }

        console.log(formatWarning('Usage: /permissions [list|clear]'));
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/integrations')) {
        const tokens = input.split(/\s+/).slice(1);
        const action = tokens[0];
        if (action === 'setup') {
          rl.pause();
          rl.removeListener('line', handleLine);
          try {
            await runIntegrationsSetup(cwd);
          } catch (err) {
            console.error(formatError(err instanceof Error ? err.message : String(err)));
          } finally {
            if (!rl.listeners('line').includes(handleLine)) {
              rl.on('line', handleLine);
            }
            rl.resume();
          }
          console.log('');
          rl.prompt();
          return;
        }

        printIntegrationStatus(cwd);
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/policy')) {
        const tokens = input.split(/\s+/).slice(1);
        const action = tokens[0];
        if (!action || action === 'list') {
          const mode = tokens.includes('local')
            ? 'local'
            : tokens.includes('global')
              ? 'global'
              : 'merged';
          const data = readPolicyOverridesDetailed(cwd);
          const view = mode === 'local' ? data.local : mode === 'global' ? data.global : data.merged;
          const entries = Object.entries(view.toolHooks || {});
          if (entries.length === 0) {
            console.log(formatSuccess('No policy overrides set.'));
          } else {
            console.log(formatSuccess(`Policy overrides (${mode}):`));
            const rows: Record<string, string>[] = entries.map(([hook, decision]) => {
              const source = data.local.toolHooks[hook] ? 'local' : 'global';
              return { hook, decision: String(decision), source };
            });
            console.log(formatTable(rows, mode === 'merged' ? ['hook', 'decision', 'source'] : ['hook', 'decision']));
          }
          console.log('');
          rl.prompt();
          return;
        }

        if (action === 'set') {
          const hook = tokens[1];
          const decision = tokens[2];
          if (!hook || !decision || !['allow', 'deny'].includes(decision)) {
            console.log(formatWarning('Usage: /policy set <hook> <allow|deny>'));
            console.log('');
            rl.prompt();
            return;
          }
          const data = readPolicyOverridesDetailed(cwd).local;
          data.toolHooks[hook] = decision;
          writePolicyOverrides(cwd, data);
          await extensions.load(cwd);
          console.log(formatSuccess(`Policy set: ${hook} -> ${decision}`));
          console.log('');
          rl.prompt();
          return;
        }

        if (action === 'unset') {
          const hook = tokens[1];
          if (!hook) {
            console.log(formatWarning('Usage: /policy unset <hook>'));
            console.log('');
            rl.prompt();
            return;
          }
          const data = readPolicyOverridesDetailed(cwd).local;
          if (!data.toolHooks[hook]) {
            console.log(formatWarning(`No policy set for "${hook}".`));
            console.log('');
            rl.prompt();
            return;
          }
          delete data.toolHooks[hook];
          writePolicyOverrides(cwd, data);
          await extensions.load(cwd);
          console.log(formatSuccess(`Policy removed: ${hook}`));
          console.log('');
          rl.prompt();
          return;
        }

        if (action === 'clear') {
          rl.pause();
          const { confirmClear } = await inquirer.prompt([
            { type: 'confirm', name: 'confirmClear', message: 'Clear all policy overrides?', default: false },
          ]);
          rl.resume();
          if (!confirmClear) {
            console.log(formatWarning('Policy clear cancelled.'));
            console.log('');
            rl.prompt();
            return;
          }
          writePolicyOverrides(cwd, { toolHooks: {} });
          await extensions.load(cwd);
          console.log(formatSuccess('Policy overrides cleared.'));
          console.log('');
          rl.prompt();
          return;
        }

        if (action === 'export') {
          const outToken = tokens.find((t) => t.startsWith('out='));
          const outPath = outToken ? outToken.slice('out='.length) : null;
          const mode = tokens.includes('local')
            ? 'local'
            : tokens.includes('global')
              ? 'global'
              : 'merged';
          const data = readPolicyOverridesDetailed(cwd);
          const view = mode === 'local' ? data.local : mode === 'global' ? data.global : data.merged;
          const defaultPath = mode === 'global' ? data.globalPath : data.localPath;
          const resolved = outPath ? path.resolve(outPath) : defaultPath;
          try {
            ensureDirExists(resolved);
            fs.writeFileSync(resolved, JSON.stringify(view, null, 2), 'utf-8');
            console.log(formatSuccess(`Policy overrides (${mode}) exported to ${resolved}`));
          } catch (err) {
            console.error(formatError(err instanceof Error ? err.message : String(err)));
          }
          console.log('');
          rl.prompt();
          return;
        }

        if (action === 'edit') {
          const details = readPolicyOverridesDetailed(cwd);
          const target = details.localPath;
          console.log(formatSuccess('Policy file location:'));
          console.log(chalk.gray(`  ${target}`));
          if (!fs.existsSync(target)) {
            console.log(chalk.gray('  (file does not exist; it will be created on save)'));
          }
          console.log('');
          rl.prompt();
          return;
        }

        if (action === 'init') {
          const details = readPolicyOverridesDetailed(cwd);
          const target = details.localPath;
          if (fs.existsSync(target)) {
            console.log(formatWarning('Policy file already exists.'));
            console.log(chalk.gray(`  ${target}`));
            console.log('');
            rl.prompt();
            return;
          }
          const starter = {
            toolHooks: {
              'example-hook': 'deny',
            },
          };
          try {
            ensureDirExists(target);
            fs.writeFileSync(target, JSON.stringify(starter, null, 2), 'utf-8');
            console.log(formatSuccess('Created policy file.'));
            console.log(chalk.gray(`  ${target}`));
          } catch (err) {
            console.error(formatError(err instanceof Error ? err.message : String(err)));
          }
          console.log('');
          rl.prompt();
          return;
        }

        if (action === 'import') {
          const fileToken = tokens[1];
          if (!fileToken) {
            console.log(formatWarning('Usage: /policy import <path> [merge|replace]'));
            console.log('');
            rl.prompt();
            return;
          }
          const mode = tokens[2] === 'replace' ? 'replace' : 'merge';
          try {
            const incoming = readPolicyFile(fileToken);
            const current = readPolicyOverridesDetailed(cwd).local;
            const next = mode === 'replace'
              ? incoming
              : { toolHooks: { ...current.toolHooks, ...incoming.toolHooks } };
            writePolicyOverrides(cwd, next);
            await extensions.load(cwd);
            console.log(formatSuccess(`Policy overrides imported (${mode}).`));
          } catch (err) {
            console.error(formatError(err instanceof Error ? err.message : String(err)));
          }
          console.log('');
          rl.prompt();
          return;
        }

        console.log(formatWarning('Usage: /policy [list|set|unset|clear]'));
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/export')) {
        const tokens = input.split(/\s+/).slice(1);
        const formats = new Set(['md', 'json', 'jsonl']);
        let targetSession = sessionId;
        let format = 'md';
        let outPath: string | undefined;

        if (tokens.length > 0) {
          const first = tokens[0].toLowerCase();
          if (formats.has(first)) {
            format = first;
            outPath = tokens[1];
          } else {
            targetSession = sanitizeSessionId(tokens[0]);
            if (tokens[1] && formats.has(tokens[1].toLowerCase())) {
              format = tokens[1].toLowerCase();
              outPath = tokens[2];
            } else {
              outPath = tokens[1];
            }
          }
        }

        const entries = readSessionEntries(targetSession);
        if (entries.length === 0) {
          console.log(formatWarning(`No messages found for session "${targetSession}".`));
          console.log('');
          rl.prompt();
          return;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '').replace('Z', '');
        const defaultExt = format === 'jsonl' ? 'jsonl' : format;
        const defaultName = `session-${targetSession}-${timestamp}.${defaultExt}`;
        const defaultDir = getSessionExportPath(targetSession);
        const resolvedPath = outPath
          ? path.resolve(outPath)
          : path.join(defaultDir, defaultName);

        try {
          ensureDirExists(resolvedPath);
          if (format === 'jsonl') {
            const lines = entries.map((entry) => JSON.stringify(entry));
            fs.writeFileSync(resolvedPath, lines.join('\n') + '\n', 'utf-8');
          } else if (format === 'json') {
            fs.writeFileSync(resolvedPath, JSON.stringify(entries, null, 2), 'utf-8');
          } else {
            const markdown = exportSessionToMarkdown(targetSession, entries);
            fs.writeFileSync(resolvedPath, markdown, 'utf-8');
          }
          console.log(formatSuccess(`Exported ${entries.length} messages to ${resolvedPath}`));
        } catch (err) {
          console.error(formatError(err instanceof Error ? err.message : String(err)));
        }

        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/export-list')) {
        const target = sanitizeSessionId(input.slice('/export-list'.length).trim() || sessionId);
        const files = listExportFiles(target);
        if (files.length === 0) {
          console.log(formatSuccess('No exports found.'));
        } else {
          console.log(formatSuccess(`Exports for "${target}":`));
          const rows = files.map(file => ({
            name: file.name,
            updated: formatTimestamp(file.updatedAtMs),
            size: `${Math.round(file.size / 1024)}kb`,
          }));
          console.log(formatTable(rows, ['name', 'updated', 'size']));
          console.log(chalk.gray(`  Directory: ${getSessionExportPath(target)}`));
        }
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/export-show')) {
        const tokens = input.split(/\s+/).slice(1);
        if (tokens.length === 0) {
          console.log(formatWarning('Usage: /export-show <filename> [session] [head=40]'));
          console.log('');
          rl.prompt();
          return;
        }
        const filename = tokens[0];
        const sessionArg = tokens[1];
        let head = 40;
        for (const token of tokens.slice(2)) {
          if (token.startsWith('head=')) {
            const val = Number(token.slice('head='.length));
            if (Number.isFinite(val) && val > 0) {
              head = Math.min(200, Math.floor(val));
            }
          }
        }
        const target = sanitizeSessionId(sessionArg || sessionId);
        let filePath: string;
        try {
          filePath = resolveExportFilePath(target, filename);
        } catch (err) {
          console.log(formatWarning(err instanceof Error ? err.message : 'Invalid export filename.'));
          console.log('');
          rl.prompt();
          return;
        }
        if (!fs.existsSync(filePath)) {
          console.log(formatWarning(`Export "${filename}" not found for session "${target}".`));
          console.log('');
          rl.prompt();
          return;
        }
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.split(/\n/).slice(0, head);
          console.log(formatSuccess(`Showing ${lines.length} lines from ${filename}:`));
          console.log(chalk.gray(lines.join('\n')));
        } catch (err) {
          console.error(formatError(err instanceof Error ? err.message : String(err)));
        }
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/export-open')) {
        const tokens = input.split(/\s+/).slice(1);
        if (tokens.length === 0) {
          console.log(formatWarning('Usage: /export-open <filename> [session]'));
          console.log('');
          rl.prompt();
          return;
        }
        const filename = tokens[0];
        const target = sanitizeSessionId(tokens[1] || sessionId);
        let filePath: string;
        try {
          filePath = resolveExportFilePath(target, filename);
        } catch (err) {
          console.log(formatWarning(err instanceof Error ? err.message : 'Invalid export filename.'));
          console.log('');
          rl.prompt();
          return;
        }
        if (!fs.existsSync(filePath)) {
          console.log(formatWarning(`Export "${filename}" not found for session "${target}".`));
          console.log('');
          rl.prompt();
          return;
        }
        console.log(formatSuccess(`Export path: ${filePath}`));
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/export-delete')) {
        const tokens = input.split(/\s+/).slice(1);
        if (tokens.length === 0) {
          console.log(formatWarning('Usage: /export-delete <filename> [session]'));
          console.log('');
          rl.prompt();
          return;
        }
        const filename = tokens[0];
        const target = sanitizeSessionId(tokens[1] || sessionId);
        let filePath: string;
        try {
          filePath = resolveExportFilePath(target, filename);
        } catch (err) {
          console.log(formatWarning(err instanceof Error ? err.message : 'Invalid export filename.'));
          console.log('');
          rl.prompt();
          return;
        }
        if (!fs.existsSync(filePath)) {
          console.log(formatWarning(`Export "${filename}" not found for session "${target}".`));
          console.log('');
          rl.prompt();
          return;
        }
        rl.pause();
        const { confirmDelete } = await inquirer.prompt([
          { type: 'confirm', name: 'confirmDelete', message: `Delete export "${filename}"?`, default: false },
        ]);
        rl.resume();
        if (!confirmDelete) {
          console.log(formatWarning('Export delete cancelled.'));
          console.log('');
          rl.prompt();
          return;
        }
        try {
          deleteExportFile(target, filename);
          console.log(formatSuccess(`Deleted export "${filename}".`));
        } catch (err) {
          console.error(formatError(err instanceof Error ? err.message : String(err)));
        }
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/export-prune')) {
        const tokens = input.split(/\s+/).slice(1);
        let target = sessionId;
        let keep = 5;
        for (const token of tokens) {
          if (!token) continue;
          if (token.startsWith('keep=')) {
            const val = Number(token.slice('keep='.length));
            if (Number.isFinite(val) && val >= 0) {
              keep = Math.min(50, Math.floor(val));
            }
            continue;
          }
          if (!token.includes('=')) {
            target = sanitizeSessionId(token);
          }
        }

        const files = listExportFiles(target);
        if (files.length <= keep) {
          console.log(formatSuccess(`No exports to prune (keep=${keep}).`));
          console.log('');
          rl.prompt();
          return;
        }

        const toDelete = files.slice(keep);
        rl.pause();
        const { confirmPrune } = await inquirer.prompt([
          { type: 'confirm', name: 'confirmPrune', message: `Delete ${toDelete.length} export(s) for "${target}"?`, default: false },
        ]);
        rl.resume();
        if (!confirmPrune) {
          console.log(formatWarning('Export prune cancelled.'));
          console.log('');
          rl.prompt();
          return;
        }

        let deleted = 0;
        for (const file of toDelete) {
          try {
            fs.unlinkSync(file.path);
            deleted++;
          } catch {
            // ignore
          }
        }
        console.log(formatSuccess(`Deleted ${deleted} export(s).`));
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/rename')) {
        const newId = input.slice('/rename'.length).trim();
        if (!newId) {
          console.log(formatWarning('Usage: /rename <new-session-id>'));
          console.log('');
          rl.prompt();
          return;
        }

        const sanitized = sanitizeSessionId(newId);
        if (sanitized === sessionId) {
          console.log(formatSuccess('Session name is unchanged.'));
          console.log('');
          rl.prompt();
          return;
        }

        const currentDir = sessionStore.getSessionDir();
        const targetDir = path.join(getSessionsDir(), sanitized);
        if (fs.existsSync(targetDir)) {
          console.log(formatWarning(`Session "${sanitized}" already exists.`));
          console.log('');
          rl.prompt();
          return;
        }

        try {
          fs.renameSync(currentDir, targetDir);
          switchSession(sanitized);
        } catch (err) {
          console.error(formatError(err instanceof Error ? err.message : String(err)));
        }

        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/delete')) {
        const arg = input.slice('/delete'.length).trim();
        const target = sanitizeSessionId(arg || sessionId);
        const targetDir = path.join(getSessionsDir(), target);
        if (!fs.existsSync(targetDir)) {
          console.log(formatWarning(`Session "${target}" not found.`));
          console.log('');
          rl.prompt();
          return;
        }

        rl.pause();
        const { confirmDelete } = await inquirer.prompt([
          { type: 'confirm', name: 'confirmDelete', message: `Delete session "${target}"?`, default: false },
        ]);
        rl.resume();
        if (!confirmDelete) {
          console.log(formatWarning('Delete cancelled.'));
          console.log('');
          rl.prompt();
          return;
        }

        try {
          fs.rmSync(targetDir, { recursive: true, force: true });
          if (target === sessionId) {
            switchSession('default');
          } else {
            console.log(formatSuccess(`Deleted session "${target}".`));
          }
        } catch (err) {
          console.error(formatError(err instanceof Error ? err.message : String(err)));
        }

        console.log('');
        rl.prompt();
        return;
      }

      if (input === '/sessions') {
        const tokens = input.split(/\s+/).slice(1);
        const includeArchived = tokens.includes('all') || tokens.includes('archived');
        const tagFilterToken = tokens.find((t) => t.startsWith('tag='));
        const tagFilter = tagFilterToken ? normalizeTag(tagFilterToken.slice('tag='.length)) : null;
        let sessions = listSessionSummaries({ includeArchived });
        if (tagFilter) {
          sessions = sessions.filter((session) =>
            session.tags.map((t) => normalizeTag(t) || '').includes(tagFilter)
          );
        }
        if (sessions.length === 0) {
          console.log(formatSuccess('No sessions found.'));
        } else {
          console.log(formatSuccess('Available sessions:'));
          const rows = sessions.map(session => ({
            id: session.id,
            messages: String(session.messageCount),
            updated: formatTimestamp(session.updatedAtMs),
            tags: session.tags.length ? session.tags.join(', ') : '-',
            archived: session.archived ? 'yes' : '',
            current: session.id === sessionId ? 'yes' : '',
          }));
          console.log(formatTable(rows, ['id', 'messages', 'updated', 'tags', 'archived', 'current']));
        }
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/archive')) {
        const target = sanitizeSessionId(input.slice('/archive'.length).trim() || sessionId);
        const targetDir = path.join(getSessionsDir(), target);
        if (!fs.existsSync(targetDir)) {
          console.log(formatWarning(`Session "${target}" not found.`));
          console.log('');
          rl.prompt();
          return;
        }
        const meta = readSessionMeta(targetDir);
        meta.archived = true;
        writeSessionMeta(targetDir, meta);
        console.log(formatSuccess(`Archived session "${target}".`));
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/unarchive')) {
        const target = sanitizeSessionId(input.slice('/unarchive'.length).trim() || sessionId);
        const targetDir = path.join(getSessionsDir(), target);
        if (!fs.existsSync(targetDir)) {
          console.log(formatWarning(`Session "${target}" not found.`));
          console.log('');
          rl.prompt();
          return;
        }
        const meta = readSessionMeta(targetDir);
        meta.archived = false;
        writeSessionMeta(targetDir, meta);
        console.log(formatSuccess(`Unarchived session "${target}".`));
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/tag')) {
        const tokens = input.split(/\s+/).slice(1);
        const action = tokens[0];
        if (!action) {
          console.log(formatWarning('Usage: /tag <list|add|remove> [tag] [session]'));
          console.log('');
          rl.prompt();
          return;
        }

        if (action === 'list') {
          const target = sanitizeSessionId(tokens[1] || sessionId);
          const targetDir = path.join(getSessionsDir(), target);
          if (!fs.existsSync(targetDir)) {
            console.log(formatWarning(`Session "${target}" not found.`));
            console.log('');
            rl.prompt();
            return;
          }
          const meta = readSessionMeta(targetDir);
          const tags = Array.isArray(meta.tags) ? meta.tags : [];
          console.log(formatSuccess(`Tags for "${target}": ${tags.length ? tags.join(', ') : '-'}`));
          console.log('');
          rl.prompt();
          return;
        }

        if (action === 'add' || action === 'remove') {
          const rawTag = tokens[1];
          const target = sanitizeSessionId(tokens[2] || sessionId);
          if (!rawTag) {
            console.log(formatWarning(`Usage: /tag ${action} <tag> [session]`));
            console.log('');
            rl.prompt();
            return;
          }
          const tag = normalizeTag(rawTag);
          if (!tag) {
            console.log(formatWarning('Tag cannot be empty.'));
            console.log('');
            rl.prompt();
            return;
          }
          const targetDir = path.join(getSessionsDir(), target);
          if (!fs.existsSync(targetDir)) {
            console.log(formatWarning(`Session "${target}" not found.`));
            console.log('');
            rl.prompt();
            return;
          }
          const meta = readSessionMeta(targetDir);
          const tags = new Set((meta.tags || []).map((t) => normalizeTag(t) || '').filter(Boolean));
          if (action === 'add') {
            tags.add(tag);
          } else {
            tags.delete(tag);
          }
          meta.tags = Array.from(tags.values()).sort();
          writeSessionMeta(targetDir, meta);
          console.log(formatSuccess(`Tags for "${target}": ${meta.tags.length ? meta.tags.join(', ') : '-'}`));
          console.log('');
          rl.prompt();
          return;
        }

        console.log(formatWarning('Usage: /tag <list|add|remove> [tag] [session]'));
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/search')) {
        const tokens = input.split(/\s+/).slice(1);
        const includeArchived = tokens.includes('all') || tokens.includes('archived');
        let roleFilter: 'user' | 'assistant' | null = null;
        let since: string | null = null;
        let until: string | null = null;
        let regexPattern: string | null = null;
        let regexFlags = '';
        let limit = 25;
        let term = '';
        const termParts: string[] = [];
        for (const token of tokens) {
          if (token === 'all' || token === 'archived') continue;
          if (token.startsWith('role=')) {
            const val = token.slice('role='.length).toLowerCase();
            if (val === 'user' || val === 'assistant') roleFilter = val;
            continue;
          }
          if (token.startsWith('since=')) {
            since = token.slice('since='.length);
            continue;
          }
          if (token.startsWith('until=')) {
            until = token.slice('until='.length);
            continue;
          }
          if (token.startsWith('regex=')) {
            const raw = token.slice('regex='.length);
            const match = raw.match(/^\/(.+)\/([gimsuy]*)$/);
            if (match) {
              regexPattern = match[1];
              regexFlags = match[2] || '';
            } else {
              regexPattern = raw;
              regexFlags = '';
            }
            continue;
          }
          if (token.startsWith('regexi=')) {
            regexPattern = token.slice('regexi='.length);
            regexFlags = 'i';
            continue;
          }
          if (token.startsWith('limit=')) {
            const val = Number(token.slice('limit='.length));
            if (Number.isFinite(val) && val > 0) {
              limit = Math.min(100, Math.floor(val));
            }
            continue;
          }
          termParts.push(token);
        }
        term = termParts.join(' ').trim();
        if (!term && !regexPattern) {
          console.log(formatWarning('Usage: /search <text> [all] [role=user|assistant] [since=YYYY-MM-DD] [until=YYYY-MM-DD] [regex=/pattern/i]'));
          console.log('');
          rl.prompt();
          return;
        }

        let sinceMs: number | null = null;
        if (since) {
          const parsed = Date.parse(since);
          if (Number.isFinite(parsed)) {
            sinceMs = parsed;
          } else {
            console.log(formatWarning('Invalid since date. Use YYYY-MM-DD.'));
            console.log('');
            rl.prompt();
            return;
          }
        }
        let untilMs: number | null = null;
        if (until) {
          const parsed = Date.parse(until);
          if (Number.isFinite(parsed)) {
            untilMs = parsed;
          } else {
            console.log(formatWarning('Invalid until date. Use YYYY-MM-DD.'));
            console.log('');
            rl.prompt();
            return;
          }
        }

        const sessions = listSessionSummaries({ includeArchived });
        if (sessions.length === 0) {
          console.log(formatSuccess('No sessions found.'));
          console.log('');
          rl.prompt();
          return;
        }

        const results: Array<{ session: string; role: string; excerpt: string; ts?: string }> = [];
        const lowerTerm = term.toLowerCase();
        let regex: RegExp | null = null;
        if (regexPattern) {
          try {
            regex = new RegExp(regexPattern, regexFlags);
          } catch {
            console.log(formatWarning('Invalid regex pattern.'));
            console.log('');
            rl.prompt();
            return;
          }
        }
        for (const session of sessions) {
          const entries = readSessionEntries(session.id);
          for (const entry of entries) {
            if (roleFilter && entry.role !== roleFilter) continue;
            if (sinceMs && entry.ts) {
              const entryMs = Date.parse(entry.ts);
              if (Number.isFinite(entryMs) && entryMs < sinceMs) continue;
            }
            if (untilMs && entry.ts) {
              const entryMs = Date.parse(entry.ts);
              if (Number.isFinite(entryMs) && entryMs > untilMs) continue;
            }
            const content = formatContentForExport(entry.content);
            if (!content) continue;
            let idx = -1;
            if (regex) {
              const match = regex.exec(content);
              if (!match || match.index === undefined) continue;
              idx = match.index;
            } else {
              idx = content.toLowerCase().indexOf(lowerTerm);
              if (idx === -1) continue;
            }
            const start = Math.max(0, idx - 40);
            const matchLen = regex && regex.lastIndex > idx ? regex.lastIndex - idx : term.length;
            const end = Math.min(content.length, idx + matchLen + 40);
            const excerpt = content.slice(start, end).replace(/\s+/g, ' ');
            results.push({
              session: session.id,
              role: entry.role,
              excerpt: (start > 0 ? '...' : '') + excerpt + (end < content.length ? '...' : ''),
              ts: entry.ts,
            });
            if (results.length >= limit) break;
          }
          if (results.length >= limit) break;
        }

        if (results.length === 0) {
          console.log(formatSuccess('No matches found.'));
        } else {
          const label = regexPattern ? `/${regexPattern}/${regexFlags || ''}` : `"${term}"`;
          console.log(formatSuccess(`Matches for ${label} (showing ${results.length}):`));
          const rows = results.map(result => ({
            session: result.session,
            role: result.role,
            time: result.ts ? new Date(result.ts).toLocaleString() : '',
            excerpt: result.excerpt,
          }));
          console.log(formatTable(rows, ['session', 'role', 'time', 'excerpt']));
        }
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/new')) {
        const provided = input.slice(4).trim();
        let nextId = provided;
        if (!nextId) {
          const defaultId = `session-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
          rl.pause();
          const answer = await inquirer.prompt([
            { type: 'input', name: 'sessionName', message: 'New session name:', default: defaultId },
          ]);
          rl.resume();
          nextId = String(answer.sessionName || '').trim();
        }

        if (!nextId) {
          console.log(formatWarning('Session name is required.'));
          console.log('');
          rl.prompt();
          return;
        }

        const sanitized = sanitizeSessionId(nextId);
        const sessionDir = path.join(getSessionsDir(), sanitized);
        if (fs.existsSync(sessionDir)) {
          rl.pause();
          const { proceed } = await inquirer.prompt([
            { type: 'confirm', name: 'proceed', message: `Session "${sanitized}" exists. Switch to it?`, default: false },
          ]);
          rl.resume();
          if (!proceed) {
            console.log(formatWarning('Session switch cancelled.'));
            console.log('');
            rl.prompt();
            return;
          }
        }

        switchSession(sanitized);
        console.log('');
        rl.prompt();
        return;
      }

      if (input === '/resume') {
        const sessions = listSessionSummaries({ includeArchived: true });
        if (sessions.length === 0) {
          console.log(formatSuccess('No sessions found.'));
          console.log('');
          rl.prompt();
          return;
        }

        rl.pause();
        const choices: Array<any> = sessions.map(session => ({
          name: `${session.id} (${session.messageCount} msgs, updated ${formatTimestamp(session.updatedAtMs)})${session.archived ? ' [archived]' : ''}${session.id === sessionId ? ' [current]' : ''}`,
          value: session.id,
        }));
        choices.push(new inquirer.Separator());
        choices.push({ name: 'Enter custom session id', value: '__custom__' });

        const { selected } = await inquirer.prompt([
          { type: 'list', name: 'selected', message: 'Resume session:', choices },
        ]);
        rl.resume();

        if (selected === '__custom__') {
          rl.pause();
          const { customId } = await inquirer.prompt([
            { type: 'input', name: 'customId', message: 'Session id:' },
          ]);
          rl.resume();
          if (!customId || !String(customId).trim()) {
            console.log(formatWarning('Session id is required.'));
            console.log('');
            rl.prompt();
            return;
          }
          switchSession(String(customId));
          console.log('');
          rl.prompt();
          return;
        }

        if (selected === sessionId) {
          console.log(formatSuccess(`Already on session: ${sessionId}`));
        } else {
          switchSession(String(selected));
        }
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/attach ')) {
        const pathInput = input.slice('/attach '.length).trim();
        if (!pathInput) {
          console.log(formatWarning('Usage: /attach <path>'));
        } else {
          pendingAttachments.push(pathInput);
          console.log(formatSuccess(`Attachment staged (${pendingAttachments.length} total).`));
        }
        console.log('');
        rl.prompt();
        return;
      }

      if (input === '/attachments') {
        if (pendingAttachments.length === 0) {
          console.log(formatSuccess('No attachments staged.'));
        } else {
          console.log(formatSuccess('Staged attachments:'));
          for (const p of pendingAttachments) {
            console.log(chalk.gray(`  - ${p}`));
          }
        }
        console.log('');
        rl.prompt();
        return;
      }

      if (input === '/attach-clear') {
        pendingAttachments = [];
        console.log(formatSuccess('Attachments cleared.'));
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/model')) {
        const modelArg = input.slice(6).trim();
        if (!modelArg) {
          console.log(formatSuccess(`Current model: ${agent.getModel()}`));
          console.log(chalk.gray('  Usage: /model <sonnet|haiku|opus>'));
        } else {
          const resolved = resolveModel(modelArg);
          if (resolved) {
            agent.setModel(resolved);
            console.log(formatSuccess(`Model switched to: ${resolved}`));
          } else {
            console.log(formatWarning(`Unknown model "${modelArg}". Use sonnet, haiku, or opus.`));
          }
        }
        console.log('');
        rl.prompt();
        return;
      }

      if (input === '/skills') {
        const skills = listSkills(cwd);
        if (skills.length === 0) {
          console.log(formatSuccess('No skills found.'));
        } else {
          console.log(formatSuccess('Available skills:'));
          const rows = skills.map(skill => ({
            name: skill.name,
            description: (skill.description || '').slice(0, 80),
          }));
          console.log(formatTable(rows, ['name', 'description']));
          if (activeSkills.length > 0) {
            console.log(chalk.gray(`  Active: ${activeSkills.join(', ')}`));
          }
        }
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/skill ')) {
        const skillName = input.slice('/skill '.length).trim();
        if (!skillName) {
          console.log(formatWarning('Usage: /skill <name>'));
        } else {
          const skill = getSkill(skillName, cwd);
          if (!skill) {
            console.log(formatWarning(`Skill "${skillName}" not found. Use /skills to list available skills.`));
          } else if (activeSkills.includes(skillName)) {
            console.log(formatSuccess(`Skill "${skillName}" already active.`));
          } else {
            activeSkills.push(skillName);
            console.log(formatSuccess(`Skill "${skillName}" activated.`));
          }
        }
        console.log('');
        rl.prompt();
        return;
      }

      if (input === '/skill-clear') {
        activeSkills.splice(0, activeSkills.length);
        console.log(formatSuccess('Active skills cleared.'));
        console.log('');
        rl.prompt();
        return;
      }

      if (input === '/prompts') {
        const templates = listPromptTemplates(cwd);
        if (templates.length === 0) {
          console.log(formatSuccess('No prompt templates found.'));
        } else {
          console.log(formatSuccess('Available prompt templates:'));
          const rows = templates.map(template => ({
            name: template.name,
            variables: template.variables.length
              ? template.variables
                  .map((v) => v.defaultValue ? `${v.name}=${v.defaultValue}` : v.name)
                  .join(', ')
              : '-',
          }));
          console.log(formatTable(rows, ['name', 'variables']));
        }
        console.log('');
        rl.prompt();
        return;
      }

      if (input === '/prompt-history') {
        const history = readPromptHistory();
        if (history.length === 0) {
          console.log(formatSuccess('No prompt history yet.'));
        } else {
          console.log(formatSuccess('Recent prompt templates:'));
          const rows = history.map(entry => ({
            template: entry.template,
            time: new Date(entry.ts).toLocaleString(),
            variables: Object.keys(entry.variables).length
              ? Object.entries(entry.variables)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(', ')
              : '-',
          }));
          console.log(formatTable(rows, ['template', 'time', 'variables']));
        }
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/prompt-validate')) {
        const tokens = input.split(/\s+/).slice(1);
        const target = tokens[0];
        if (!target) {
          console.log(formatWarning('Usage: /prompt-validate <name|all>'));
          console.log('');
          rl.prompt();
          return;
        }

        const templates = target === 'all'
          ? listPromptTemplates(cwd)
          : (() => {
              try {
                const template = getPromptTemplate(target, cwd);
                return template ? [template] : [];
              } catch (err) {
                console.error(formatError(err instanceof Error ? err.message : String(err)));
                return [];
              }
            })();

        if (templates.length === 0) {
          console.log(formatWarning(`No prompt templates found for "${target}".`));
          console.log('');
          rl.prompt();
          return;
        }

        const results: Array<{ name: string; status: string; detail: string }> = [];
        for (const template of templates) {
          const file = getPromptTemplateFile(template.name, cwd);
          if (!file) {
            results.push({ name: template.name, status: 'error', detail: 'Template file not found' });
            continue;
          }

          const rawContent = file.content;
          const includeRegex = /{{\s*(?:>\s*|include:)\s*([a-zA-Z0-9_-]+)([^}]*)}}/g;
          const includes = new Set<string>();
          let match: RegExpExecArray | null = null;
          while ((match = includeRegex.exec(rawContent))) {
            if (match[1]) includes.add(match[1].trim());
          }

          const missingIncludes = Array.from(includes).filter((name) => !getPromptTemplateFile(name, cwd));

          const errors: string[] = [];
          if (missingIncludes.length > 0) {
            errors.push(`Missing includes: ${missingIncludes.join(', ')}`);
          }

          const ifCount = (rawContent.match(/{{#if\s+[a-zA-Z0-9_-]+\s*}}/g) || []).length;
          const unlessCount = (rawContent.match(/{{#unless\s+[a-zA-Z0-9_-]+\s*}}/g) || []).length;
          const endIfCount = (rawContent.match(/{{\/if}}/g) || []).length;
          const endUnlessCount = (rawContent.match(/{{\/unless}}/g) || []).length;

          if (ifCount !== endIfCount) {
            errors.push(`Unmatched if blocks (${ifCount} open, ${endIfCount} close)`);
          }
          if (unlessCount !== endUnlessCount) {
            errors.push(`Unmatched unless blocks (${unlessCount} open, ${endUnlessCount} close)`);
          }

          const varMatches = rawContent.match(/{{\s*([a-zA-Z0-9_-]+)(?:\s*=.*)?\s*}}/g) || [];
          const declaredVars = new Set(template.variables.map((v) => v.name));
          const special = new Set(['#if', '/if', '#unless', '/unless']);
          const unknownVars = new Set<string>();
          const defaultValues = new Map<string, string>();
          const conflictingDefaults: string[] = [];
          for (const match of varMatches) {
            const tokenMatch = match.match(/{{\s*([a-zA-Z0-9_-]+)(?:\s*=.*)?\s*}}/);
            if (!tokenMatch) continue;
            const token = tokenMatch[1];
            if (special.has(token)) continue;
            if (declaredVars.has(token)) continue;
            unknownVars.add(token);

            const defaultMatch = match.match(/{{\s*([a-zA-Z0-9_-]+)\s*=\s*([^}]+?)\s*}}/);
            if (defaultMatch) {
              const name = defaultMatch[1];
              const value = defaultMatch[2].trim().replace(/^['"]|['"]$/g, '');
              if (defaultValues.has(name) && defaultValues.get(name) !== value) {
                conflictingDefaults.push(name);
              } else {
                defaultValues.set(name, value);
              }
            }
          }

          const condMatches = rawContent.match(/{{#(?:if|unless)\s+([a-zA-Z0-9_-]+)(?:\s*=\s*[^}]+?)?\s*}}/g) || [];
          for (const matchText of condMatches) {
            const tokenMatch = matchText.match(/{{#(?:if|unless)\s+([a-zA-Z0-9_-]+)(?:\s*=\s*([^}]+?))?\s*}}/);
            if (!tokenMatch) continue;
            const name = tokenMatch[1];
            const value = tokenMatch[2] ? tokenMatch[2].trim().replace(/^['"]|['"]$/g, '') : undefined;
            if (value) {
              if (defaultValues.has(name) && defaultValues.get(name) !== value) {
                conflictingDefaults.push(name);
              } else {
                defaultValues.set(name, value);
              }
            }
          }

          if (unknownVars.size > 0) {
            errors.push(`Unknown variables: ${Array.from(unknownVars).join(', ')}`);
          }

          if (conflictingDefaults.length > 0) {
            const unique = Array.from(new Set(conflictingDefaults));
            errors.push(`Conflicting defaults: ${unique.join(', ')}`);
          }

          const usedVars = new Set<string>();
          for (const matchText of varMatches) {
            const tokenMatch = matchText.match(/{{\s*([a-zA-Z0-9_-]+)(?:\s*=.*)?\s*}}/);
            if (!tokenMatch) continue;
            const token = tokenMatch[1];
            if (special.has(token)) continue;
            usedVars.add(token);
          }
          for (const matchText of condMatches) {
            const tokenMatch = matchText.match(/{{#(?:if|unless)\s+([a-zA-Z0-9_-]+)(?:\s*=\s*[^}]+?)?\s*}}/);
            if (!tokenMatch) continue;
            usedVars.add(tokenMatch[1]);
          }
          const unusedVars = Array.from(declaredVars).filter((name) => !usedVars.has(name));
          if (unusedVars.length > 0) {
            errors.push(`Unused variables: ${unusedVars.join(', ')}`);
          }

          if (errors.length > 0) {
            results.push({
              name: template.name,
              status: 'error',
              detail: errors.join('; '),
            });
          } else {
            results.push({ name: template.name, status: 'ok', detail: 'Valid' });
          }
        }

        console.log(formatSuccess('Prompt validation results:'));
        console.log(formatTable(results, ['name', 'status', 'detail']));
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/prompt ')) {
        const templateName = input.slice('/prompt '.length).trim();
        if (!templateName) {
          console.log(formatWarning('Usage: /prompt <name>'));
          console.log('');
          rl.prompt();
          return;
        }

        let template;
        try {
          template = getPromptTemplate(templateName, cwd);
        } catch (err) {
          console.error(formatError(err instanceof Error ? err.message : String(err)));
          console.log('');
          rl.prompt();
          return;
        }
        if (!template) {
          console.log(formatWarning(`Prompt template "${templateName}" not found. Use /prompts to list templates.`));
          console.log('');
          rl.prompt();
          return;
        }

        const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let expanded = template.content;

        const variableValues: Record<string, string> = {};
        if (template.variables.length > 0) {
          rl.pause();
          const answers = await inquirer.prompt(
            template.variables.map((variable) => ({
              type: 'input',
              name: variable.name,
              message: `${variable.name}:`,
              default: variable.defaultValue ?? undefined,
            }))
          );
          rl.resume();
          for (const variable of template.variables) {
            const value = String(answers[variable.name] ?? '').trim() || (variable.defaultValue ?? '');
            variableValues[variable.name] = value;
            expanded = expanded.replace(
              new RegExp(`{{\\s*${escapeRegExp(variable.name)}(?:\\s*=\\s*[^}]+?)?\\s*}}`, 'g'),
              value
            );
          }
        }

        const applyConditionals = (content: string, vars: Record<string, string>) => {
          const hasValue = (v: string | undefined) => Boolean(v && v.trim().length > 0);
          const ifRegex = /{{#if\s+([a-zA-Z0-9_-]+)(?:\s*=\s*([^}]+?))?\s*}}([\s\S]*?){{\/if}}/g;
          const unlessRegex = /{{#unless\s+([a-zA-Z0-9_-]+)(?:\s*=\s*([^}]+?))?\s*}}([\s\S]*?){{\/unless}}/g;
          let output = content;
          output = output.replace(ifRegex, (_match, key: string, defaultRaw: string, body: string) => {
            const defaultValue = defaultRaw ? defaultRaw.trim().replace(/^['"]|['"]$/g, '') : '';
            const value = vars[key] ?? defaultValue;
            return hasValue(value) ? body : '';
          });
          output = output.replace(unlessRegex, (_match, key: string, defaultRaw: string, body: string) => {
            const defaultValue = defaultRaw ? defaultRaw.trim().replace(/^['"]|['"]$/g, '') : '';
            const value = vars[key] ?? defaultValue;
            return hasValue(value) ? '' : body;
          });
          return output;
        };

        expanded = applyConditionals(expanded, variableValues);

        console.log(chalk.gray('\n  Prompt template preview:'));
        console.log(chalk.gray(expanded));
        rl.pause();
        const { send } = await inquirer.prompt([
          { type: 'confirm', name: 'send', message: 'Send this prompt?', default: true },
        ]);
        rl.resume();
        if (!send) {
          console.log(formatWarning('Prompt cancelled.'));
          console.log('');
          rl.prompt();
          return;
        }

        finalInput = expanded;
        appendPromptHistory({
          ts: new Date().toISOString(),
          template: template.name,
          variables: variableValues,
        });
      }

      if (input.startsWith('/')) {
        const trimmed = input.slice(1).trim();
        if (trimmed) {
          const [commandName, ...restParts] = trimmed.split(/\s+/);
          const extCommand = extensions.getCommand(commandName);
          if (extCommand) {
            try {
              const result = await extCommand.handler(restParts.join(' '), buildExtensionContext());
              if (typeof result === 'string') {
                finalInput = result;
              } else if (result && typeof result === 'object' && 'send' in result) {
                finalInput = String((result as { send: string }).send);
              } else {
                console.log('');
                rl.prompt();
                return;
              }
            } catch (err) {
              console.error(formatError(err instanceof Error ? err.message : String(err)));
              console.log('');
              rl.prompt();
              return;
            }
          }
        }
      }

      if (input === 'exit' || input === 'quit') {
        await shutdown();
        return;
      }

      processing = true;
      const startTime = Date.now();

      // Stream response: print text token-by-token
      let firstText = true;
      let usageLine = '';
      try {
        const memory = loadMemory(sessionId);
        agent.setSystemPrompt(buildSystemPrompt({ sessionId, memory, cwd, activeSkills }));

        let userContent: string | Parameters<typeof agent.chat>[0] = finalInput;
        if (pendingAttachments.length > 0) {
          const { content, warnings } = buildUserContent(finalInput, pendingAttachments);
          pendingAttachments = [];
          userContent = content;
          if (warnings.length > 0) {
            for (const warning of warnings) {
              console.log(formatWarning(warning));
            }
          }
        }

        const response = await agent.chat(userContent, {
          onText: (delta) => {
            if (firstText) {
              firstText = false;
            }
            process.stdout.write(chalk.white(delta));
          },
          onToolCall: (name, args) => {
            console.log(formatToolCall(name, args));
          },
          onToolCallStart: async (name, args) => {
            try {
              let decision = await extensions.runToolHooks({ name, args }, buildToolHookContext());

              if (decision?.action === 'deny' && decision.hookName) {
                const hookKey = makeHookPermissionKey(decision.hookName, name);
                const stored = permissionStore.toolHooks[hookKey];

                if (stored === 'allow') {
                  decision = { action: 'allow', args };
                } else if (stored === 'deny') {
                  decision = { action: 'deny', reason: decision.reason, hookName: decision.hookName };
                } else {
                  rl.pause();
                  const { choice } = await inquirer.prompt([
                    {
                      type: 'list',
                      name: 'choice',
                      message: `Extension hook "${decision.hookName}" denied tool "${name}".`,
                      choices: [
                        { name: 'Allow once', value: 'allow_once' },
                        { name: 'Always allow', value: 'allow_always' },
                        { name: 'Deny once', value: 'deny_once' },
                        { name: 'Always deny', value: 'deny_always' },
                      ],
                    },
                  ]);
                  rl.resume();

                  if (choice === 'allow_once') {
                    decision = { action: 'allow', args };
                  } else if (choice === 'allow_always') {
                    permissionStore.toolHooks[hookKey] = 'allow';
                    writePermissionStore(permissionStore);
                    decision = { action: 'allow', args };
                  } else if (choice === 'deny_always') {
                    permissionStore.toolHooks[hookKey] = 'deny';
                    writePermissionStore(permissionStore);
                    decision = { action: 'deny', reason: decision.reason, hookName: decision.hookName };
                  } else {
                    decision = { action: 'deny', reason: decision.reason, hookName: decision.hookName };
                  }
                }
              }

              if (auditEnabled) {
                appendToolAudit(sessionId, {
                  ts: new Date().toISOString(),
                  type: 'tool_call',
                  session: sessionId,
                  name,
                  args: sanitizeToolArgs(decision?.action === 'allow' && decision.args ? decision.args : args),
                  decision: decision?.action || 'allow',
                  reason: decision && 'reason' in decision ? decision.reason : undefined,
                });
              }

              return decision;
            } catch (err) {
              console.error(formatError(err instanceof Error ? err.message : String(err)));
              return undefined;
            }
          },
          onToolCallEnd: (result) => {
            extensions.runToolResultHooks(result, buildToolHookContext())
              .catch((err) => {
                console.error(formatError(err instanceof Error ? err.message : String(err)));
              });
            if (auditEnabled) {
              const entry: ToolAuditEntry = {
                ts: new Date().toISOString(),
                type: 'tool_result',
                session: sessionId,
                name: result.name,
                durationMs: result.durationMs,
                isError: result.isError,
                resultLength: result.resultText.length,
              };
              if (auditIncludeExcerpt) {
                entry.resultExcerpt = result.resultText.slice(0, 500);
              }
              appendToolAudit(sessionId, entry);
            }
          },
          onUsage: (usage) => {
            if (showUsage) {
              usageLine = formatUsage(usage);
            }
          },
        });

        // If no streaming text was emitted (shouldn't happen, but safety)
        if (firstText && response) {
          console.log(formatAssistantMessage(response));
        }

        const elapsed = Date.now() - startTime;
        console.log(formatElapsed(elapsed));
        if (usageLine) {
          console.log(usageLine);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg !== 'Request cancelled') {
          console.error('\n' + formatError(msg));
        }
      }
      processing = false;
      console.log('');
      rl.prompt();
    };

    rl.on('line', handleLine);

    rl.on('close', async () => {
      await shutdown();
    });
  });

program.parse();
