import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { readJsonFile, readTextFile, MAX_TEXT_FILE_SIZE_BYTES } from './utils/file-read.js';
import { getErrorMessage } from './lib/errors.js';

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

const MAX_SESSION_ID_LENGTH = 200;

/** Strips unsafe characters and prevents directory traversal. Falls back to "default" if empty. */
export function sanitizeSessionId(input: string): string {
  const trimmed = input.trim() || 'default';
  const sanitized = trimmed.replace(/[^a-zA-Z0-9._-]/g, '_');
  const withoutTraversal = sanitized.replace(/\.\.+/g, '_').replace(/^\.+/, '');
  const bounded = withoutTraversal.slice(0, MAX_SESSION_ID_LENGTH);
  return bounded.length > 0 ? bounded : 'default';
}

export function getSessionDir(sessionId: string): string {
  return path.join(getSessionsDir(), sanitizeSessionId(sessionId));
}

const MAX_SESSION_CONTEXT_FILE_SIZE_BYTES = MAX_TEXT_FILE_SIZE_BYTES;
const MAX_SESSION_METADATA_FILE_SIZE_BYTES = MAX_TEXT_FILE_SIZE_BYTES;
const seenSessionWarnings = new Set<string>();

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return;
  }
  const stats = fs.lstatSync(dir);
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to use session directory symlink: ${dir}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Session directory path is not a directory: ${dir}`);
  }
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Best-effort on non-POSIX systems.
  }
}

function enforcePrivateFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.chmodSync(filePath, 0o600);
    }
  } catch {
    // Best-effort on non-POSIX systems.
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

const MAX_SESSION_WARNINGS = 500;

function warnSessionIssue(action: string, targetPath: string, error: unknown): void {
  const message = getErrorMessage(error);
  const warningKey = `${action}:${targetPath}:${message}`;
  if (seenSessionWarnings.has(warningKey)) return;
  if (seenSessionWarnings.size >= MAX_SESSION_WARNINGS) {
    seenSessionWarnings.clear();
  }
  seenSessionWarnings.add(warningKey);
  console.warn(`[stateset] ${action} failed for ${targetPath}: ${message}`);
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
      fs.appendFileSync(this.contextPath, JSON.stringify(entry) + '\n', {
        encoding: 'utf-8',
        mode: 0o600,
      });
      enforcePrivateFile(this.contextPath);
    } catch (error) {
      // Non-fatal: session persistence failure shouldn't crash the CLI
      warnSessionIssue('Append session message', this.contextPath, error);
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
      fs.appendFileSync(this.contextPath, lines.join('\n') + '\n', {
        encoding: 'utf-8',
        mode: 0o600,
      });
      enforcePrivateFile(this.contextPath);
    } catch (error) {
      // Non-fatal: session persistence failure shouldn't crash the CLI
      warnSessionIssue('Append session messages', this.contextPath, error);
    }
  }

  appendLog(entry: LogEntry): void {
    const payload = {
      ts: entry.ts,
      role: entry.role,
      text: entry.text,
    };
    try {
      fs.appendFileSync(this.logPath, JSON.stringify(payload) + '\n', {
        encoding: 'utf-8',
        mode: 0o600,
      });
      enforcePrivateFile(this.logPath);
    } catch (error) {
      // Non-fatal: log persistence failure shouldn't crash the CLI
      warnSessionIssue('Append session log', this.logPath, error);
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
    // Atomic clear: write empty file to a temp path then rename, preventing
    // partial writes from corrupting the file if the process is interrupted.
    for (const filePath of [this.contextPath, this.logPath]) {
      if (fs.existsSync(filePath)) {
        const tmpPath = filePath + `.tmp-${crypto.randomBytes(4).toString('hex')}`;
        try {
          fs.writeFileSync(tmpPath, '', { encoding: 'utf-8', mode: 0o600 });
          fs.renameSync(tmpPath, filePath);
        } catch {
          // Clean up temp file on failure, fall back to direct write
          try {
            fs.unlinkSync(tmpPath);
          } catch {
            /* best effort */
          }
          fs.writeFileSync(filePath, '', { encoding: 'utf-8', mode: 0o600 });
        }
        enforcePrivateFile(filePath);
      }
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
        } catch (error) {
          // skip unreadable files
          warnSessionIssue('Read session file metadata', full, error);
        }
      } else if (entry.isDirectory()) {
        total += getDirSize(full);
      }
    }
  } catch (error) {
    // skip unreadable dirs
    warnSessionIssue('Read session directory', dirPath, error);
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
  } catch (error) {
    result.errors.push(`sessions: ${getErrorMessage(error)}`);
    warnSessionIssue('List sessions directory', dir, error);
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
      } catch (error) {
        // treat as empty
        result.errors.push(`${entry.name}: unable to read context (${getErrorMessage(error)})`);
        warnSessionIssue('Read session context', contextPath, error);
      }
    }
    if (messageCount > 0) continue;

    // Check age using the directory's mtime
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(sessionDir).mtimeMs;
    } catch (error) {
      result.errors.push(`${entry.name}: unable to read metadata (${getErrorMessage(error)})`);
      warnSessionIssue('Read session metadata', sessionDir, error);
      continue;
    }
    if (mtimeMs > cutoffMs) continue;

    const dirBytes = getDirSize(sessionDir);

    if (!dryRun) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      } catch (err) {
        result.errors.push(`${entry.name}: ${getErrorMessage(err)}`);
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
  } catch (error) {
    warnSessionIssue('List sessions directory', dir, error);
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
      } catch (error) {
        // treat as empty
        warnSessionIssue('Read session context', contextPath, error);
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
    } catch (error) {
      // skip
      warnSessionIssue('Read session metadata', sessionDir, error);
    }
  }

  return stats;
}
