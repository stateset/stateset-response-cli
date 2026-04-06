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
    { parseWhatsAppArgs },
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
    const parsed = parseWhatsAppArgs(args);
    if (parsed.showVersion) {
      console.log(pkg.version || '0.0.0');
      process.exit(0);
    }
    if (parsed.showHelp) {
      console.log(`
StateSet Response - WhatsApp Gateway

Usage: response-whatsapp [options]

Options:
  --model <name>, -m  Model to use (sonnet, haiku, opus or full model ID) [default: config]
  --allow <phones>    Comma-separated allowlist of phone numbers
  --groups            Allow messages from group chats           [default: false]
  --self-chat         Only respond to messages you send to yourself
  --auth-dir <path>   WhatsApp auth credential directory        [default: ~/.stateset/whatsapp-auth]
  --reset             Clear stored WhatsApp auth and re-scan QR
  --version, -V       Show this version
  --verbose, -v       Enable debug logging
  --help, -h          Show this help message

Environment:
  WHATSAPP_ALLOW      Optional comma-separated phone number allowlist
  ANTHROPIC_API_KEY   Anthropic API key (required)
  STATESET_ALLOW_APPLY Enable state-changing operations [default: false]

Examples:
  response-whatsapp                           Start with default settings
  response-whatsapp --model haiku             Use Claude Haiku
  response-whatsapp --allow 14155551234       Only accept from one number
  response-whatsapp --self-chat               Only respond to your self-chat
  response-whatsapp --reset                   Re-authenticate with QR scan
`);
      process.exit(0);
    }
    options = {
      model: parsed.model,
      allow: parsed.allowList ?? parseCommaSeparatedEnv(process.env.WHATSAPP_ALLOW),
      groups: parsed.allowGroups,
      selfChat: parsed.selfChatOnly,
      authDir: parsed.authDir,
      reset: parsed.resetAuth,
      verbose: parsed.verbose,
    };
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    console.error('Run "response-whatsapp --help" for supported options.');
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

  if (options.reset) {
    try {
      const { clearAuth } = await import('../dist/whatsapp/session.js');
      clearAuth(options.authDir);
      console.log('WhatsApp auth credentials cleared. You will need to scan the QR code again.');
    } catch (err) {
      console.error(
        `Error: Unable to clear WhatsApp auth credentials (${err instanceof Error ? err.message : err})`,
      );
      process.exit(1);
    }
  }

  console.log(`
+---------------------------------------------------+
|       StateSet Response - WhatsApp Gateway        |
+---------------------------------------------------+
|  Organization: ${orgId.padEnd(34)}|
|  Model:        ${(options.model ?? 'default').padEnd(34)}|
|  Groups:       ${(options.groups ? 'allowed' : 'disabled').padEnd(34)}|
|  Self chat:    ${(options.selfChat ? 'enabled' : 'disabled').padEnd(34)}|
${options.allow ? `|  Allowlist:    ${(options.allow.length + ' number(s)').padEnd(34)}|
` : ''}+---------------------------------------------------+
`);

  const { WhatsAppGateway } = await import('../dist/whatsapp/gateway.js');
  const gateway = new WhatsAppGateway({
    model: options.model,
    allowList: options.allow,
    allowGroups: options.groups,
    selfChatOnly: options.selfChat,
    authDir: options.authDir,
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
