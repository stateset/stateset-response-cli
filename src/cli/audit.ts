import fs from 'node:fs';
import path from 'node:path';
import { sanitizeSessionId, getSessionsDir, getStateSetDir } from '../session.js';
import { ensureDirExists } from './utils.js';
import type { ToolAuditEntry, PromptHistoryEntry } from './types.js';

export const REDACT_KEY_RE =
  /(secret|token|authorization|api[-_]?key|password|admin|email|phone|address|customer_email|customer_phone|customer_name|first_name|last_name)/i;

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
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
}

export function readToolAudit(sessionId: string): ToolAuditEntry[] {
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

export function getPromptHistoryPath(): string {
  return path.join(getStateSetDir(), 'prompt-history.jsonl');
}

export function appendPromptHistory(entry: PromptHistoryEntry): void {
  const filePath = getPromptHistoryPath();
  ensureDirExists(filePath);
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
}

export function readPromptHistory(limit = 20): PromptHistoryEntry[] {
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
