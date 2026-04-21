import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSessionsDir, mockGetStateSetDir } = vi.hoisted(() => ({
  mockGetSessionsDir: vi.fn(),
  mockGetStateSetDir: vi.fn(),
}));

vi.mock('../session.js', () => ({
  getSessionsDir: mockGetSessionsDir,
  getStateSetDir: mockGetStateSetDir,
}));

function createLogger() {
  return {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    output: vi.fn(),
    done: vi.fn(),
  };
}

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-logs-shortcut-'));
  tempDirs.push(dir);
  return dir;
}

describe('runLogsCommand', () => {
  let runLogsCommand: typeof import('../cli/shortcuts/logs.js').runLogsCommand;

  beforeEach(async () => {
    vi.resetModules();
    mockGetSessionsDir.mockReset();
    mockGetStateSetDir.mockReset();
    const mod = await import('../cli/shortcuts/logs.js');
    runLogsCommand = mod.runLogsCommand;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('renders activity from regular session log files', async () => {
    const dir = createTempDir();
    const sessionsDir = path.join(dir, 'sessions');
    const stateDir = path.join(dir, 'state');
    const sessionDir = path.join(sessionsDir, 'abc');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir, 'log.jsonl'),
      `${JSON.stringify({ ts: '2025-01-01T00:00:00Z', role: 'user', text: 'hello' })}\n`,
      'utf-8',
    );
    mockGetSessionsDir.mockReturnValue(sessionsDir);
    mockGetStateSetDir.mockReturnValue(stateDir);
    const logger = createLogger();

    await runLogsCommand([], logger, { limit: '10' });

    expect(logger.output).toHaveBeenCalledWith(expect.stringContaining('session-log user: hello'));
  });

  it('ignores symlinked log files instead of reading them', async () => {
    const dir = createTempDir();
    const sessionsDir = path.join(dir, 'sessions');
    const stateDir = path.join(dir, 'state');
    const sessionDir = path.join(sessionsDir, 'abc');
    const realLogPath = path.join(dir, 'real-log.jsonl');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      realLogPath,
      `${JSON.stringify({ ts: '2025-01-01T00:00:00Z', role: 'user', text: 'hello' })}\n`,
      'utf-8',
    );
    fs.symlinkSync(realLogPath, path.join(sessionDir, 'log.jsonl'));
    mockGetSessionsDir.mockReturnValue(sessionsDir);
    mockGetStateSetDir.mockReturnValue(stateDir);
    const logger = createLogger();

    await runLogsCommand([], logger, { limit: '10' });

    expect(logger.output).not.toHaveBeenCalled();
    expect(logger.warning).toHaveBeenCalledWith('No matching activity found.');
  });
});
