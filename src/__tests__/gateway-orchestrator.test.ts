import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  validateRuntimeConfig: vi.fn(() => ({
    orgId: 'test-org',
    orgConfig: {},
    anthropicApiKey: 'key',
  })),
  getConfiguredModel: vi.fn(() => 'claude-sonnet-4-6'),
  resolveModelOrThrow: vi.fn((input: string) => {
    if (input === 'bad-model') {
      throw new Error('Unknown model "bad-model". Valid: sonnet, haiku, opus');
    }
    return input;
  }),
}));

import { Orchestrator } from '../gateway/orchestrator.js';
import { validateRuntimeConfig, resolveModelOrThrow } from '../config.js';

interface TestGateway {
  name: string;
  stop: () => Promise<void>;
}

interface StartResult {
  gateway: TestGateway | null;
  skippedReason?: string;
}

const makeGateway = (name: string): TestGateway => ({
  name,
  stop: async () => {
    return;
  },
});

describe('Orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when both channels are disabled', async () => {
    const orchestrator = new Orchestrator({ slackEnabled: false, whatsappEnabled: false });

    await expect(orchestrator.start()).rejects.toThrow(
      'No channels enabled. Remove --no-slack and/or --no-whatsapp to run at least one channel.',
    );
    expect(vi.mocked(validateRuntimeConfig)).not.toHaveBeenCalled();
  });

  it('starts enabled channels in parallel and reports skipped reasons', async () => {
    const orchestrator = new Orchestrator({});
    const slack = makeGateway('Slack');
    const slackStop = vi.spyOn(slack, 'stop');

    vi.spyOn(
      orchestrator as unknown as { startSlack: (_model: unknown) => Promise<StartResult> },
      'startSlack',
    ).mockResolvedValue({ gateway: slack });
    vi.spyOn(
      orchestrator as unknown as { startWhatsApp: (_model: unknown) => Promise<StartResult> },
      'startWhatsApp',
    ).mockResolvedValue({ gateway: null, skippedReason: 'baileys not installed' });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await orchestrator.start();

    expect(logSpy).toHaveBeenCalled();
    expect(logSpy.mock.calls.join('\n')).toContain('[-] WhatsApp (baileys not installed)');

    await orchestrator.stop();
    expect(slackStop).toHaveBeenCalledTimes(1);
  });

  it('fails with explicit startup errors when all enabled channels fail', async () => {
    const orchestrator = new Orchestrator({});
    vi.spyOn(
      orchestrator as unknown as { startSlack: (_model: unknown) => Promise<StartResult> },
      'startSlack',
    ).mockRejectedValue(new Error('slack startup failed'));
    vi.spyOn(
      orchestrator as unknown as { startWhatsApp: (_model: unknown) => Promise<StartResult> },
      'startWhatsApp',
    ).mockRejectedValue(new Error('baileys unavailable'));

    await expect(orchestrator.start()).rejects.toThrow(
      'No channels started. Channel startup failures: Slack: slack startup failed; WhatsApp: baileys unavailable',
    );
  });

  it('resolves configured model using strict validation', async () => {
    const orchestrator = new Orchestrator({ model: 'claude-sonnet-4-6' });
    vi.spyOn(
      orchestrator as unknown as { startSlack: (_model: unknown) => Promise<StartResult> },
      'startSlack',
    ).mockResolvedValue({ gateway: makeGateway('Slack') });
    vi.spyOn(
      orchestrator as unknown as { startWhatsApp: (_model: unknown) => Promise<StartResult> },
      'startWhatsApp',
    ).mockResolvedValue({ gateway: makeGateway('WhatsApp') });

    await orchestrator.start();

    expect(resolveModelOrThrow).toHaveBeenCalledWith('claude-sonnet-4-6', 'valid');
    await orchestrator.stop();
  });

  it('throws when an explicit invalid model string is given', async () => {
    const orchestrator = new Orchestrator({ model: 'bad-model' });

    await expect(orchestrator.start()).rejects.toThrow(
      'Unknown model "bad-model". Valid: sonnet, haiku, opus',
    );
  });

  it('reports Slack dependency skip reason as skipped channel', async () => {
    const orchestrator = new Orchestrator({});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.spyOn(
      orchestrator as unknown as { startSlack: (_model: unknown) => Promise<StartResult> },
      'startSlack',
    ).mockResolvedValue({ gateway: null, skippedReason: 'slack/bolt not installed' });

    vi.spyOn(
      orchestrator as unknown as { startWhatsApp: (_model: unknown) => Promise<StartResult> },
      'startWhatsApp',
    ).mockResolvedValue({ gateway: makeGateway('WhatsApp') });

    await orchestrator.start();

    expect(logSpy.mock.calls.join('\n')).toContain('[-] Slack (slack/bolt not installed)');
  });

  it('maps Slack startup dependency error to skipped channel', async () => {
    const orchestrator = new Orchestrator({ whatsappEnabled: false });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.spyOn(
      orchestrator as unknown as { startSlack: (_model: unknown) => Promise<StartResult> },
      'startSlack',
    ).mockRejectedValue(
      new Error('@slack/bolt is not installed. Install it with: npm install @slack/bolt'),
    );

    await orchestrator.start();

    expect(logSpy.mock.calls.join('\n')).toContain('[-] Slack (slack/bolt not installed)');
  });

  it('maps WhatsApp startup dependency error to skipped channel', async () => {
    const orchestrator = new Orchestrator({ slackEnabled: false });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.spyOn(
      orchestrator as unknown as { startWhatsApp: (_model: unknown) => Promise<StartResult> },
      'startWhatsApp',
    ).mockRejectedValue(
      new Error('WhatsApp gateway requires @whiskeysockets/baileys. Install it with: npm install'),
    );

    await orchestrator.start();

    expect(logSpy.mock.calls.join('\n')).toContain('[-] WhatsApp (baileys not installed)');
  });
});
