import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type Anthropic from '@anthropic-ai/sdk';

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

export function getStateSetDir(): string {
  return path.join(os.homedir(), '.stateset');
}

export function getSessionsDir(): string {
  return path.join(getStateSetDir(), 'sessions');
}

export function sanitizeSessionId(input: string): string {
  const trimmed = input.trim() || 'default';
  const sanitized = trimmed.replace(/[^a-zA-Z0-9._-]/g, '_');
  const withoutTraversal = sanitized.replace(/\.\.+/g, '_').replace(/^\.+/, '');
  return withoutTraversal.length > 0 ? withoutTraversal : 'default';
}

export function getSessionDir(sessionId: string): string {
  return path.join(getSessionsDir(), sanitizeSessionId(sessionId));
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

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
    const content = fs.readFileSync(this.contextPath, 'utf-8');
    const lines = content.split(/\n/).filter(Boolean);
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
    fs.appendFileSync(this.contextPath, JSON.stringify(entry) + '\n', 'utf-8');
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
    fs.appendFileSync(this.contextPath, lines.join('\n') + '\n', 'utf-8');
  }

  appendLog(entry: LogEntry): void {
    const payload = {
      ts: entry.ts,
      role: entry.role,
      text: entry.text,
    };
    fs.appendFileSync(this.logPath, JSON.stringify(payload) + '\n', 'utf-8');
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
