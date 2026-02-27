import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getStateSetDir } from './session.js';
import { readJsonFile } from './utils/file-read.js';
import { getErrorMessage } from './lib/errors.js';

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

function isExtensionNameValid(name: string): boolean {
  return /^[a-z0-9_-]+$/i.test(name);
}

interface ExtensionTrustPolicy {
  enforce: boolean;
  requiresAllowlist: boolean;
  allowed: Set<string>;
  denied: Set<string>;
  requireHashes: boolean;
  hashes: Map<string, string>;
}

const MAX_EXTENSION_FILE_SIZE_BYTES = 1_048_576;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;

const EXTENSION_TRUST_FILES = ['extension-trust.json', 'extensions-trust.json'];

function listExtensionFiles(dir: string, diagnostics: ExtensionDiagnostic[]): string[] {
  try {
    const dirStats = fs.lstatSync(dir);
    if (!dirStats.isDirectory() || dirStats.isSymbolicLink()) {
      diagnostics.push({
        source: dir,
        message: `Skipping extension directory "${dir}" because it is not a regular directory.`,
      });
      return [];
    }
  } catch (err) {
    if (
      (err as NodeJS.ErrnoException).code === 'ENOENT' ||
      (err as NodeJS.ErrnoException).code === 'ENOTDIR'
    ) {
      return [];
    }
    diagnostics.push({
      source: dir,
      message: `Failed to inspect extension directory "${dir}": ${getErrorMessage(err)}`,
    });
    return [];
  }

  if (!fs.existsSync(dir)) return [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('.'))
    .filter((name) => name.endsWith('.js') || name.endsWith('.mjs') || name.endsWith('.cjs'))
    .map((name) => path.join(dir, name));
}

function readSafeJsonFile(
  filePath: string,
  diagnostics: ExtensionDiagnostic[],
  label: string,
): Record<string, unknown> | null {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(filePath);
  } catch (err) {
    if (
      (err as NodeJS.ErrnoException).code === 'ENOENT' ||
      (err as NodeJS.ErrnoException).code === 'ENOTDIR'
    ) {
      return null;
    }
    diagnostics.push({
      source: filePath,
      message: `Failed to inspect ${label}: ${getErrorMessage(err)}`,
    });
    return null;
  }

  if (!stats.isFile() || stats.isSymbolicLink()) {
    diagnostics.push({
      source: filePath,
      message: `Skipping ${label} because it is not a safe regular file: ${path.basename(filePath)}.`,
    });
    return null;
  }
  if (stats.size > MAX_EXTENSION_FILE_SIZE_BYTES) {
    diagnostics.push({
      source: filePath,
      message: `Skipping ${label} because it exceeds size limit: ${path.basename(filePath)}.`,
    });
    return null;
  }

  try {
    const parsed = readJsonFile(filePath, {
      label,
      expectObject: true,
      maxBytes: MAX_EXTENSION_FILE_SIZE_BYTES,
    });
    return parsed as Record<string, unknown>;
  } catch (err) {
    diagnostics.push({
      source: filePath,
      message: `Failed to load ${label}: ${getErrorMessage(err)}`,
    });
    return null;
  }
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
  private static readonly MAX_RUNTIME_DIAGNOSTICS = 200;
  private runtimeDiagnostics: ExtensionDiagnostic[] = [];
  private policyOverrides: Record<string, string> = {};
  private extensionTrust: ExtensionTrustPolicy = {
    enforce: false,
    requiresAllowlist: false,
    allowed: new Set(),
    denied: new Set(),
    requireHashes: false,
    hashes: new Map(),
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
    const projectDirResolved = path.resolve(projectDir);
    const files = [
      ...listExtensionFiles(globalDir, this.diagnostics),
      ...listExtensionFiles(projectDir, this.diagnostics),
    ];
    const hasProjectExtensions = files.some((filePath) =>
      isWithinDirectory(filePath, projectDirResolved),
    );
    if (!this.extensionTrust.enforce && hasProjectExtensions) {
      this.diagnostics.push({
        source: 'extensions',
        message:
          'Project extension trust policy is disabled. Enable STATESET_EXTENSIONS_ENFORCE_TRUST=true and configure trust rules (allow/deny) to run project-local extensions.',
      });
    }

    for (const filePath of files) {
      const extensionName = path.basename(filePath, path.extname(filePath));
      if (!isExtensionNameValid(extensionName)) {
        this.diagnostics.push({
          source: filePath,
          message: `Invalid extension filename "${path.basename(filePath)}".`,
        });
        continue;
      }
      if (!isExtensionFileSafe(filePath, this.diagnostics)) {
        continue;
      }
      if (!this.extensionTrust.enforce && isWithinDirectory(filePath, projectDirResolved)) {
        this.diagnostics.push({
          source: filePath,
          message: `Project extension "${extensionName}" is blocked until trust policy is enforced.`,
        });
        continue;
      }
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
          // Enforce a timeout on extension registration to prevent hangs from
          // malicious or buggy extensions.
          const EXTENSION_REGISTER_TIMEOUT_MS = 10_000;
          await Promise.race([
            register(api),
            new Promise<never>((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(
                      `Extension register() timed out after ${EXTENSION_REGISTER_TIMEOUT_MS}ms`,
                    ),
                  ),
                EXTENSION_REGISTER_TIMEOUT_MS,
              ),
            ),
          ]);
        }
      } catch (err) {
        this.diagnostics.push({
          source: filePath,
          message: getErrorMessage(err),
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

  private appendRuntimeDiagnostic(diagnostic: ExtensionDiagnostic): void {
    if (this.runtimeDiagnostics.length >= ExtensionManager.MAX_RUNTIME_DIAGNOSTICS) {
      this.runtimeDiagnostics.splice(
        0,
        this.runtimeDiagnostics.length - ExtensionManager.MAX_RUNTIME_DIAGNOSTICS + 1,
      );
    }
    this.runtimeDiagnostics.push(diagnostic);
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
        this.appendRuntimeDiagnostic({
          source: hook.source,
          message: `Tool hook "${hook.name}" failed: ${getErrorMessage(err)}`,
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
        this.appendRuntimeDiagnostic({
          source: hook.source,
          message: `Tool result hook "${hook.name}" failed: ${getErrorMessage(err)}`,
        });
      }
    }
  }
}

function matchesToolList(name: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchPattern(name, pattern));
}

function isExtensionFileSafe(filePath: string, diagnostics: ExtensionDiagnostic[]): boolean {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(filePath);
  } catch (err) {
    diagnostics.push({
      source: filePath,
      message: `Failed to inspect extension file: ${getErrorMessage(err)}`,
    });
    return false;
  }

  if (!stats.isFile()) {
    diagnostics.push({
      source: filePath,
      message: `Skipping extension file that is not a regular file: ${path.basename(filePath)}`,
    });
    return false;
  }
  if (stats.size > MAX_EXTENSION_FILE_SIZE_BYTES) {
    diagnostics.push({
      source: filePath,
      message: `Skipping extension file too large: ${path.basename(filePath)} (>1MB).`,
    });
    return false;
  }
  return true;
}

function isWithinDirectory(filePath: string, parentDir: string): boolean {
  const normalizedFile = path.resolve(filePath);
  const normalizedParent = path.resolve(parentDir);
  return (
    normalizedFile === normalizedParent ||
    normalizedFile.startsWith(`${normalizedParent}${path.sep}`)
  );
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

function parseHashMapFromObject(
  value: unknown,
  diagnostics: ExtensionDiagnostic[],
  source: string,
): Map<string, string> {
  const out = new Map<string, string>();

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    diagnostics.push({
      source,
      message: `Skipping hash entries from ${source}: expected object of extension-name => sha256.`,
    });
    return out;
  }

  for (const [name, digest] of Object.entries(value)) {
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName) {
      continue;
    }
    if (typeof digest !== 'string') {
      diagnostics.push({
        source,
        message: `Skipping invalid hash for extension "${name}" in ${source}: hash must be a string.`,
      });
      continue;
    }

    const normalizedDigest = digest.trim().toLowerCase();
    if (!SHA256_HEX_PATTERN.test(normalizedDigest)) {
      diagnostics.push({
        source,
        message: `Skipping invalid sha256 for extension "${name}" in ${source}: must be a 64-char hex digest.`,
      });
      continue;
    }

    out.set(normalizedName, normalizedDigest);
  }

  return out;
}

function parseHashMapFromEnv(
  value: string | undefined,
  diagnostics: ExtensionDiagnostic[],
  source: string,
): Map<string, string> {
  const out = new Map<string, string>();
  if (!value) return out;

  for (const entry of value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)) {
    const separator = entry.indexOf(':');
    if (separator <= 0 || separator >= entry.length - 1) {
      diagnostics.push({
        source,
        message: `Skipping malformed hash entry in ${source}: "${entry}". Use "<extension>:<sha256>".`,
      });
      continue;
    }

    const name = entry.slice(0, separator).trim().toLowerCase();
    const digest = entry
      .slice(separator + 1)
      .trim()
      .toLowerCase();
    if (!name || !SHA256_HEX_PATTERN.test(digest)) {
      diagnostics.push({
        source,
        message: `Skipping invalid hash entry for extension "${name || '(empty)'}" in ${source}.`,
      });
      continue;
    }

    out.set(name, digest);
  }

  return out;
}

function sha256File(filePath: string): string | null {
  try {
    const data = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
  } catch {
    return null;
  }
}

function loadExtensionTrustPolicy(
  cwd: string,
  diagnostics: ExtensionDiagnostic[],
): ExtensionTrustPolicy {
  const policy: ExtensionTrustPolicy = {
    enforce: false,
    requiresAllowlist: false,
    allowed: new Set(),
    denied: new Set(),
    requireHashes: false,
    hashes: new Map(),
  };

  const envEnforce =
    process.env.STATESET_EXTENSIONS_ENFORCE_TRUST === '1' ||
    process.env.STATESET_EXTENSIONS_ENFORCE_TRUST?.toLowerCase() === 'true';
  const envAllow = parseCommaSeparatedList(process.env.STATESET_EXTENSIONS_ALLOW);
  const envDeny = parseCommaSeparatedList(process.env.STATESET_EXTENSIONS_DENY);
  const envRequireHashes =
    process.env.STATESET_EXTENSIONS_REQUIRE_HASHES === '1' ||
    process.env.STATESET_EXTENSIONS_REQUIRE_HASHES?.toLowerCase() === 'true';
  const envHashes = parseHashMapFromEnv(
    process.env.STATESET_EXTENSIONS_HASHES,
    diagnostics,
    'environment variable STATESET_EXTENSIONS_HASHES',
  );
  let hasExplicitEnforce = false;

  if (envEnforce) {
    hasExplicitEnforce = true;
    policy.enforce = true;
  }
  if (envRequireHashes) {
    policy.requireHashes = true;
    policy.enforce = true;
  }
  const hasEnvTrustEntries = envAllow.size > 0 || envDeny.size > 0;
  if (hasEnvTrustEntries) {
    policy.enforce = true;
  }

  for (const name of envAllow) policy.allowed.add(name);
  for (const name of envDeny) policy.denied.add(name);
  for (const [name, digest] of envHashes.entries()) {
    policy.hashes.set(name, digest);
  }

  const policyPaths = EXTENSION_TRUST_FILES.flatMap((filename) => [
    path.join(getStateSetDir(), filename),
    path.join(cwd, '.stateset', filename),
  ]);

  for (const filePath of policyPaths) {
    const parsed = readSafeJsonFile(filePath, diagnostics, 'extension trust policy');
    if (!parsed) continue;

    if (typeof parsed.enforce === 'boolean' && parsed.enforce) {
      policy.enforce = true;
      hasExplicitEnforce = true;
    }

    const fileAllowed = parseTrustArray(parsed.allow ?? parsed.allowed);
    const fileDenied = parseTrustArray(parsed.deny ?? parsed.denied);
    const hashValue =
      (parsed as { hashes?: unknown; integrity?: unknown }).hashes ??
      (parsed as { integrity?: unknown }).integrity ??
      (parsed as { sha256?: unknown }).sha256;
    const fileHashes = hashValue
      ? parseHashMapFromObject(hashValue, diagnostics, `extension trust policy ${filePath}`)
      : new Map<string, string>();
    const fileRequireHashes =
      typeof parsed.requireHashes === 'boolean' ? parsed.requireHashes : undefined;

    for (const name of fileAllowed) {
      policy.allowed.add(name);
    }
    for (const name of fileDenied) {
      policy.denied.add(name);
    }
    for (const [name, digest] of fileHashes) {
      policy.hashes.set(name, digest);
    }
    if (fileRequireHashes) {
      policy.requireHashes = true;
    }

    if (fileAllowed.length > 0 || fileDenied.length > 0) {
      policy.enforce = true;
    }
  }

  if (hasExplicitEnforce && policy.allowed.size === 0 && policy.denied.size === 0) {
    policy.requiresAllowlist = true;
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
  if (policy.requiresAllowlist && policy.allowed.size === 0) {
    diagnostics.push({
      source: filePath,
      message:
        'Extension trust policy is enforced without an allowlist. Configure STATESET_EXTENSIONS_ALLOW.',
    });
    return false;
  }
  if (policy.allowed.size > 0 && !policy.allowed.has(normalized)) {
    diagnostics.push({
      source: filePath,
      message: `Extension "${extensionName}" blocked by trust policy. Add to allowlist.`,
    });
    return false;
  }
  const expectedHash = policy.hashes.get(normalized);
  if (policy.requireHashes && !expectedHash) {
    diagnostics.push({
      source: filePath,
      message: `Extension "${extensionName}" blocked because hash policy requires explicit digest in trust file or STATESET_EXTENSIONS_HASHES.`,
    });
    return false;
  }

  if (expectedHash) {
    const actualHash = sha256File(filePath);
    if (!actualHash || actualHash !== expectedHash) {
      diagnostics.push({
        source: filePath,
        message: `Extension "${extensionName}" blocked by trust policy: integrity hash mismatch.`,
      });
      return false;
    }
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
    const parsed = readSafeJsonFile(filePath, diagnostics, 'policy overrides file');
    if (!parsed || typeof parsed !== 'object') {
      continue;
    }

    if (
      parsed.toolHooks &&
      typeof parsed.toolHooks === 'object' &&
      !Array.isArray(parsed.toolHooks)
    ) {
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
  }

  return overrides;
}
