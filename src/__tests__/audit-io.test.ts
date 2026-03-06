import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { mockPaths } = vi.hoisted(() => ({
  mockPaths: {
    sessionsDir: '/tmp/sessions-audit-test',
    stateDir: '/tmp/state-audit-test',
  },
}));

vi.mock('../session.js', () => ({
  sanitizeSessionId: vi.fn((id: string) => id.replace(/[^a-zA-Z0-9._-]/g, '_')),
  getSessionsDir: vi.fn(() => mockPaths.sessionsDir),
  getStateSetDir: vi.fn(() => mockPaths.stateDir),
}));

import {
  appendToolAudit,
  readToolAudit,
  appendPromptHistory,
  readPromptHistory,
  appendIntegrationTelemetry,
  readIntegrationTelemetry,
  getToolAuditPath,
} from '../cli/audit.js';

describe('audit I/O hardening', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-audit-'));
    mockPaths.sessionsDir = path.join(tmpDir, 'sessions');
    mockPaths.stateDir = path.join(tmpDir, 'state');
    fs.mkdirSync(mockPaths.sessionsDir, { recursive: true });
    fs.mkdirSync(mockPaths.stateDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends and reads tool audit entries', () => {
    appendToolAudit('sess-1', {
      ts: '2025-01-01T00:00:00.000Z',
      type: 'tool_call',
      session: 'sess-1',
      name: 'shopify_get_order',
    });

    const entries = readToolAudit('sess-1');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('shopify_get_order');
  });

  it('appends and reads prompt history entries', () => {
    appendPromptHistory({
      ts: '2025-01-01T00:00:00.000Z',
      template: 'followup',
      variables: { tone: 'friendly' },
    });

    const entries = readPromptHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.template).toBe('followup');
  });

  it('appends and reads integration telemetry entries', () => {
    appendIntegrationTelemetry({
      ts: '2025-01-01T00:00:00.000Z',
      type: 'tool_result',
      session: 'sess-1',
      name: 'shopify_get_order',
      isError: false,
    });

    const entries = readIntegrationTelemetry();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('shopify_get_order');
  });

  it.skipIf(process.platform === 'win32')(
    'does not append through a symlinked tool audit file',
    () => {
      const sessionId = 'sess-1';
      const auditPath = getToolAuditPath(sessionId);
      const sessionDir = path.dirname(auditPath);
      fs.mkdirSync(sessionDir, { recursive: true });

      const targetPath = path.join(tmpDir, 'target-audit.jsonl');
      fs.writeFileSync(targetPath, 'seed\n', 'utf-8');
      fs.symlinkSync(targetPath, auditPath);

      appendToolAudit(sessionId, {
        ts: '2025-01-01T00:00:00.000Z',
        type: 'tool_call',
        session: sessionId,
        name: 'shopify_get_order',
      });

      expect(fs.readFileSync(targetPath, 'utf-8')).toBe('seed\n');
    },
  );

  it.skipIf(process.platform === 'win32')(
    'does not append through a symlinked session directory',
    () => {
      const sessionId = 'sess-1';
      const redirectedDir = path.join(tmpDir, 'redirected-session');
      const sessionLink = path.join(mockPaths.sessionsDir, sessionId);
      fs.mkdirSync(redirectedDir, { recursive: true });
      fs.symlinkSync(redirectedDir, sessionLink);

      appendToolAudit(sessionId, {
        ts: '2025-01-01T00:00:00.000Z',
        type: 'tool_call',
        session: sessionId,
        name: 'shopify_get_order',
      });

      expect(fs.existsSync(path.join(redirectedDir, 'tool-audit.jsonl'))).toBe(false);
    },
  );
});
