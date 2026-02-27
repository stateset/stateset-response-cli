import fs from 'node:fs';
import path from 'node:path';
import { sanitizeSessionId, getSessionsDir, getStateSetDir } from '../session.js';
import { ensureDirExists } from './utils.js';
import type { ToolAuditEntry, PromptHistoryEntry } from './types.js';
import { readTextFile, MAX_TEXT_FILE_SIZE_BYTES } from '../utils/file-read.js';

export const REDACT_KEY_RE =
  /(secret|token|authorization|api[-_]?key|password|admin|email|phone|address|customer_email|customer_phone|customer_name|first_name|last_name)/i;

const MAX_AUDIT_LOG_BYTES = MAX_TEXT_FILE_SIZE_BYTES;
const INTEGRATION_TOOL_PREFIXES = [
  'shopify_',
  'gorgias_',
  'recharge_',
  'skio_',
  'stayai_',
  'amazon_',
  'dhl_',
  'globale_',
  'fedex_',
  'klaviyo_',
  'loop_',
  'shipstation_',
  'shiphero_',
  'shipfusion_',
  'shiphawk_',
  'zendesk_',
];

function readSafeJsonl(filePath: string): string[] {
  try {
    const content = readTextFile(filePath, {
      label: `audit log`,
      maxBytes: MAX_AUDIT_LOG_BYTES,
    });
    return content.split(/\n/).filter(Boolean);
  } catch {
    return [];
  }
}

export function sanitizeAuditValue(value: unknown, depth = 0): unknown {
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

export function sanitizeToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  return sanitizeAuditValue(args) as Record<string, unknown>;
}

export function getToolAuditPath(sessionId: string): string {
  return path.join(getSessionsDir(), sanitizeSessionId(sessionId), 'tool-audit.jsonl');
}

export function appendToolAudit(sessionId: string, entry: ToolAuditEntry): void {
  const filePath = getToolAuditPath(sessionId);
  ensureDirExists(filePath);
  try {
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', { encoding: 'utf-8', mode: 0o600 });
  } catch {
    // Non-fatal: audit persistence failure shouldn't crash the CLI
  }
}

export function readToolAudit(sessionId: string): ToolAuditEntry[] {
  const filePath = getToolAuditPath(sessionId);
  if (!fs.existsSync(filePath)) return [];
  const lines = readSafeJsonl(filePath);
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

export function getPromptHistoryPath(): string {
  return path.join(getStateSetDir(), 'prompt-history.jsonl');
}

export function appendPromptHistory(entry: PromptHistoryEntry): void {
  const filePath = getPromptHistoryPath();
  ensureDirExists(filePath);
  try {
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', { encoding: 'utf-8', mode: 0o600 });
  } catch {
    // Non-fatal: prompt history persistence failure shouldn't crash the CLI
  }
}

export function readPromptHistory(limit = 20): PromptHistoryEntry[] {
  const filePath = getPromptHistoryPath();
  if (!fs.existsSync(filePath)) return [];
  const lines = readSafeJsonl(filePath);
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

export function isIntegrationToolName(name: string): boolean {
  const lower = String(name || '').toLowerCase();
  return INTEGRATION_TOOL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export function isRateLimitedResult(text: string): boolean {
  const haystack = String(text || '').toLowerCase();
  return (
    haystack.includes('429') ||
    haystack.includes('rate limit') ||
    haystack.includes('too many requests') ||
    haystack.includes('retry-after')
  );
}

export function getIntegrationTelemetryPath(): string {
  return path.join(getStateSetDir(), 'integration-telemetry.jsonl');
}

export function appendIntegrationTelemetry(entry: ToolAuditEntry): void {
  const filePath = getIntegrationTelemetryPath();
  ensureDirExists(filePath);
  try {
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', { encoding: 'utf-8', mode: 0o600 });
  } catch {
    // Non-fatal: telemetry persistence failure shouldn't crash the CLI
  }
}

export function readIntegrationTelemetry(limit = 5000): ToolAuditEntry[] {
  const filePath = getIntegrationTelemetryPath();
  if (!fs.existsSync(filePath)) return [];
  const lines = readSafeJsonl(filePath);
  const entries: ToolAuditEntry[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as ToolAuditEntry;
      if (!parsed?.type || !parsed?.name) continue;
      if (!isIntegrationToolName(parsed.name)) continue;
      entries.push(parsed);
    } catch {
      // skip malformed lines
    }
  }
  return entries.slice(-Math.max(1, Math.floor(limit)));
}
