import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {
  sanitizeSessionId,
  getSessionsDir,
  getSessionDir,
  getStateSetDir,
  type StoredMessage,
} from '../session.js';
import { getSessionExportPath, resolveExportFilePath } from '../utils/session-exports.js';
import { ensureDirExists } from './utils.js';
import { readToolAudit } from './audit.js';
import { readJsonFile, readTextFile, MAX_TEXT_FILE_SIZE_BYTES } from '../utils/file-read.js';
import type { SessionMeta, SessionSummary, SessionExportEntry } from './types.js';

const MAX_SESSION_CONTEXT_FILE_SIZE_BYTES = MAX_TEXT_FILE_SIZE_BYTES;

function readSafeSessionLines(filePath: string): string[] {
  try {
    const content = readTextFile(filePath, {
      label: `session context`,
      maxBytes: MAX_SESSION_CONTEXT_FILE_SIZE_BYTES,
    });
    return content.split(/\n/).filter(Boolean);
  } catch {
    return [];
  }
}

export function readSessionMeta(sessionDir: string): SessionMeta {
  const metaPath = path.join(sessionDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return {};
  try {
    const parsed = readJsonFile(metaPath, {
      label: 'session metadata',
      expectObject: true,
    }) as SessionMeta;
    return parsed || {};
  } catch {
    return {};
  }
}

export function writeSessionMeta(sessionDir: string, meta: SessionMeta): void {
  const metaPath = path.join(sessionDir, 'meta.json');
  ensureDirExists(metaPath);
  const data = JSON.stringify(meta, null, 2);
  const tmpPath = metaPath + `.tmp-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(tmpPath, data, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmpPath, metaPath);
  } catch {
    // Clean up temp file on failure, fall back to direct write
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* best effort */
    }
    fs.writeFileSync(metaPath, data, 'utf-8');
  }
}

export function listSessionSummaries(options?: { includeArchived?: boolean }): SessionSummary[] {
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
      messageCount = readSafeSessionLines(contextPath).length;
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

export function readSessionEntries(sessionId: string): SessionExportEntry[] {
  const sanitized = sanitizeSessionId(sessionId);
  const contextPath = path.join(getSessionsDir(), sanitized, 'context.jsonl');
  if (!fs.existsSync(contextPath)) return [];
  const lines = readSafeSessionLines(contextPath);
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

interface TextBlock {
  type: 'text';
  text: string;
}

interface ToolUseBlock {
  type: 'tool_use';
  name?: string;
  input?: unknown;
}

interface ToolResultBlock {
  type: 'tool_result';
  content?: string | Array<{ type?: string; text?: string }>;
}

interface TypedBlock {
  type: string;
}

function isTextBlock(part: object): part is TextBlock {
  return 'type' in part && (part as TypedBlock).type === 'text' && 'text' in part;
}

function isToolUseBlock(part: object): part is ToolUseBlock {
  return 'type' in part && (part as TypedBlock).type === 'tool_use';
}

function isToolResultBlock(part: object): part is ToolResultBlock {
  return 'type' in part && (part as TypedBlock).type === 'tool_result';
}

export function formatContentForExport(content: StoredMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');

  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') {
      parts.push(String(part));
      continue;
    }

    if (isTextBlock(part)) {
      parts.push(String(part.text ?? ''));
      continue;
    }

    if (isToolUseBlock(part)) {
      const name = part.name ? String(part.name) : 'unknown';
      const input = part.input ? JSON.stringify(part.input, null, 2) : '';
      parts.push(`[tool_use] ${name}${input ? `\n${input}` : ''}`);
      continue;
    }

    if (isToolResultBlock(part)) {
      const toolContent = part.content;
      if (Array.isArray(toolContent)) {
        const rendered = toolContent
          .map((c) => {
            if (c?.type === 'text') return c.text ?? '';
            return JSON.stringify(c);
          })
          .join('\n');
        parts.push(`[tool_result]\n${rendered}`);
      } else {
        parts.push(
          `[tool_result] ${typeof toolContent === 'string' ? toolContent : JSON.stringify(toolContent)}`,
        );
      }
      continue;
    }

    if ('type' in part) {
      parts.push(`[${String((part as TypedBlock).type)}]`);
      continue;
    }

    parts.push(JSON.stringify(part));
  }

  return parts.join('\n\n').trim();
}

export function exportSessionToMarkdown(sessionId: string, entries: SessionExportEntry[]): string {
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

export function listExportFiles(
  sessionId: string,
): Array<{ name: string; path: string; updatedAtMs: number; size: number }> {
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
    .filter((entry): entry is { name: string; path: string; updatedAtMs: number; size: number } =>
      Boolean(entry),
    );
  return files.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

export function deleteExportFile(sessionId: string, filename: string): boolean {
  const filePath = resolveExportFilePath(sessionId, filename);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

export function getSessionMetaSummary(sessionId: string): {
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
