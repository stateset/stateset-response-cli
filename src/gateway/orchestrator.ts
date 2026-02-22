/**
 * Multi-Channel Orchestrator for StateSet Response
 *
 * Runs multiple channel gateways (Slack, WhatsApp) simultaneously
 * from a single process with shared config and unified lifecycle.
 */

import {
  resolveModelOrThrow,
  getConfiguredModel,
  getRuntimeContext,
  type ModelId,
} from '../config.js';
import { logger } from '../lib/logger.js';
import { getErrorMessage } from '../lib/errors.js';

export interface OrchestratorOptions {
  model?: string;
  verbose?: boolean;
  // Slack-specific
  slackEnabled?: boolean;
  slackAllowList?: string[];
  // WhatsApp-specific
  whatsappEnabled?: boolean;
  whatsappAllowList?: string[];
  whatsappAllowGroups?: boolean;
  whatsappSelfChatOnly?: boolean;
  whatsappAuthDir?: string;
}

interface ChannelGateway {
  name: string;
  stop: () => Promise<void>;
}

interface ChannelStartResult {
  gateway: ChannelGateway | null;
  skippedReason?: string;
}

interface ChannelPlan {
  name: 'Slack' | 'WhatsApp';
  start: () => Promise<ChannelStartResult>;
}

function isModuleNotFoundError(err: unknown): boolean {
  const message = getErrorMessage(err);
  const errno =
    err && typeof err === 'object' && 'code' in err ? (err as { code?: unknown }).code : undefined;
  return (
    errno === 'ERR_MODULE_NOT_FOUND' ||
    errno === 'MODULE_NOT_FOUND' ||
    message.includes('Cannot find module')
  );
}

function optionalDependencyErrorReason(err: unknown, channel: 'Slack' | 'WhatsApp'): string | null {
  const message = getErrorMessage(err);
  const normalized = message.toLowerCase();
  if (isModuleNotFoundError(err)) {
    return channel === 'Slack' ? 'slack/bolt not installed' : 'baileys not installed';
  }
  if (channel === 'Slack' && message.includes('@slack/bolt is not installed')) {
    return 'slack/bolt not installed';
  }
  if (
    channel === 'WhatsApp' &&
    normalized.includes('whatsapp gateway requires @whiskeysockets/baileys')
  ) {
    return 'baileys not installed';
  }
  return null;
}

export class Orchestrator {
  private gateways: ChannelGateway[] = [];
  private options: OrchestratorOptions;
  private readonly log = logger.child('orchestrator');

  constructor(options: OrchestratorOptions = {}) {
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.options.slackEnabled === false && this.options.whatsappEnabled === false) {
      throw new Error(
        'No channels enabled. Remove --no-slack and/or --no-whatsapp to run at least one channel.',
      );
    }

    const model: ModelId = this.options.model
      ? resolveModelOrThrow(this.options.model, 'valid')
      : getConfiguredModel();

    // Validate shared prerequisites
    getRuntimeContext();

    const results: Array<{ name: string; status: 'ok' | 'skipped' | 'error'; reason?: string }> =
      [];
    const plans: ChannelPlan[] = [];

    // Start Slack gateway
    if (this.options.slackEnabled !== false) {
      plans.push({
        name: 'Slack',
        start: () => this.startSlack(model),
      });
    } else {
      results.push({ name: 'Slack', status: 'skipped', reason: 'disabled' });
    }

    // Start WhatsApp gateway
    if (this.options.whatsappEnabled !== false) {
      plans.push({
        name: 'WhatsApp',
        start: () => this.startWhatsApp(model),
      });
    } else {
      results.push({ name: 'WhatsApp', status: 'skipped', reason: 'disabled' });
    }

    // Start enabled channels in parallel so one channel does not block another
    const startupResults = await Promise.allSettled(plans.map((plan) => plan.start()));
    for (let i = 0; i < plans.length; i += 1) {
      const plan = plans[i];
      const startup = startupResults[i];
      if (startup.status === 'fulfilled') {
        if (!startup.value.gateway) {
          results.push({
            name: plan.name,
            status: 'skipped',
            reason: startup.value.skippedReason ?? 'not available',
          });
          continue;
        }
        this.gateways.push(startup.value.gateway);
        results.push({ name: plan.name, status: 'ok' });
        continue;
      }

      const depReason = optionalDependencyErrorReason(startup.reason, plan.name);
      if (depReason) {
        results.push({ name: plan.name, status: 'skipped', reason: depReason });
        continue;
      }

      const msg = getErrorMessage(startup.reason);
      results.push({ name: plan.name, status: 'error', reason: msg });
      this.log.error(`${plan.name} failed to start: ${msg}`);
    }

    // Summary (user-facing output — keep as console.log)
    console.log('\n  Channel Status:');
    for (const r of results) {
      const icon = r.status === 'ok' ? '+' : r.status === 'skipped' ? '-' : 'x';
      const detail = r.reason ? ` (${r.reason})` : '';
      console.log(`    [${icon}] ${r.name}${detail}`);
    }
    console.log();

    if (this.gateways.length === 0) {
      const failed = results.filter((entry) => entry.status === 'error');
      if (failed.length > 0) {
        const reasons = failed
          .map((entry) => `${entry.name}: ${entry.reason ?? 'unknown error'}`)
          .join('; ');
        throw new Error(`No channels started. Channel startup failures: ${reasons}`);
      }
      const skipped = results.filter((entry) => entry.status === 'skipped');
      if (skipped.length > 0) {
        this.log.info('All channels skipped; nothing to run.');
        return;
      }
      throw new Error(
        'No channels started. Check environment variables, optional dependencies, and command flags.',
      );
    }

    this.log.info(`${this.gateways.length} channel(s) active.`);
  }

  async stop(): Promise<void> {
    this.log.info('Shutting down all channels...');
    const stops = this.gateways.map((gw) => {
      this.log.info(`Stopping ${gw.name}...`);
      return gw.stop().catch((err) => {
        this.log.error(`Error stopping ${gw.name}: ${getErrorMessage(err)}`);
      });
    });
    await Promise.all(stops);
    this.gateways = [];
    this.log.info('All channels stopped.');
  }

  private async startSlack(model: ModelId): Promise<ChannelStartResult> {
    if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_APP_TOKEN) {
      if (this.options.verbose) {
        this.log.debug('Slack: SLACK_BOT_TOKEN or SLACK_APP_TOKEN not set, skipping.');
      }
      return { gateway: null, skippedReason: 'missing env vars' };
    }

    let SlackGatewayModule: typeof import('../slack/gateway.js');
    try {
      SlackGatewayModule = await import('../slack/gateway.js');
    } catch (err) {
      if (isModuleNotFoundError(err)) {
        return { gateway: null, skippedReason: 'slack/bolt not installed' };
      }
      throw err;
    }

    const { SlackGateway } = SlackGatewayModule;
    const gateway = new SlackGateway({
      model,
      allowList: this.options.slackAllowList,
      verbose: this.options.verbose,
    });

    try {
      await gateway.start();
    } catch (err) {
      const skippedReason = optionalDependencyErrorReason(err, 'Slack');
      if (skippedReason) {
        return { gateway: null, skippedReason };
      }
      throw err;
    }

    return { gateway: { name: 'Slack', stop: () => gateway.stop() } };
  }

  private async startWhatsApp(model: ModelId): Promise<ChannelStartResult> {
    let WhatsAppGatewayModule: typeof import('../whatsapp/gateway.js');
    try {
      WhatsAppGatewayModule = await import('../whatsapp/gateway.js');
    } catch (err) {
      if (isModuleNotFoundError(err)) {
        return { gateway: null, skippedReason: 'baileys not installed' };
      }
      throw err;
    }

    const { WhatsAppGateway } = WhatsAppGatewayModule;
    const gateway = new WhatsAppGateway({
      model,
      allowList: this.options.whatsappAllowList,
      allowGroups: this.options.whatsappAllowGroups,
      selfChatOnly: this.options.whatsappSelfChatOnly,
      authDir: this.options.whatsappAuthDir,
      verbose: this.options.verbose,
    });

    try {
      await gateway.start();
    } catch (err) {
      const skippedReason = optionalDependencyErrorReason(err, 'WhatsApp');
      if (skippedReason) {
        return { gateway: null, skippedReason };
      }
      throw err;
    }

    return { gateway: { name: 'WhatsApp', stop: () => gateway.stop() } };
  }
}
