import fs from 'node:fs';
import path from 'node:path';
import { formatError } from '../utils/display.js';
import type { InlineFlags } from './types.js';
import { getStateSetDir } from '../session.js';

export interface SafeOutputPathOptions {
  allowedRoots?: string[];
  allowOutside?: boolean;
  label?: string;
}

function safeRealpath(value: string): string | null {
  try {
    return fs.realpathSync(value);
  } catch {
    return null;
  }
}

function isPathWithin(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function getExistingAnchorPath(candidate: string): string | null {
  let candidatePath = path.resolve(candidate);
  while (true) {
    const parent = path.dirname(candidatePath);
    if (parent === candidatePath) return candidatePath;

    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
    candidatePath = parent;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeInstanceUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function assertNodeVersion(): void {
  const raw = process.versions.node || '0.0.0';
  const major = Number.parseInt(raw.split('.')[0] || '0', 10);
  if (!Number.isFinite(major) || major < 18) {
    console.error(formatError(`Node.js 18+ is required. Detected ${raw}.`));
    process.exit(1);
  }
}

export function parseToggleValue(value: string | undefined | null): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (['on', 'true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['off', 'false', '0', 'no', 'n'].includes(normalized)) return false;
  return undefined;
}

export function extractInlineFlags(input: string): { text: string; flags: InlineFlags } {
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

export function readBooleanEnv(name: string): boolean {
  return parseToggleValue(process.env[name]) ?? false;
}

export function readFirstEnvValue(names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function ensureDirExists(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function resolveSafeOutputPath(
  outputPath: string,
  options: SafeOutputPathOptions = {},
): string {
  const trimmed = outputPath.trim();
  if (!trimmed) {
    throw new Error('Output path is required.');
  }

  const resolved = path.resolve(trimmed);
  const canInspectPath = typeof fs.realpathSync === 'function';
  const roots = (options.allowedRoots ?? [process.cwd(), getStateSetDir()]).map((root) =>
    path.resolve(root),
  );
  const normalizedRoots = roots.map((root) => (canInspectPath ? safeRealpath(root) || root : root));

  if (fs.existsSync(resolved)) {
    const stats = fs.lstatSync(resolved);
    if (stats.isDirectory()) {
      throw new Error(`Output path is a directory: ${resolved}`);
    }
    if (stats.isSymbolicLink()) {
      throw new Error(`Output path must not be a symlink: ${resolved}`);
    }
  }

  if (!options.allowOutside) {
    const existingAnchor = getExistingAnchorPath(resolved);
    if (!existingAnchor) {
      throw new Error(
        `${options.label ?? 'Output path'} could not be validated against safe roots: ${resolved}`,
      );
    }

    const anchorReal = canInspectPath ? safeRealpath(existingAnchor) : existingAnchor;
    if (!anchorReal) {
      throw new Error(
        `${options.label ?? 'Output path'} could not be validated against safe roots: ${resolved}`,
      );
    }

    const suffix = path.relative(existingAnchor, resolved);
    const resolvedForContainment = path.resolve(anchorReal, suffix);
    const allowed = normalizedRoots.some((root) => isPathWithin(root, resolvedForContainment));
    const rootsText = normalizedRoots.map((root) => path.resolve(root)).join(', ');
    if (!allowed) {
      throw new Error(
        `${options.label ?? 'Output path'} must be within [${rootsText}] by default. Use --unsafe-path to override.`,
      );
    }
  }

  return resolved;
}

export function hasCommand(input: string, command: string): boolean {
  if (input === command) {
    return true;
  }
  if (!input.startsWith(command)) {
    return false;
  }
  const boundary = input.charAt(command.length);
  return boundary.length > 0 && /\s/.test(boundary);
}

export function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'unknown';
  return new Date(ms).toLocaleString();
}

export function normalizeTag(tag: string): string | null {
  const cleaned = tag.trim().toLowerCase();
  return cleaned ? cleaned : null;
}
