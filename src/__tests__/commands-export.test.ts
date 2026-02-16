import { describe, it, expect } from 'vitest';
import { handleExportCommand } from '../cli/commands-export.js';
import type { ChatContext } from '../cli/types.js';

function createMockCtx(overrides: Partial<ChatContext> = {}): ChatContext {
  return {
    rl: { prompt: () => {} } as any,
    sessionId: 'test-session',
    cwd: '/tmp/test',
    ...overrides,
  } as unknown as ChatContext;
}

describe('handleExportCommand', () => {
  it('returns false for non-export commands', async () => {
    const ctx = createMockCtx();
    expect(await handleExportCommand('/help', ctx)).toEqual(false);
    expect(await handleExportCommand('/audit', ctx)).toEqual(false);
  });

  it('returns false for prefix collisions', async () => {
    const ctx = createMockCtx();
    expect(await handleExportCommand('/exportx', ctx)).toEqual(false);
    expect(await handleExportCommand('/export-listx', ctx)).toEqual(false);
    expect(await handleExportCommand('/export-showx', ctx)).toEqual(false);
  });
});
