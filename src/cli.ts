#!/usr/bin/env node

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import * as readline from 'node:readline';
import { createRequire } from 'node:module';
import {
  loadConfig,
  saveConfig,
  configExists,
  ensureConfigDir,
  getCurrentOrg,
  getAnthropicApiKey,
  getConfiguredModel,
  resolveModel,
  type StateSetConfig,
  type ModelId,
} from './config.js';
import { StateSetAgent } from './agent.js';
import {
  printWelcome,
  printAuthHelp,
  printHelp,
  formatAssistantMessage,
  formatError,
  formatSuccess,
  formatWarning,
  formatElapsed,
  formatToolCall,
} from './utils/display.js';
const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version?: string };

const program = new Command();

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeInstanceUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  return trimmed;
}

async function postJson<T = Record<string, unknown>>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as { error?: string; message?: string }).error || (data as { message?: string }).message;
    throw new Error(message || `Request failed: ${response.status}`);
  }
  return data as T;
}

async function startDeviceFlow(instanceUrl: string) {
  return await postJson<{
    device_code: string;
    user_code: string;
    verification_url: string;
    expires_in: number;
    interval: number;
  }>(`${instanceUrl}/api/cli/device/start`, {});
}

async function pollDeviceFlow(instanceUrl: string, deviceCode: string, interval: number, expiresIn: number) {
  const expiresAt = Date.now() + expiresIn * 1000;
  while (Date.now() < expiresAt) {
    let data: {
      status?: string;
      error?: string;
      token?: string;
      org?: { id: string; name: string };
      graphqlEndpoint?: string;
    };

    try {
      const response = await fetch(`${instanceUrl}/api/cli/device/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_code: deviceCode }),
      });
      data = await response.json().catch(() => ({}));
    } catch {
      // Network error – wait and retry
      await sleep(interval * 1000);
      continue;
    }

    if (data.status === 'authorized') {
      return data;
    }

    const error = data.error;
    if (error && error !== 'authorization_pending' && error !== 'server_error' && error !== 'slow_down') {
      throw new Error(error);
    }

    await sleep(interval * 1000);
  }
  throw new Error('Device code expired. Please try again.');
}

program
  .name('response')
  .description('AI-powered CLI for managing the StateSet Response platform')
  .version(pkg.version || '0.0.0');

// Auth commands
const auth = program.command('auth').description('Manage authentication and organizations');

auth
  .command('login')
  .description('Configure credentials for an organization')
  .action(async () => {
    ensureConfigDir();

    const { loginMethod } = await inquirer.prompt([
      {
        type: 'list',
        name: 'loginMethod',
        message: 'Choose an authentication method:',
        choices: [
          { name: 'Browser/device code (recommended)', value: 'device' },
        ],
      },
    ]);

    const { anthropicApiKey } = await inquirer.prompt([
      {
        type: 'password',
        name: 'anthropicApiKey',
        message: 'Anthropic API key (or set ANTHROPIC_API_KEY env var):',
      },
    ]);

    const existing: StateSetConfig = configExists()
      ? loadConfig()
      : { currentOrg: '', organizations: {} };

    if (loginMethod === 'device') {
      const { instanceUrl } = await inquirer.prompt([
        {
          type: 'input',
          name: 'instanceUrl',
          message: 'StateSet ResponseCX instance URL:',
          default: process.env.STATESET_INSTANCE_URL || '',
          validate: (v: string) => v.trim().length >= 1 || 'Instance URL is required',
        },
      ]);

      const normalizedInstance = normalizeInstanceUrl(instanceUrl);
      const { device_code, user_code, verification_url, expires_in, interval } =
        await startDeviceFlow(normalizedInstance);

      console.log('');
      console.log(chalk.bold('  Authorize the CLI'));
      console.log(chalk.gray(`  Visit: ${verification_url}`));
      console.log(chalk.gray(`  Code:  ${user_code}`));
      console.log('');

      const spinner = ora('Waiting for authorization...').start();
      const result = await pollDeviceFlow(normalizedInstance, device_code, interval, expires_in);
      spinner.succeed('Authorized');

      if (!result.token || !result.org?.id || !result.graphqlEndpoint) {
        throw new Error('Authorization response missing required data.');
      }

      existing.currentOrg = result.org.id;
      existing.organizations[result.org.id] = {
        name: result.org.name || result.org.id,
        graphqlEndpoint: result.graphqlEndpoint,
        cliToken: result.token,
      };
    } else {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'orgId',
          message: 'Organization ID:',
          validate: (v: string) => v.length >= 1 || 'Organization ID is required',
        },
        {
          type: 'input',
          name: 'orgName',
          message: 'Organization name:',
          validate: (v: string) => v.length >= 1 || 'Name is required',
        },
        {
          type: 'input',
          name: 'graphqlEndpoint',
          message: 'GraphQL endpoint:',
          default: process.env.STATESET_GRAPHQL_ENDPOINT || '',
        },
        {
          type: 'password',
          name: 'adminSecret',
          message: 'Hasura admin secret:',
          validate: (v: string) => v.length >= 1 || 'Admin secret is required',
        },
      ]);

      existing.currentOrg = answers.orgId;
      existing.organizations[answers.orgId] = {
        name: answers.orgName,
        graphqlEndpoint: answers.graphqlEndpoint,
        adminSecret: answers.adminSecret,
      };
    }

    if (anthropicApiKey) {
      existing.anthropicApiKey = anthropicApiKey;
    }

    saveConfig(existing);
    const { orgId, config: orgConfig } = getCurrentOrg();
    console.log(chalk.green(`\n  Logged in to "${orgConfig.name}" (${orgId})\n`));
  });

auth
  .command('switch <org-id>')
  .description('Switch to a different organization')
  .action((orgId: string) => {
    const config = loadConfig();
    if (!config.organizations[orgId]) {
      console.error(formatError(`Organization "${orgId}" not found. Run "response auth login" first.`));
      process.exit(1);
    }
    config.currentOrg = orgId;
    saveConfig(config);
    console.log(chalk.green(`\n  Switched to "${config.organizations[orgId].name}" (${orgId})\n`));
  });

auth
  .command('status')
  .description('Show current authentication status')
  .action(() => {
    if (!configExists()) {
      printAuthHelp();
      return;
    }
    try {
      const { orgId, config: orgConfig } = getCurrentOrg();
      const cfg = loadConfig();
      console.log('');
      console.log(chalk.bold('  Current Organization'));
      console.log(chalk.gray(`  ID:       ${orgId}`));
      console.log(chalk.gray(`  Name:     ${orgConfig.name}`));
      console.log(chalk.gray(`  Endpoint: ${orgConfig.graphqlEndpoint}`));
      console.log(
        chalk.gray(`  Auth:     ${orgConfig.cliToken ? 'CLI token' : 'Admin secret'}`)
      );
      console.log('');
      const orgCount = Object.keys(cfg.organizations).length;
      if (orgCount > 1) {
        console.log(chalk.gray(`  ${orgCount} organizations configured. Use "response auth switch <org-id>" to change.`));
        for (const [id, org] of Object.entries(cfg.organizations)) {
          const marker = id === orgId ? chalk.green(' *') : '  ';
          console.log(chalk.gray(`  ${marker} ${id} (${org.name})`));
        }
        console.log('');
      }
    } catch (e: unknown) {
      console.error(formatError(e instanceof Error ? e.message : String(e)));
    }
  });

// Default command: interactive agent session
program
  .command('chat', { isDefault: true })
  .description('Start an interactive AI agent session')
  .option('--model <model>', 'Model to use (sonnet, haiku, opus)')
  .action(async (options: { model?: string }) => {
    // Check config
    if (!configExists()) {
      printAuthHelp();
      process.exit(1);
    }

    let orgId: string;
    try {
      const org = getCurrentOrg();
      orgId = org.orgId;
    } catch (e: unknown) {
      console.error(formatError(e instanceof Error ? e.message : String(e)));
      process.exit(1);
    }

    let apiKey: string;
    try {
      apiKey = getAnthropicApiKey();
    } catch (e: unknown) {
      console.error(formatError(e instanceof Error ? e.message : String(e)));
      process.exit(1);
    }

    // Resolve model
    let model: ModelId = getConfiguredModel();
    if (options.model) {
      const resolved = resolveModel(options.model);
      if (!resolved) {
        console.error(formatError(`Unknown model "${options.model}". Use sonnet, haiku, or opus.`));
        process.exit(1);
      }
      model = resolved;
    }

    const agent = new StateSetAgent(apiKey, model);

    const spinner = ora('Connecting to StateSet Response...').start();
    try {
      await agent.connect();
      spinner.succeed('Connected');
    } catch (e: unknown) {
      spinner.fail('Failed to connect');
      console.error(formatError(e instanceof Error ? e.message : String(e)));
      process.exit(1);
    }

    printWelcome(orgId, pkg.version, model);

    // Graceful shutdown
    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log('');
      const exitSpinner = ora('Disconnecting...').start();
      await agent.disconnect();
      exitSpinner.succeed('Disconnected');
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('response> '),
    });

    let processing = false;
    let multiLineBuffer = '';

    // Handle Ctrl+C: cancel current request or show prompt
    process.on('SIGINT', () => {
      if (processing) {
        agent.abort();
        processing = false;
        console.log(chalk.yellow('\n  Request cancelled.'));
        console.log('');
        rl.prompt();
      } else {
        // Double Ctrl+C to exit
        console.log(chalk.gray('\n  Press Ctrl+C again or type "exit" to quit.'));
        rl.prompt();
        // Set a one-time listener for a second SIGINT
        const onSecondSigint = () => {
          shutdown();
        };
        process.once('SIGINT', onSecondSigint);
        // Reset after 2 seconds
        setTimeout(() => {
          process.removeListener('SIGINT', onSecondSigint);
        }, 2000);
      }
    });

    rl.prompt();

    rl.on('line', async (line: string) => {
      // Multi-line support: trailing backslash continues input
      if (line.endsWith('\\')) {
        multiLineBuffer += line.slice(0, -1) + '\n';
        process.stdout.write(chalk.gray('... '));
        return;
      }

      const input = (multiLineBuffer + line).trim();
      multiLineBuffer = '';

      if (!input) {
        rl.prompt();
        return;
      }

      // Slash commands
      if (input === '/help') {
        printHelp();
        rl.prompt();
        return;
      }

      if (input === '/clear') {
        agent.clearHistory();
        console.log(formatSuccess('Conversation history cleared.'));
        console.log('');
        rl.prompt();
        return;
      }

      if (input === '/history') {
        const count = agent.getHistoryLength();
        console.log(formatSuccess(`Conversation history: ${count} messages.`));
        console.log('');
        rl.prompt();
        return;
      }

      if (input.startsWith('/model')) {
        const modelArg = input.slice(6).trim();
        if (!modelArg) {
          console.log(formatSuccess(`Current model: ${agent.getModel()}`));
          console.log(chalk.gray('  Usage: /model <sonnet|haiku|opus>'));
        } else {
          const resolved = resolveModel(modelArg);
          if (resolved) {
            agent.setModel(resolved);
            console.log(formatSuccess(`Model switched to: ${resolved}`));
          } else {
            console.log(formatWarning(`Unknown model "${modelArg}". Use sonnet, haiku, or opus.`));
          }
        }
        console.log('');
        rl.prompt();
        return;
      }

      if (input === 'exit' || input === 'quit') {
        await shutdown();
        return;
      }

      processing = true;
      const startTime = Date.now();

      // Stream response: print text token-by-token
      let firstText = true;
      try {
        const response = await agent.chat(input, {
          onText: (delta) => {
            if (firstText) {
              firstText = false;
            }
            process.stdout.write(chalk.white(delta));
          },
          onToolCall: (name, args) => {
            console.log(formatToolCall(name, args));
          },
        });

        // If no streaming text was emitted (shouldn't happen, but safety)
        if (firstText && response) {
          console.log(formatAssistantMessage(response));
        }

        const elapsed = Date.now() - startTime;
        console.log(formatElapsed(elapsed));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg !== 'Request cancelled') {
          console.error('\n' + formatError(msg));
        }
      }
      processing = false;
      console.log('');
      rl.prompt();
    });

    rl.on('close', async () => {
      await shutdown();
    });
  });

program.parse();
