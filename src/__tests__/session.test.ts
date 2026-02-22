import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  sanitizeSessionId,
  SessionStore,
  cleanupSessions,
  getSessionStorageStats,
} from '../session.js';

describe('sanitizeSessionId', () => {
  it('returns default for empty input', () => {
    expect(sanitizeSessionId('')).toBe('default');
  });

  it('removes path separators and traversal sequences', () => {
    const sanitized = sanitizeSessionId('../ops/../prod');
    expect(sanitized).not.toContain('..');
    expect(sanitized).not.toContain('/');
    expect(sanitized).not.toContain('\\');
    expect(sanitized.startsWith('.')).toBe(false);
    expect(sanitized.length).toBeGreaterThan(0);
  });

  it('preserves safe characters', () => {
    expect(sanitizeSessionId('ops-1.2_default')).toBe('ops-1.2_default');
  });
});

describe('SessionStore.getStorageBytes', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-bytes-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns total bytes of files in the session directory', () => {
    const sessionDir = path.join(tmpDir, 'test-session');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'context.jsonl'), 'a'.repeat(100), 'utf-8');
    fs.writeFileSync(path.join(sessionDir, 'log.jsonl'), 'b'.repeat(50), 'utf-8');

    const store = Object.create(SessionStore.prototype) as SessionStore;
    (store as unknown as { sessionDir: string }).sessionDir = sessionDir;

    expect(store.getStorageBytes()).toBe(150);
  });
});

describe('cleanupSessions', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-cleanup-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createSession(name: string, opts: { messages?: number; ageDays?: number } = {}) {
    const sessDir = path.join(tmpDir, name);
    fs.mkdirSync(sessDir, { recursive: true });
    const contextPath = path.join(sessDir, 'context.jsonl');
    const msgCount = opts.messages ?? 0;
    if (msgCount > 0) {
      const lines = Array.from({ length: msgCount }, (_, i) =>
        JSON.stringify({ role: 'user', content: `msg-${i}`, ts: new Date().toISOString() }),
      );
      fs.writeFileSync(contextPath, lines.join('\n') + '\n', 'utf-8');
    } else {
      fs.writeFileSync(contextPath, '', 'utf-8');
    }
    if (opts.ageDays) {
      const past = new Date(Date.now() - opts.ageDays * 24 * 60 * 60 * 1000);
      fs.utimesSync(sessDir, past, past);
      fs.utimesSync(contextPath, past, past);
    }
  }

  it('removes empty sessions older than maxAgeDays', () => {
    createSession('old-empty', { messages: 0, ageDays: 60 });
    createSession('new-empty', { messages: 0, ageDays: 5 });
    createSession('old-active', { messages: 3, ageDays: 60 });

    const result = cleanupSessions({ maxAgeDays: 30 }, tmpDir);
    expect(result.removed).toEqual(['old-empty']);
    expect(result.errors).toHaveLength(0);
    expect(fs.existsSync(path.join(tmpDir, 'old-empty'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'new-empty'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'old-active'))).toBe(true);
  });

  it('dry-run does not delete sessions', () => {
    createSession('old-empty', { messages: 0, ageDays: 60 });

    const result = cleanupSessions({ maxAgeDays: 30, dryRun: true }, tmpDir);
    expect(result.removed).toEqual(['old-empty']);
    expect(fs.existsSync(path.join(tmpDir, 'old-empty'))).toBe(true);
  });

  it('returns empty result when no sessions match', () => {
    createSession('active', { messages: 5, ageDays: 60 });
    const result = cleanupSessions({ maxAgeDays: 30 }, tmpDir);
    expect(result.removed).toHaveLength(0);
  });
});

describe('getSessionStorageStats', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-stats-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('counts sessions, empty sessions, and total bytes', () => {
    const sessDir1 = path.join(tmpDir, 'sess-1');
    const sessDir2 = path.join(tmpDir, 'sess-2');
    fs.mkdirSync(sessDir1, { recursive: true });
    fs.mkdirSync(sessDir2, { recursive: true });
    fs.writeFileSync(
      path.join(sessDir1, 'context.jsonl'),
      JSON.stringify({ role: 'user', content: 'hi' }) + '\n',
      'utf-8',
    );
    fs.writeFileSync(path.join(sessDir2, 'context.jsonl'), '', 'utf-8');

    const stats = getSessionStorageStats(tmpDir);
    expect(stats.totalSessions).toBe(2);
    expect(stats.emptySessions).toBe(1);
    expect(stats.totalBytes).toBeGreaterThan(0);
    expect(stats.oldestMs).not.toBeNull();
    expect(stats.newestMs).not.toBeNull();
  });

  it('counts archived sessions', () => {
    const sessDir = path.join(tmpDir, 'archived-sess');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'context.jsonl'), '', 'utf-8');
    fs.writeFileSync(path.join(sessDir, 'meta.json'), JSON.stringify({ archived: true }), 'utf-8');

    const stats = getSessionStorageStats(tmpDir);
    expect(stats.archivedCount).toBe(1);
  });

  it('returns zero stats when sessions dir is empty', () => {
    const stats = getSessionStorageStats(tmpDir);
    expect(stats.totalSessions).toBe(0);
    expect(stats.totalBytes).toBe(0);
    expect(stats.oldestMs).toBeNull();
    expect(stats.newestMs).toBeNull();
  });
});
