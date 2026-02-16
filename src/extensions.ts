import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getStateSetDir } from './session.js';

/** Return type for extension command handlers: void for no-op, string for display, `send` to chat, or `handled` to suppress further processing. */
export type ExtensionCommandResult = void | string | { send: string } | { handled: true };

export interface ExtensionCommandContext {
  cwd: string;
  sessionId: string;
  setSession: (sessionId: string) => void;
  listSessions: () => Array<{
    id: string;
    messageCount: number;
    updatedAtMs: number;
    tags?: string[];
    archived?: boolean;
  }>;
  log: (message: string) => void;
  success: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export interface ExtensionCommand {
  name: string;
  description?: string;
  usage?: string;
  handler: (
    args: string,
    ctx: ExtensionCommandContext,
  ) => Promise<ExtensionCommandResult> | ExtensionCommandResult;
}

export interface ToolCallInfo {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolHookContext {
  cwd: string;
  sessionId: string;
  sessionTags: string[];
  allowApply: boolean;
  redact: boolean;
  policy: Record<string, string>;
  log: (message: string) => void;
  success: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

/** A tool hook's verdict: allow (optionally rewriting args), deny with reason, or respond with canned content. */
export type ToolHookDecision =
  | { action: 'allow'; args?: Record<string, unknown> }
  | { action: 'deny'; reason?: string; hookName?: string; hookSource?: string }
  | { action: 'respond'; content: string; hookName?: string; hookSource?: string };

export interface ToolHook {
  name: string;
  description?: string;
  tools?: string[];
  policy?: 'allow' | 'deny';
  tags?: string[];
  handler: (
    call: ToolCallInfo,
    ctx: ToolHookContext,
  ) => Promise<ToolHookDecision | void> | ToolHookDecision | void;
}

export interface ToolResultInfo {
  name: string;
  args: Record<string, unknown>;
  resultText: string;
  isError: boolean;
  durationMs: number;
}

export interface ToolResultHook {
  name: string;
  description?: string;
  tools?: string[];
  handler: (result: ToolResultInfo, ctx: ToolHookContext) => Promise<void> | void;
}

export interface ExtensionInfo {
  name: string;
  path: string;
  commands: ExtensionCommand[];
  toolHooks: ToolHook[];
  toolResultHooks: ToolResultHook[];
}

export interface ExtensionDiagnostic {
  source: string;
  message: string;
}

function isCommandNameValid(name: string): boolean {
  return /^[a-z0-9_-]+$/i.test(name);
}

function isHookNameValid(name: string): boolean {
  return /^[a-z0-9_-]+$/i.test(name);
}

interface ExtensionTrustPolicy {
  enforce: boolean;
  allowed: Set<string>;
  denied: Set<string>;
}

const EXTENSION_TRUST_FILES = ['extension-trust.json', 'extensions-trust.json'];

function listExtensionFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('.'))
    .filter((name) => name.endsWith('.js') || name.endsWith('.mjs') || name.endsWith('.cjs'))
    .map((name) => path.join(dir, name));
}

/**
 * Discovers and loads CLI extensions from ~/.stateset/extensions/ and
 * .stateset/extensions/, registering slash commands, tool hooks, and result hooks.
 */
export class ExtensionManager {
  private commands = new Map<string, ExtensionCommand & { source: string }>();
  private toolHooks: Array<ToolHook & { source: string }> = [];
  private toolResultHooks: Array<ToolResultHook & { source: string }> = [];
  private toolHookNames = new Set<string>();
  private toolResultHookNames = new Set<string>();
  private extensions: ExtensionInfo[] = [];
  private diagnostics: ExtensionDiagnostic[] = [];
  private runtimeDiagnostics: ExtensionDiagnostic[] = [];
  private policyOverrides: Record<string, string> = {};
  private extensionTrust: ExtensionTrustPolicy = {
    enforce: false,
    allowed: new Set(),
    denied: new Set(),
  };

  async load(cwd: string): Promise<void> {
    this.commands.clear();
    this.toolHooks = [];
    this.toolResultHooks = [];
    this.toolHookNames.clear();
    this.toolResultHookNames.clear();
    this.extensions = [];
    this.diagnostics = [];
    this.runtimeDiagnostics = [];
    this.policyOverrides = loadPolicyOverrides(cwd, this.diagnostics);
    this.extensionTrust = loadExtensionTrustPolicy(cwd, this.diagnostics);
    const globalDir = path.join(getStateSetDir(), 'extensions');
    const projectDir = path.join(cwd, '.stateset', 'extensions');
    const files = [...listExtensionFiles(globalDir), ...listExtensionFiles(projectDir)];
    if (!this.extensionTrust.enforce && files.length > 0) {
      this.diagnostics.push({
        source: 'extensions',
        message:
          'Extension trust policy is disabled. Enable STATESET_EXTENSIONS_ENFORCE_TRUST=true to apply allow/deny rules.',
      });
    }

    for (const filePath of files) {
      const extensionName = path.basename(filePath, path.extname(filePath));
      if (!isExtensionTrusted(extensionName, filePath, this.extensionTrust, this.diagnostics)) {
        continue;
      }
      const registeredCommands: ExtensionCommand[] = [];
      const registeredToolHooks: ToolHook[] = [];
      const registeredToolResultHooks: ToolResultHook[] = [];

      const api = {
        registerCommand: (command: ExtensionCommand) => {
          if (!command?.name || !isCommandNameValid(command.name)) {
            this.diagnostics.push({
              source: filePath,
              message: `Invalid command name "${command?.name ?? ''}"`,
            });
            return;
          }
          if (this.commands.has(command.name)) {
            this.diagnostics.push({
              source: filePath,
              message: `Command "${command.name}" already registered`,
            });
            return;
          }
          const wrapped = { ...command, source: filePath };
          this.commands.set(command.name, wrapped);
          registeredCommands.push(command);
        },
        registerToolHook: (hook: ToolHook) => {
          if (!hook?.name || !isHookNameValid(hook.name)) {
            this.diagnostics.push({
              source: filePath,
              message: `Invalid tool hook name "${hook?.name ?? ''}"`,
            });
            return;
          }
          if (this.toolHookNames.has(hook.name)) {
            this.diagnostics.push({
              source: filePath,
              message: `Tool hook "${hook.name}" already registered`,
            });
            return;
          }
          if (!hook.handler) {
            this.diagnostics.push({
              source: filePath,
              message: `Tool hook "${hook.name}" missing handler`,
            });
            return;
          }
          this.toolHookNames.add(hook.name);
          this.toolHooks.push({ ...hook, source: filePath });
          registeredToolHooks.push(hook);
        },
        registerToolResultHook: (hook: ToolResultHook) => {
          if (!hook?.name || !isHookNameValid(hook.name)) {
            this.diagnostics.push({
              source: filePath,
              message: `Invalid tool result hook name "${hook?.name ?? ''}"`,
            });
            return;
          }
          if (this.toolResultHookNames.has(hook.name)) {
            this.diagnostics.push({
              source: filePath,
              message: `Tool result hook "${hook.name}" already registered`,
            });
            return;
          }
          if (!hook.handler) {
            this.diagnostics.push({
              source: filePath,
              message: `Tool result hook "${hook.name}" missing handler`,
            });
            return;
          }
          this.toolResultHookNames.add(hook.name);
          this.toolResultHooks.push({ ...hook, source: filePath });
          registeredToolResultHooks.push(hook);
        },
      };

      try {
        const cacheBust = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        const moduleUrl = `${pathToFileURL(filePath).href}?t=${cacheBust}`;
        const mod = (await import(moduleUrl)) as Record<string, unknown>;
        const register =
          typeof mod?.default === 'function'
            ? mod.default
            : typeof mod?.register === 'function'
              ? mod.register
              : null;

        if (!register) {
          if (Array.isArray(mod?.commands)) {
            for (const command of mod.commands) {
              api.registerCommand(command);
            }
          } else {
            this.diagnostics.push({
              source: filePath,
              message: 'No default export or register() function found.',
            });
          }
        } else {
          await register(api);
        }
      } catch (err) {
        this.diagnostics.push({
          source: filePath,
          message: err instanceof Error ? err.message : String(err),
        });
      }

      if (
        registeredCommands.length > 0 ||
        registeredToolHooks.length > 0 ||
        registeredToolResultHooks.length > 0
      ) {
        this.extensions.push({
          name: extensionName,
          path: filePath,
          commands: registeredCommands,
          toolHooks: registeredToolHooks,
          toolResultHooks: registeredToolResultHooks,
        });
      }
    }
  }

  getCommand(name: string): (ExtensionCommand & { source: string }) | null {
    return this.commands.get(name) || null;
  }

  listCommands(): Array<ExtensionCommand & { source: string }> {
    return Array.from(this.commands.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  listExtensions(): ExtensionInfo[] {
    return [...this.extensions];
  }

  listDiagnostics(): ExtensionDiagnostic[] {
    return [...this.diagnostics, ...this.runtimeDiagnostics];
  }

  getPolicyOverrides(): Record<string, string> {
    return { ...this.policyOverrides };
  }

  async runToolHooks(call: ToolCallInfo, ctx: ToolHookContext): Promise<ToolHookDecision | void> {
    let currentArgs = call.args;
    for (const hook of this.toolHooks) {
      if (hook.tags && hook.tags.length > 0 && !matchesTags(ctx.sessionTags, hook.tags)) {
        continue;
      }
      if (hook.tools && hook.tools.length > 0 && !matchesToolList(call.name, hook.tools)) {
        continue;
      }
      try {
        let decision: ToolHookDecision | void;
        const policyKey = hook.name;
        const override = this.policyOverrides[policyKey];
        if (override === 'deny') {
          decision = {
            action: 'deny',
            reason: hook.description || `Tool "${call.name}" blocked by policy.`,
          };
        } else if (override === 'allow') {
          decision = { action: 'allow' };
        } else if (hook.policy === 'deny') {
          decision = {
            action: 'deny',
            reason: hook.description || `Tool "${call.name}" blocked by policy.`,
          };
        } else if (hook.policy === 'allow') {
          decision = { action: 'allow' };
        } else {
          decision = await hook.handler({ name: call.name, args: currentArgs }, ctx);
        }

        if (!decision) continue;
        if (decision.action === 'deny' || decision.action === 'respond') {
          return { ...decision, hookName: hook.name, hookSource: hook.source };
        }
        if (decision.action === 'allow' && decision.args) {
          currentArgs = decision.args;
        }
      } catch (err) {
        this.runtimeDiagnostics.push({
          source: hook.source,
          message: `Tool hook "${hook.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    if (currentArgs !== call.args) {
      return { action: 'allow', args: currentArgs };
    }
    return undefined;
  }

  async runToolResultHooks(result: ToolResultInfo, ctx: ToolHookContext): Promise<void> {
    for (const hook of this.toolResultHooks) {
      if (hook.tools && hook.tools.length > 0 && !matchesToolList(result.name, hook.tools)) {
        continue;
      }
      try {
        await hook.handler(result, ctx);
      } catch (err) {
        this.runtimeDiagnostics.push({
          source: hook.source,
          message: `Tool result hook "${hook.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }
}

function matchesToolList(name: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchPattern(name, pattern));
}

function matchPattern(value: string, pattern: string): boolean {
  if (pattern === '*') return true;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const regex = new RegExp(`^${escaped}$`, 'i');
  return regex.test(value);
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

function parseCommaSeparatedList(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

function parseTrustArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
    .filter(Boolean);
}

function loadExtensionTrustPolicy(
  cwd: string,
  diagnostics: ExtensionDiagnostic[],
): ExtensionTrustPolicy {
  const policy: ExtensionTrustPolicy = {
    enforce: false,
    allowed: new Set(),
    denied: new Set(),
  };

  const envEnforce =
    process.env.STATESET_EXTENSIONS_ENFORCE_TRUST === '1' ||
    process.env.STATESET_EXTENSIONS_ENFORCE_TRUST?.toLowerCase() === 'true';
  const envAllow = parseCommaSeparatedList(process.env.STATESET_EXTENSIONS_ALLOW);
  const envDeny = parseCommaSeparatedList(process.env.STATESET_EXTENSIONS_DENY);

  if (envEnforce || envAllow.size > 0) {
    policy.enforce = true;
  }

  for (const name of envAllow) policy.allowed.add(name);
  for (const name of envDeny) policy.denied.add(name);

  const policyPaths = EXTENSION_TRUST_FILES.flatMap((filename) => [
    path.join(getStateSetDir(), filename),
    path.join(cwd, '.stateset', filename),
  ]);

  for (const filePath of policyPaths) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content) as {
        enforce?: boolean;
        allow?: unknown;
        allowed?: unknown;
        deny?: unknown;
        denied?: unknown;
      };

      if (typeof parsed.enforce === 'boolean' && parsed.enforce) {
        policy.enforce = true;
      }

      const fileAllowed = parseTrustArray(parsed.allow ?? parsed.allowed);
      const fileDenied = parseTrustArray(parsed.deny ?? parsed.denied);

      for (const name of fileAllowed) {
        policy.allowed.add(name);
      }
      for (const name of fileDenied) {
        policy.denied.add(name);
      }

      if (fileAllowed.length > 0) {
        policy.enforce = true;
      }
    } catch (err) {
      diagnostics.push({
        source: filePath,
        message: `Failed to load extension trust policy: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return policy;
}

function isExtensionTrusted(
  extensionName: string,
  filePath: string,
  policy: ExtensionTrustPolicy,
  diagnostics: ExtensionDiagnostic[],
): boolean {
  const normalized = extensionName.toLowerCase();
  if (policy.denied.has(normalized)) {
    diagnostics.push({
      source: filePath,
      message: `Extension "${extensionName}" blocked by trust policy (denied).`,
    });
    return false;
  }
  if (!policy.enforce) return true;
  if (policy.allowed.size === 0) {
    diagnostics.push({
      source: filePath,
      message:
        'Extension trust policy is enforced, but no allowlist is configured. Configure STATESET_EXTENSIONS_ALLOW.',
    });
    return false;
  }
  if (!policy.allowed.has(normalized)) {
    diagnostics.push({
      source: filePath,
      message: `Extension "${extensionName}" blocked by trust policy. Add to allowlist.`,
    });
    return false;
  }
  return true;
}

function matchesTags(sessionTags: string[], hookTags: string[]): boolean {
  const sessionSet = new Set(sessionTags.map(normalizeTag).filter(Boolean));
  return hookTags.some((tag) => sessionSet.has(normalizeTag(tag)));
}

function loadPolicyOverrides(
  cwd: string,
  diagnostics: ExtensionDiagnostic[],
): Record<string, string> {
  const overrides: Record<string, string> = {};
  const globalPath = path.join(getStateSetDir(), 'policies.json');
  const projectPath = path.join(cwd, '.stateset', 'policies.json');
  const files = [globalPath, projectPath];

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content) as { toolHooks?: Record<string, string> };
      if (!parsed || typeof parsed !== 'object') continue;
      if (parsed.toolHooks && typeof parsed.toolHooks === 'object') {
        for (const [key, value] of Object.entries(parsed.toolHooks)) {
          if (value === 'allow' || value === 'deny') {
            overrides[key] = value;
          } else {
            diagnostics.push({
              source: filePath,
              message: `Invalid policy value for "${key}": ${String(value)}`,
            });
          }
        }
      }
    } catch (err) {
      diagnostics.push({
        source: filePath,
        message: `Failed to parse policies.json: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return overrides;
}
