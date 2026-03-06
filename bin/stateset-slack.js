#!/usr/bin/env node

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');

function handleFatalError(err) {
  if (err && typeof err === 'object' && 'code' in err && err.code === 'ERR_MODULE_NOT_FOUND') {
    console.error('Error: Build artifacts not found. Run "npm run build" first.');
  } else {
    console.error('Error:', err instanceof Error ? err.message : String(err));
  }
  process.exit(1);
}

async function main() {
  const { ensureSupportedNodeRuntime } = await import('../dist/runtime/node-launcher.js');
  await ensureSupportedNodeRuntime(import.meta.url);

  const [
    { configExists, getAnthropicApiKey, getCurrentOrg, resolveModelOrThrow },
    { logger },
    { installGlobalErrorHandlers },
    { parseSlackArgs },
  ] = await Promise.all([
    import('../dist/config.js'),
    import('../dist/lib/logger.js'),
    import('../dist/lib/errors.js'),
    import('../dist/cli/gateway-args.js'),
  ]);

  installGlobalErrorHandlers();

  const args = process.argv.slice(2);
  let options;

  try {
    const parsed = parseSlackArgs(args);
    if (parsed.showVersion) {
      console.log(pkg.version || '0.0.0');
      process.exit(0);
    }
    if (parsed.showHelp) {
      console.log(`
StateSet Response — Slack Gateway

Usage: response-slack [options]

Options:
  --model <name>, -m  Model to use (sonnet, haiku, opus or full model ID) [default: config]
  --allow <ids>       Comma-separated allowlist of Slack user IDs
  --version, -V       Show this version
  --verbose, -v       Enable debug logging
  --help, -h          Show this help message

Setup:
  1. Create a Slack app at https://api.slack.com/apps
  2. Enable Socket Mode (Settings > Socket Mode)
  3. Generate an app-level token (xapp-...) with connections:write scope
  4. Add Bot Token Scopes: chat:write, app_mentions:read, im:history, channels:history
  5. Install the app to your workspace
  6. Copy the Bot User OAuth Token (xoxb-...)
  7. Set environment variables:
     export SLACK_BOT_TOKEN=xoxb-...
     export SLACK_APP_TOKEN=xapp-...
  8. Run: response-slack

Behavior:
  - In DMs: responds to all messages
  - In channels: only responds when @mentioned or in threads with the bot

Environment:
  SLACK_BOT_TOKEN      Bot User OAuth Token (xoxb-...) (required)
  SLACK_APP_TOKEN      App-level token for Socket Mode (xapp-...) (required)
  ANTHROPIC_API_KEY    Anthropic API key (required)

Examples:
  response-slack                              Start with default settings
  response-slack --model haiku                Use Claude Haiku
  response-slack --allow U12345678,U87654321  Only allow specific users
  response-slack --verbose                    Debug logging
`);
      process.exit(0);
    }
    options = {
      model: parsed.model,
      allow: parsed.allowList,
      verbose: parsed.verbose,
    };
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    console.error('Run "response-slack --help" for supported options.');
    process.exit(1);
  }

  logger.configure({ level: options.verbose ? 'debug' : 'info' });

  if (!configExists()) {
    console.error('Error: No configuration found.');
    console.error('Run "response auth login" to set up your credentials first.');
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

  if (!process.env.SLACK_BOT_TOKEN) {
    console.error('Error: SLACK_BOT_TOKEN environment variable is required.');
    console.error('Get one from your Slack app settings: https://api.slack.com/apps');
    process.exit(1);
  }

  if (!process.env.SLACK_APP_TOKEN) {
    console.error('Error: SLACK_APP_TOKEN environment variable is required (starts with xapp-).');
    console.error('Enable Socket Mode and generate an app-level token in your Slack app settings.');
    process.exit(1);
  }

  console.log(`
╔═══════════════════════════════════════════════════╗
║        StateSet Response — Slack Gateway          ║
╠═══════════════════════════════════════════════════╣
║  Organization: ${orgId.padEnd(34)}║
║  Model:        ${(options.model ?? 'default').padEnd(34)}║
${options.allow ? `║  Allowlist:    ${(options.allow.length + ' user(s)').padEnd(34)}║\n` : ''}╚═══════════════════════════════════════════════════╝
`);

  const { SlackGateway } = await import('../dist/slack/gateway.js');
  const gateway = new SlackGateway({
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
