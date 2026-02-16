import fs from 'node:fs';
import path from 'node:path';
import { formatError } from '../utils/display.js';
import type { InlineFlags } from './types.js';

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
