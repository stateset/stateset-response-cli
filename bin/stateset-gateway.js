#!/usr/bin/env node

import { createRequire } from 'node:module';
import { handleBootstrapError } from './bootstrap-runtime.js';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');

function handleFatalError(err) {
  handleBootstrapError(err, 'response-gateway');
}

function parseCommaSeparatedEnv(value) {
  if (!value) {
    return undefined;
  }
  const items = [];
  const seen = new Set();
  for (const part of value.split(',')) {
    const trimmed = part.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    items.push(trimmed);
  }
  return items.length > 0 ? items : undefined;
}

function resolveHealthPort() {
  const raw = process.env.STATESET_GATEWAY_HEALTH_PORT || process.env.PORT;
  if (!raw) {
    return null;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error('STATESET_GATEWAY_HEALTH_PORT / PORT must be a valid TCP port.');
  }
  return value;
}

async function main() {
  const { ensureSupportedNodeRuntime } = await import('../dist/runtime/node-launcher.js');
  await ensureSupportedNodeRuntime(import.meta.url);

  const [
    { configExists, getAnthropicApiKey, getCurrentOrg, resolveModelOrThrow },
    { logger },
    { installGlobalErrorHandlers },
    { parseGatewayArgs },
    { ensureGatewayRuntimeConfigFromEnv },
  ] = await Promise.all([
    import('../dist/config.js'),
    import('../dist/lib/logger.js'),
    import('../dist/lib/errors.js'),
    import('../dist/cli/gateway-args.js'),
    import('../dist/gateway/runtime-config.js'),
  ]);

  installGlobalErrorHandlers();

  const args = process.argv.slice(2);
  let options;
  try {
    const parsed = parseGatewayArgs(args);
    if (parsed.showVersion) {
      console.log(pkg.version || '0.0.0');
      process.exit(0);
    }
    if (parsed.showHelp) {
      console.log(`
StateSet Response - Multi-Channel Gateway

Runs Slack, Telegram, and WhatsApp gateways simultaneously from a single process.
Channels auto-detect based on environment variables and installed packages.

Usage: response-gateway [options]

Options:
  --model <name>, -m         Model to use (sonnet, haiku, opus or full model ID) [default: config]
  --no-slack                 Disable Slack channel
  --no-telegram              Disable Telegram channel
  --no-whatsapp              Disable WhatsApp channel
  --slack-allow <ids>        Comma-separated Slack user ID allowlist
  --telegram-allow <ids>     Comma-separated Telegram user ID allowlist
  --whatsapp-allow <phones>  Comma-separated phone number allowlist
  --whatsapp-groups          Allow WhatsApp group messages          [default: false]
  --whatsapp-self-chat       Only respond to messages you send to yourself
  --whatsapp-auth-dir <path> WhatsApp auth credential directory
  --version, -V              Show this version
  --verbose, -v              Enable debug logging
  --help, -h                 Show this help message

Environment:
  SLACK_BOT_TOKEN              Bot User OAuth Token (required for Slack)
  SLACK_APP_TOKEN              App-level token for Socket Mode (required for Slack)
  TELEGRAM_BOT_TOKEN           Telegram bot token from @BotFather (required for Telegram)
  SLACK_ALLOW                  Optional comma-separated Slack user ID allowlist
  TELEGRAM_ALLOW               Optional comma-separated Telegram user ID allowlist
  WHATSAPP_ALLOW               Optional comma-separated phone allowlist
  ANTHROPIC_API_KEY            Anthropic API key (required)
  STATESET_ALLOW_APPLY         Enable state-changing operations      [default: false]
  STATESET_GATEWAY_HEALTH_PORT Optional HTTP health probe port
  PORT                         Alias for STATESET_GATEWAY_HEALTH_PORT

Channels start automatically when their prerequisites are met:
  Slack:    SLACK_BOT_TOKEN + SLACK_APP_TOKEN env vars set
  Telegram: TELEGRAM_BOT_TOKEN env var set
  WhatsApp: @whiskeysockets/baileys package installed

Kubernetes bootstrap env vars (optional when no local config exists):
  STATESET_ORG_ID, STATESET_GRAPHQL_ENDPOINT, and STATESET_CLI_TOKEN or STATESET_ADMIN_SECRET

Examples:
  response-gateway                                   Start all available channels
  response-gateway --no-whatsapp                     Slack + Telegram only
  response-gateway --no-slack --telegram-allow 1234 Telegram only for one user
  response-gateway --model opus --verbose            Use Opus with debug logging
`);
      process.exit(0);
    }
    options = {
      model: parsed.model,
      slackAllowList: parsed.slackAllowList ?? parseCommaSeparatedEnv(process.env.SLACK_ALLOW),
      telegramAllowList:
        parsed.telegramAllowList ?? parseCommaSeparatedEnv(process.env.TELEGRAM_ALLOW),
      whatsappAllowList:
        parsed.whatsappAllowList ?? parseCommaSeparatedEnv(process.env.WHATSAPP_ALLOW),
      whatsappGroups: parsed.whatsappAllowGroups,
      whatsappSelfChatOnly: parsed.whatsappSelfChatOnly,
      whatsappAuthDir: parsed.whatsappAuthDir,
      slackEnabled: parsed.slackEnabled,
      telegramEnabled: parsed.telegramEnabled,
      whatsappEnabled: parsed.whatsappEnabled,
      verbose: parsed.verbose,
    };
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    console.error('Run "response-gateway --help" for supported options.');
    process.exit(1);
  }

  logger.configure({ level: options.verbose ? 'debug' : 'info' });

  try {
    ensureGatewayRuntimeConfigFromEnv();
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  if (!configExists()) {
    console.error('Error: No configuration found.');
    console.error(
      'Run "response auth login" or set STATESET_ORG_ID, STATESET_GRAPHQL_ENDPOINT, and STATESET_CLI_TOKEN/STATESET_ADMIN_SECRET.',
    );
    process.exit(1);
  }

  try {
    getAnthropicApiKey();
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  let currentOrgId = '';
  try {
    currentOrgId = getCurrentOrg().orgId;
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  if (options.model) {
    try {
      options.model = resolveModelOrThrow(options.model, 'valid');
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  }

  let healthPort = null;
  try {
    healthPort = resolveHealthPort();
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  console.log(`
+---------------------------------------------------+
|     StateSet Response - Multi-Channel Gateway     |
+---------------------------------------------------+
|  Organization: ${currentOrgId.padEnd(34)}|
|  Model:        ${(options.model ?? 'default').padEnd(34)}|
+---------------------------------------------------+
`);

  const { Orchestrator } = await import('../dist/gateway/orchestrator.js');
  const orchestrator = new Orchestrator({
    model: options.model,
    verbose: options.verbose,
    slackEnabled: options.slackEnabled,
    slackAllowList: options.slackAllowList,
    telegramEnabled: options.telegramEnabled,
    telegramAllowList: options.telegramAllowList,
    whatsappEnabled: options.whatsappEnabled,
    whatsappAllowList: options.whatsappAllowList,
    whatsappAllowGroups: options.whatsappGroups,
    whatsappSelfChatOnly: options.whatsappSelfChatOnly,
    whatsappAuthDir: options.whatsappAuthDir,
  });

  await orchestrator.start();

  let healthServer = null;
  if (healthPort !== null) {
    const { startGatewayHealthServer } = await import('../dist/gateway/health-server.js');
    healthServer = startGatewayHealthServer({
      port: healthPort,
      source: orchestrator,
    });
  }

  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('\nShutting down gracefully...');
    try {
      if (healthServer) {
        await healthServer.stop();
      }
      await orchestrator.stop();
    } catch (err) {
      console.error(`Error during shutdown: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      process.exit(0);
    }
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

await main().catch(handleFatalError);
