import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getStateSetDir } from './session.js';
import { readJsonFile } from './utils/file-read.js';
import { getErrorMessage } from './lib/errors.js';

export interface ExtensionDiagnostic {
  source: string;
  message: string;
}

export interface ExtensionTrustPolicy {
  enforce: boolean;
  requiresAllowlist: boolean;
  allowed: Set<string>;
  denied: Set<string>;
  requireHashes: boolean;
  hashes: Map<string, string>;
}

export const MAX_EXTENSION_FILE_SIZE_BYTES = 1_048_576;

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const EXTENSION_TRUST_FILES = ['extension-trust.json', 'extensions-trust.json'];

export function readSafeJsonFile(
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

export function loadExtensionTrustPolicy(
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
  if (envAllow.size > 0 || envDeny.size > 0) {
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

export function isExtensionTrusted(
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
