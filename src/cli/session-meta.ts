import fs from 'node:fs';
import path from 'node:path';
import {
  sanitizeSessionId,
  getSessionsDir,
  getSessionDir,
  getStateSetDir,
  type StoredMessage,
} from '../session.js';
import { getSessionExportPath, resolveExportFilePath } from '../utils/session-exports.js';
import { writePrivateTextFile } from './utils.js';
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
  const data = JSON.stringify(meta, null, 2);
  writePrivateTextFile(metaPath, data, { label: 'Session metadata path', atomic: true });
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function exportSessionToHtml(sessionId: string, entries: SessionExportEntry[]): string {
  const now = new Date().toISOString();
  const messageCount = entries.length;
  const userCount = entries.filter((e) => e.role === 'user').length;
  const assistantCount = entries.filter((e) => e.role === 'assistant').length;

  const messages = entries
    .map((entry) => {
      const role = entry.role === 'assistant' ? 'Assistant' : 'User';
      const roleClass = entry.role === 'assistant' ? 'assistant' : 'user';
      const ts = entry.ts ? `<span class="ts">${escapeHtml(entry.ts)}</span>` : '';
      const body = escapeHtml(formatContentForExport(entry.content) || '(empty)');
      return `<div class="message ${roleClass}"><div class="role">${role} ${ts}</div><div class="body"><pre>${body}</pre></div></div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Session: ${escapeHtml(sessionId)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; max-width: 900px; margin: 0 auto; padding: 24px; }
  h1 { color: #58a6ff; font-size: 1.5rem; margin-bottom: 8px; }
  .meta { color: #8b949e; font-size: 0.85rem; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #21262d; }
  .message { margin-bottom: 16px; border-radius: 8px; padding: 12px 16px; }
  .message.user { background: #161b22; border-left: 3px solid #58a6ff; }
  .message.assistant { background: #161b22; border-left: 3px solid #3fb950; }
  .role { font-weight: 600; font-size: 0.85rem; margin-bottom: 6px; }
  .user .role { color: #58a6ff; }
  .assistant .role { color: #3fb950; }
  .ts { font-weight: 400; color: #8b949e; margin-left: 8px; }
  .body pre { white-space: pre-wrap; word-wrap: break-word; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.9rem; line-height: 1.5; color: #c9d1d9; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #21262d; color: #8b949e; font-size: 0.8rem; text-align: center; }
</style>
</head>
<body>
<h1>Session: ${escapeHtml(sessionId)}</h1>
<div class="meta">Generated: ${escapeHtml(now)} &middot; ${messageCount} messages (${userCount} user, ${assistantCount} assistant)</div>
${messages}
<div class="footer">Exported from StateSet Response CLI</div>
</body>
</html>`;
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
