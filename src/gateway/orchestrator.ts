/**
 * Multi-Channel Orchestrator for StateSet Response
 *
 * Runs multiple channel gateways (Slack, WhatsApp) simultaneously
 * from a single process with shared config and unified lifecycle.
 */

import {
  configExists,
  getAnthropicApiKey,
  getCurrentOrg,
  resolveModel,
  getConfiguredModel,
} from '../config.js';
import { logger } from '../lib/logger.js';

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

export class Orchestrator {
  private gateways: ChannelGateway[] = [];
  private options: OrchestratorOptions;
  private readonly log = logger.child('orchestrator');

  constructor(options: OrchestratorOptions = {}) {
    this.options = options;
  }

  async start(): Promise<void> {
    // Validate shared prerequisites
    if (!configExists()) {
      throw new Error('No configuration found. Run "response auth login" first.');
    }
    getAnthropicApiKey();
    getCurrentOrg();

    if (this.options.model) {
      const resolved = resolveModel(this.options.model);
      if (!resolved) {
        throw new Error(`Unknown model "${this.options.model}". Valid: sonnet, haiku, opus`);
      }
    }

    const model = this.options.model
      ? (resolveModel(this.options.model) ?? getConfiguredModel())
      : getConfiguredModel();

    const results: Array<{ name: string; status: 'ok' | 'skipped' | 'error'; reason?: string }> =
      [];

    // Start Slack gateway
    if (this.options.slackEnabled !== false) {
      try {
        const slack = await this.startSlack(model as string);
        if (slack) {
          this.gateways.push(slack);
          results.push({ name: 'Slack', status: 'ok' });
        } else {
          results.push({ name: 'Slack', status: 'skipped', reason: 'missing env vars' });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ name: 'Slack', status: 'error', reason: msg });
        this.log.error(`Slack failed to start: ${msg}`);
      }
    } else {
      results.push({ name: 'Slack', status: 'skipped', reason: 'disabled' });
    }

    // Start WhatsApp gateway
    if (this.options.whatsappEnabled !== false) {
      try {
        const wa = await this.startWhatsApp(model as string);
        if (wa) {
          this.gateways.push(wa);
          results.push({ name: 'WhatsApp', status: 'ok' });
        } else {
          results.push({ name: 'WhatsApp', status: 'skipped', reason: 'baileys not installed' });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ name: 'WhatsApp', status: 'error', reason: msg });
        this.log.error(`WhatsApp failed to start: ${msg}`);
      }
    } else {
      results.push({ name: 'WhatsApp', status: 'skipped', reason: 'disabled' });
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
      throw new Error(
        'No channels started. Check environment variables and optional dependencies.',
      );
    }

    this.log.info(`${this.gateways.length} channel(s) active.`);
  }

  async stop(): Promise<void> {
    this.log.info('Shutting down all channels...');
    const stops = this.gateways.map((gw) => {
      this.log.info(`Stopping ${gw.name}...`);
      return gw.stop().catch((err) => {
        this.log.error(`Error stopping ${gw.name}: ${err instanceof Error ? err.message : err}`);
      });
    });
    await Promise.all(stops);
    this.gateways = [];
    this.log.info('All channels stopped.');
  }

  private async startSlack(model: string): Promise<ChannelGateway | null> {
    if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_APP_TOKEN) {
      if (this.options.verbose) {
        this.log.debug('Slack: SLACK_BOT_TOKEN or SLACK_APP_TOKEN not set, skipping.');
      }
      return null;
    }

    const { SlackGateway } = await import('../slack/gateway.js');
    const gateway = new SlackGateway({
      model,
      allowList: this.options.slackAllowList,
      verbose: this.options.verbose,
    });

    await gateway.start();
    return { name: 'Slack', stop: () => gateway.stop() };
  }

  private async startWhatsApp(model: string): Promise<ChannelGateway | null> {
    try {
      const { WhatsAppGateway } = await import('../whatsapp/gateway.js');
      const gateway = new WhatsAppGateway({
        model,
        allowList: this.options.whatsappAllowList,
        allowGroups: this.options.whatsappAllowGroups,
        selfChatOnly: this.options.whatsappSelfChatOnly,
        authDir: this.options.whatsappAuthDir,
        verbose: this.options.verbose,
      });

      await gateway.start();
      return { name: 'WhatsApp', stop: () => gateway.stop() };
    } catch (err) {
      if (err instanceof Error && err.message.includes('Cannot find')) {
        return null; // baileys not installed
      }
      throw err;
    }
  }
}
