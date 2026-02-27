import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  getConfiguredModel: vi.fn(() => 'claude-sonnet-4-6'),
  resolveModelOrThrow: vi.fn((value: string) => value),
  formatUnknownModelError: vi.fn((value: string) => `Unknown model "${value}"`),
  validateRuntimeConfig: vi.fn(() => ({
    orgId: 'org-1',
    orgConfig: {
      name: 'Org',
      graphqlEndpoint: 'https://api.example.com/graphql',
      adminSecret: 'secret',
    },
    anthropicApiKey: 'sk-ant-test',
  })),
}));

class MockAgent {
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async chat(): Promise<string> {
    return 'ok';
  }
  clearHistory(): void {}
  getModel(): string {
    return 'claude-sonnet-4-6';
  }
  getHistoryLength(): number {
    return 0;
  }
  setModel(): void {}
}

vi.mock('../agent.js', () => ({
  StateSetAgent: vi.fn(() => new MockAgent()),
}));

import { SlackGateway } from '../slack/gateway.js';

describe('SlackGateway channel gating', () => {
  let gateway: SlackGateway;
  let postMessageMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = new SlackGateway({});
    postMessageMock = vi.fn().mockResolvedValue({});
    (gateway as unknown as { anthropicApiKey: string }).anthropicApiKey = 'sk-ant-test';
    (gateway as unknown as { botToken: string }).botToken = 'xoxb-test';
    (gateway as unknown as { app: unknown }).app = {
      client: {
        chat: {
          postMessage: postMessageMock,
        },
      },
    };
  });

  it('ignores channel messages when bot user ID is unavailable and thread is not tracked', async () => {
    (gateway as unknown as { botUserId: string | null }).botUserId = null;

    await (gateway as unknown as { onMessage: (event: unknown) => Promise<void> }).onMessage({
      text: 'hello',
      user: 'U1',
      channel: 'C1',
      channel_type: 'channel',
      ts: '100',
    });

    expect((gateway as unknown as { sessions: Map<string, unknown> }).sessions.size).toBe(0);
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it('allows mentions and then accepts replies only in tracked threads', async () => {
    (gateway as unknown as { botUserId: string | null }).botUserId = 'B1';

    await (gateway as unknown as { onMessage: (event: unknown) => Promise<void> }).onMessage({
      text: '<@B1> hello',
      user: 'U1',
      channel: 'C1',
      channel_type: 'channel',
      ts: '100',
    });

    expect((gateway as unknown as { sessions: Map<string, unknown> }).sessions.size).toBe(1);
    expect(
      (
        gateway as unknown as { activeChannelThreads: Map<string, number> }
      ).activeChannelThreads.has('C1:100'),
    ).toBe(true);
    expect(postMessageMock).toHaveBeenCalledTimes(1);

    (gateway as unknown as { botUserId: string | null }).botUserId = null;

    await (gateway as unknown as { onMessage: (event: unknown) => Promise<void> }).onMessage({
      text: 'follow-up in tracked thread',
      user: 'U1',
      channel: 'C1',
      channel_type: 'channel',
      thread_ts: '100',
      ts: '101',
    });

    expect(postMessageMock).toHaveBeenCalledTimes(2);

    await (gateway as unknown as { onMessage: (event: unknown) => Promise<void> }).onMessage({
      text: 'should be ignored',
      user: 'U2',
      channel: 'C1',
      channel_type: 'channel',
      thread_ts: '999',
      ts: '102',
    });

    expect((gateway as unknown as { sessions: Map<string, unknown> }).sessions.size).toBe(1);
    expect(postMessageMock).toHaveBeenCalledTimes(2);
  });
});
