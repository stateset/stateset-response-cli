import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type Anthropic from '@anthropic-ai/sdk';
import { readJsonFile, readTextFile, MAX_TEXT_FILE_SIZE_BYTES } from './utils/file-read.js';

export interface CleanupOptions {
  maxAgeDays?: number;
  dryRun?: boolean;
}

export interface CleanupResult {
  removed: string[];
  freedBytes: number;
  errors: string[];
}

export interface SessionStorageStats {
  totalSessions: number;
  totalBytes: number;
  emptySessions: number;
  archivedCount: number;
  oldestMs: number | null;
  newestMs: number | null;
}

export interface LogEntry {
  ts: string;
  role: 'user' | 'assistant';
  text: string;
}

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: Anthropic.MessageParam['content'];
  ts?: string;
}

/** Returns the path to ~/.stateset, the root directory for all CLI state. */
export function getStateSetDir(): string {
  return path.join(os.homedir(), '.stateset');
}

export function getSessionsDir(): string {
  return path.join(getStateSetDir(), 'sessions');
}

/** Strips unsafe characters and prevents directory traversal. Falls back to "default" if empty. */
export function sanitizeSessionId(input: string): string {
  const trimmed = input.trim() || 'default';
  const sanitized = trimmed.replace(/[^a-zA-Z0-9._-]/g, '_');
  const withoutTraversal = sanitized.replace(/\.\.+/g, '_').replace(/^\.+/, '');
  return withoutTraversal.length > 0 ? withoutTraversal : 'default';
}

export function getSessionDir(sessionId: string): string {
  return path.join(getSessionsDir(), sanitizeSessionId(sessionId));
}

const MAX_SESSION_CONTEXT_FILE_SIZE_BYTES = MAX_TEXT_FILE_SIZE_BYTES;
const MAX_SESSION_METADATA_FILE_SIZE_BYTES = MAX_TEXT_FILE_SIZE_BYTES;

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

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

function readSafeMeta(filePath: string): unknown {
  try {
    return readJsonFile(filePath, {
      label: 'session metadata',
      expectObject: true,
      maxBytes: MAX_SESSION_METADATA_FILE_SIZE_BYTES,
    });
  } catch {
    return null;
  }
}

/**
 * Manages per-session conversation history (context.jsonl) and human-readable
 * logs (log.jsonl) under ~/.stateset/sessions/<sessionId>/.
 */
export class SessionStore {
  private sessionId: string;
  private sessionDir: string;
  private contextPath: string;
  private logPath: string;

  constructor(sessionId: string) {
    this.sessionId = sanitizeSessionId(sessionId);
    this.sessionDir = getSessionDir(this.sessionId);
    this.contextPath = path.join(this.sessionDir, 'context.jsonl');
    this.logPath = path.join(this.sessionDir, 'log.jsonl');
    ensureDir(this.sessionDir);
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getSessionDir(): string {
    return this.sessionDir;
  }

  getContextPath(): string {
    return this.contextPath;
  }

  getLogPath(): string {
    return this.logPath;
  }

  loadMessages(): Anthropic.MessageParam[] {
    if (!fs.existsSync(this.contextPath)) return [];
    const lines = readSafeSessionLines(this.contextPath);
    const messages: Anthropic.MessageParam[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as StoredMessage;
        if (!parsed || !parsed.role || parsed.content === undefined) continue;
        if (parsed.role !== 'user' && parsed.role !== 'assistant') continue;
        messages.push({ role: parsed.role, content: parsed.content });
      } catch {
        // skip malformed lines
      }
    }

    return messages;
  }

  appendMessage(message: Anthropic.MessageParam): void {
    const entry: StoredMessage = {
      role: message.role as 'user' | 'assistant',
      content: message.content,
      ts: new Date().toISOString(),
    };
    try {
      fs.appendFileSync(this.contextPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch {
      // Non-fatal: session persistence failure shouldn't crash the CLI
    }
  }

  appendMessages(messages: Anthropic.MessageParam[]): void {
    if (!messages.length) return;
    const lines = messages.map((message) => {
      const entry: StoredMessage = {
        role: message.role as 'user' | 'assistant',
        content: message.content,
        ts: new Date().toISOString(),
      };
      return JSON.stringify(entry);
    });
    try {
      fs.appendFileSync(this.contextPath, lines.join('\n') + '\n', 'utf-8');
    } catch {
      // Non-fatal: session persistence failure shouldn't crash the CLI
    }
  }

  appendLog(entry: LogEntry): void {
    const payload = {
      ts: entry.ts,
      role: entry.role,
      text: entry.text,
    };
    try {
      fs.appendFileSync(this.logPath, JSON.stringify(payload) + '\n', 'utf-8');
    } catch {
      // Non-fatal: log persistence failure shouldn't crash the CLI
    }
  }

  getMessageCount(): number {
    if (!fs.existsSync(this.contextPath)) return 0;
    try {
      return readSafeSessionLines(this.contextPath).length;
    } catch {
      return 0;
    }
  }

  /** Returns the total size in bytes of all files in the session directory. */
  getStorageBytes(): number {
    return getDirSize(this.sessionDir);
  }

  clear(): void {
    if (fs.existsSync(this.contextPath)) {
      fs.writeFileSync(this.contextPath, '', 'utf-8');
    }
    if (fs.existsSync(this.logPath)) {
      fs.writeFileSync(this.logPath, '', 'utf-8');
    }
  }
}

// ---------------------------------------------------------------------------
// Directory size helper
// ---------------------------------------------------------------------------

function getDirSize(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {
          // skip unreadable files
        }
      } else if (entry.isDirectory()) {
        total += getDirSize(full);
      }
    }
  } catch {
    // skip unreadable dirs
  }
  return total;
}

// ---------------------------------------------------------------------------
// Session cleanup & stats
// ---------------------------------------------------------------------------

/**
 * Remove empty sessions older than `maxAgeDays`.
 * A session is "empty" if its context.jsonl has 0 messages.
 */
export function cleanupSessions(options: CleanupOptions = {}, sessionsDir?: string): CleanupResult {
  const { maxAgeDays = 30, dryRun = false } = options;
  const dir = sessionsDir ?? getSessionsDir();
  const result: CleanupResult = { removed: [], freedBytes: 0, errors: [] };

  if (!fs.existsSync(dir)) return result;

  const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sessionDir = path.join(dir, entry.name);
    const contextPath = path.join(sessionDir, 'context.jsonl');

    // Check message count
    let messageCount = 0;
    if (fs.existsSync(contextPath)) {
      try {
        messageCount = readSafeSessionLines(contextPath).length;
      } catch {
        // treat as empty
      }
    }
    if (messageCount > 0) continue;

    // Check age using the directory's mtime
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(sessionDir).mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs > cutoffMs) continue;

    const dirBytes = getDirSize(sessionDir);

    if (!dryRun) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      } catch (err) {
        result.errors.push(`${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
    }

    result.removed.push(entry.name);
    result.freedBytes += dirBytes;
  }

  return result;
}

/** Gather aggregate storage statistics across all sessions. */
export function getSessionStorageStats(sessionsDir?: string): SessionStorageStats {
  const dir = sessionsDir ?? getSessionsDir();
  const stats: SessionStorageStats = {
    totalSessions: 0,
    totalBytes: 0,
    emptySessions: 0,
    archivedCount: 0,
    oldestMs: null,
    newestMs: null,
  };

  if (!fs.existsSync(dir)) return stats;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return stats;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    stats.totalSessions++;
    const sessionDir = path.join(dir, entry.name);

    // Size
    stats.totalBytes += getDirSize(sessionDir);

    // Message count
    const contextPath = path.join(sessionDir, 'context.jsonl');
    let messageCount = 0;
    if (fs.existsSync(contextPath)) {
      try {
        messageCount = readSafeSessionLines(contextPath).length;
      } catch {
        // treat as empty
      }
    }
    if (messageCount === 0) stats.emptySessions++;

    // Archived
    const metaPath = path.join(sessionDir, 'meta.json');
    const meta = readSafeMeta(metaPath) as { archived?: unknown } | null;
    if (meta?.archived) stats.archivedCount++;

    // Timestamps
    try {
      const dirStat = fs.statSync(sessionDir);
      const mtime = dirStat.mtimeMs;
      if (stats.oldestMs === null || mtime < stats.oldestMs) stats.oldestMs = mtime;
      if (stats.newestMs === null || mtime > stats.newestMs) stats.newestMs = mtime;
    } catch {
      // skip
    }
  }

  return stats;
}
