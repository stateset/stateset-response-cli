#!/usr/bin/env node

import { createRequire } from 'node:module';
import { handleBootstrapError } from './bootstrap-runtime.js';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');

function handleFatalError(err) {
  handleBootstrapError(err, 'response-telegram');
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

async function main() {
  const { ensureSupportedNodeRuntime } = await import('../dist/runtime/node-launcher.js');
  await ensureSupportedNodeRuntime(import.meta.url);

  const [
    { configExists, getAnthropicApiKey, getCurrentOrg, resolveModelOrThrow },
    { logger },
    { installGlobalErrorHandlers },
    { parseTelegramArgs },
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
    const parsed = parseTelegramArgs(args);
    if (parsed.showVersion) {
      console.log(pkg.version || '0.0.0');
      process.exit(0);
    }
    if (parsed.showHelp) {
      console.log(`
StateSet Response - Telegram Gateway

Usage: response-telegram [options]

Options:
  --model <name>, -m  Model to use (sonnet, haiku, opus or full model ID) [default: config]
  --allow <ids>       Comma-separated allowlist of Telegram user IDs
  --version, -V       Show this version
  --verbose, -v       Enable debug logging
  --help, -h          Show this help message

Setup:
  1. Create a bot with @BotFather on Telegram
  2. Copy the bot token it returns
  3. Set environment variables:
     export TELEGRAM_BOT_TOKEN=<token>
     export ANTHROPIC_API_KEY=<key>
     export STATESET_ALLOW_APPLY=true   # optional, required for writes
  4. Run: response-telegram

Behavior:
  - In private chats: responds to all messages

Environment:
  TELEGRAM_BOT_TOKEN  Telegram bot token from @BotFather (required)
  TELEGRAM_ALLOW      Optional comma-separated Telegram user ID allowlist
  ANTHROPIC_API_KEY   Anthropic API key (required)
  STATESET_ALLOW_APPLY Enable state-changing operations [default: false]

Examples:
  response-telegram                    Start with default settings
  response-telegram --model haiku      Use Claude Haiku
  response-telegram --allow 12345,6789 Only allow specific Telegram users
  response-telegram --verbose          Debug logging
`);
      process.exit(0);
    }
    options = {
      model: parsed.model,
      allow: parsed.allowList ?? parseCommaSeparatedEnv(process.env.TELEGRAM_ALLOW),
      verbose: parsed.verbose,
    };
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    console.error('Run "response-telegram --help" for supported options.');
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

  let orgId = '';
  try {
    orgId = getCurrentOrg().orgId;
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

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('Error: TELEGRAM_BOT_TOKEN environment variable is required.');
    console.error('Create a bot via @BotFather on Telegram to get a token.');
    process.exit(1);
  }

  console.log(`
+---------------------------------------------------+
|      StateSet Response - Telegram Gateway         |
+---------------------------------------------------+
|  Organization: ${orgId.padEnd(34)}|
|  Model:        ${(options.model ?? 'default').padEnd(34)}|
${options.allow ? `|  Allowlist:    ${(options.allow.length + ' user(s)').padEnd(34)}|
` : ''}+---------------------------------------------------+
`);

  const { TelegramGateway } = await import('../dist/telegram/gateway.js');
  const gateway = new TelegramGateway({
    model: options.model,
    allowList: options.allow,
    verbose: options.verbose,
  });

  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('\nShutting down gracefully...');
    try {
      await gateway.stop();
    } catch (err) {
      console.error(`Error during shutdown: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      process.exit(0);
    }
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  gateway.start().catch((err) => {
    console.error('Failed to start gateway:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

await main().catch(handleFatalError);
