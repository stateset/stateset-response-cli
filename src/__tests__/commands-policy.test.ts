import { describe, it, expect } from 'vitest';
import { handlePolicyCommand } from '../cli/commands-policy.js';
import type { ChatContext } from '../cli/types.js';

function createMockCtx(overrides: Partial<ChatContext> = {}): ChatContext {
  return {
    rl: { prompt: () => {} } as any,
    sessionId: 'test-session',
    cwd: '/tmp/test',
    permissionStore: { toolHooks: {} },
    extensions: {
      load: async () => {},
    } as any,
    ...overrides,
  } as unknown as ChatContext;
}

describe('handlePolicyCommand', () => {
  it('returns false for non-policy commands', async () => {
    const ctx = createMockCtx();
    expect(await handlePolicyCommand('/help', ctx)).toEqual({ handled: false });
    expect(await handlePolicyCommand('/apply on', ctx)).toEqual({ handled: false });
  });

  it('does not match partial policy prefixes', async () => {
    const ctx = createMockCtx();
    expect(await handlePolicyCommand('/permissionsx', ctx)).toEqual({ handled: false });
    expect(await handlePolicyCommand('/policyx', ctx)).toEqual({ handled: false });
  });
});
