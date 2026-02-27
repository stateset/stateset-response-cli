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

vi.mock('../whatsapp/session.js', () => ({
  createWhatsAppSocket: vi.fn(),
  waitForConnection: vi.fn(),
  extractText: vi.fn(),
  jidToPhone: vi.fn((jid: string) => jid.split('@')[0]),
  isGroup: vi.fn((jid: string) => jid.endsWith('@g.us')),
  getStatusCode: vi.fn(() => 0),
  getDisconnectReason: vi.fn(async () => ({ loggedOut: 401 })),
}));

import { WhatsAppGateway } from '../whatsapp/gateway.js';
import { createWhatsAppSocket, waitForConnection } from '../whatsapp/session.js';

const createSocketMock = vi.mocked(createWhatsAppSocket);
const waitForConnectionMock = vi.mocked(waitForConnection);

describe('WhatsAppGateway connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invokes reconnect scheduling only after clearing connecting state', async () => {
    const gateway = new WhatsAppGateway({});
    (gateway as unknown as { running: boolean }).running = true;

    createSocketMock.mockResolvedValue({
      ev: { on: vi.fn() },
      ws: { readyState: 0 },
      user: null,
      end: vi.fn(),
    } as never);
    waitForConnectionMock.mockRejectedValueOnce(new Error('connect failed'));

    const scheduleSpy = vi
      .spyOn(gateway as unknown as { scheduleReconnect: () => Promise<void> }, 'scheduleReconnect')
      .mockImplementation(async function (this: { connecting: boolean }) {
        expect(this.connecting).toBe(false);
      });

    await (gateway as unknown as { connect: () => Promise<void> }).connect();

    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    expect((gateway as unknown as { connecting: boolean }).connecting).toBe(false);
  });
});
