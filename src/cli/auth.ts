import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { spawnSync } from 'node:child_process';
import {
  loadConfig,
  saveConfig,
  configExists,
  ensureConfigDir,
  getCurrentOrg,
  type StateSetConfig,
} from '../config.js';
import { formatError, printAuthHelp } from '../utils/display.js';
import { getErrorMessage } from '../lib/errors.js';
import { sleep, normalizeInstanceUrl } from './utils.js';
import { requestJson } from '../integrations/http.js';

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

type LoginMethod = 'device' | 'manual';

export interface AuthLoginOptions {
  device?: boolean;
  manual?: boolean;
  instanceUrl?: string;
  orgId?: string;
  orgName?: string;
  graphqlEndpoint?: string;
  adminSecret?: string;
  anthropicApiKey?: string;
  nonInteractive?: boolean;
  openBrowser?: boolean;
}

async function postJson<T = Record<string, unknown>>(
  url: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: T }> {
  const response = await requestJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (response.data as T) ?? ({} as T);
  return { status: response.status, data };
}

async function startDeviceFlow(instanceUrl: string) {
  const result = await postJson<{
    device_code: string;
    user_code: string;
    verification_url: string;
    expires_in: number;
    interval: number;
  }>(`${instanceUrl}/api/cli/device/start`, {});
  if (result.status < 200 || result.status >= 300) {
    const message =
      (result.data as { error?: string; message?: string }).error ??
      (result.data as { message?: string }).message ??
      `Request failed: ${result.status}`;
    throw new Error(message);
  }
  return result.data;
}

async function pollDeviceFlow(
  instanceUrl: string,
  deviceCode: string,
  interval: number,
  expiresIn: number,
) {
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
      const response = await postJson<{
        status?: string;
        error?: string;
        token?: string;
        org?: { id: string; name: string };
        graphqlEndpoint?: string;
      }>(`${instanceUrl}/api/cli/device/poll`, { device_code: deviceCode });
      const parsed = response.data;
      if (response.status < 200 || response.status >= 300) {
        if (typeof parsed === 'string') {
          data = { error: parsed };
        } else if (typeof parsed === 'object' && parsed !== null) {
          data = parsed as typeof data;
        } else {
          data = {};
        }
      } else if (typeof parsed === 'object' && parsed !== null) {
        data = parsed as typeof data;
      } else {
        data = {};
      }
    } catch {
      await sleep(interval * 1000);
      continue;
    }

    if (data.status === 'authorized') {
      return data;
    }

    const error = data.error;
    if (
      error &&
      error !== 'authorization_pending' &&
      error !== 'server_error' &&
      error !== 'slow_down'
    ) {
      throw new Error(error);
    }

    await sleep(interval * 1000);
  }
  throw new Error('Device code expired. Please try again.');
}

function validateHttpUrl(value: string, label: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${label} must be a valid HTTP(S) URL.`);
  }
  if (!HTTP_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`${label} must use http:// or https://.`);
  }
  return parsed.toString();
}

function validateInstanceUrl(value: string): string {
  return normalizeInstanceUrl(validateHttpUrl(value, 'Instance URL'));
}

function validateGraphQLEndpoint(value: string): string {
  return validateHttpUrl(value, 'GraphQL endpoint');
}

function tryOpenBrowser(url: string): boolean {
  try {
    let command: string;
    let args: string[];
    if (process.platform === 'darwin') {
      command = 'open';
      args = [url];
    } else if (process.platform === 'win32') {
      command = 'cmd';
      args = ['/c', 'start', '', url];
    } else {
      command = 'xdg-open';
      args = [url];
    }
    const result = spawnSync(command, args, { stdio: 'ignore' });
    if (result.error) {
      return false;
    }
    return result.status === 0;
  } catch {
    return false;
  }
}

function resolveLoginMethod(opts: AuthLoginOptions): LoginMethod | null {
  if (opts.device && opts.manual) {
    throw new Error('Choose only one login method: either --device or --manual.');
  }
  if (opts.device) return 'device';
  if (opts.manual) return 'manual';
  return null;
}

function getExistingConfig(): StateSetConfig {
  return configExists() ? loadConfig() : { currentOrg: '', organizations: {} };
}

export async function runAuthLogin(options: AuthLoginOptions = {}): Promise<void> {
  ensureConfigDir();
  const existing = getExistingConfig();

  let loginMethod = resolveLoginMethod(options);
  if (!loginMethod) {
    if (options.nonInteractive) {
      throw new Error('In non-interactive mode, pass either --device or --manual.');
    }
    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'loginMethod',
        message: 'Choose an authentication method:',
        choices: [
          { name: 'Browser/device code (recommended)', value: 'device' },
          { name: 'Manual setup (admin secret)', value: 'manual' },
        ],
      },
    ]);
    loginMethod = answer.loginMethod as LoginMethod;
  }

  const envAnthropicApiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  const existingAnthropicApiKey = (existing.anthropicApiKey || '').trim();
  const cliAnthropicApiKey = (options.anthropicApiKey || '').trim();
  if (options.anthropicApiKey !== undefined && !cliAnthropicApiKey) {
    throw new Error('--anthropic-api-key cannot be empty.');
  }

  let anthropicApiKey = cliAnthropicApiKey;
  const shouldPromptForAnthropic =
    !options.nonInteractive && !anthropicApiKey && !envAnthropicApiKey && !existingAnthropicApiKey;
  if (shouldPromptForAnthropic) {
    const answer = await inquirer.prompt([
      {
        type: 'password',
        name: 'anthropicApiKey',
        message: 'Anthropic API key (or set ANTHROPIC_API_KEY env var):',
      },
    ]);
    anthropicApiKey = String(answer.anthropicApiKey || '').trim();
  }
  if (anthropicApiKey) {
    existing.anthropicApiKey = anthropicApiKey;
  }

  if (loginMethod === 'device') {
    let instanceUrl = (options.instanceUrl || '').trim();
    if (!instanceUrl && !options.nonInteractive) {
      const answer = await inquirer.prompt([
        {
          type: 'input',
          name: 'instanceUrl',
          message: 'StateSet ResponseCX instance URL:',
          default: (process.env.STATESET_INSTANCE_URL || '').trim(),
          filter: (v: string) => v.trim(),
          validate: (v: string) => {
            try {
              validateInstanceUrl(v);
              return true;
            } catch (e: unknown) {
              return getErrorMessage(e);
            }
          },
        },
      ]);
      instanceUrl = answer.instanceUrl;
    }
    if (!instanceUrl) {
      instanceUrl = (process.env.STATESET_INSTANCE_URL || '').trim();
    }
    if (!instanceUrl) {
      throw new Error(
        'Instance URL is required. Pass --instance-url or set STATESET_INSTANCE_URL.',
      );
    }

    const normalizedInstance = validateInstanceUrl(instanceUrl);
    const { device_code, user_code, verification_url, expires_in, interval } =
      await startDeviceFlow(normalizedInstance);

    console.log('');
    console.log(chalk.bold('  Authorize the CLI'));
    console.log(chalk.gray(`  Visit: ${verification_url}`));
    console.log(chalk.gray(`  Code:  ${user_code}`));
    if (options.openBrowser !== false) {
      const opened = tryOpenBrowser(verification_url);
      console.log(
        opened
          ? chalk.gray('  Opened verification URL in your browser.')
          : chalk.gray('  Could not open a browser automatically. Open the URL manually.'),
      );
    }
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
  } else if (loginMethod === 'manual') {
    let orgId = (options.orgId || '').trim();
    let orgName = (options.orgName || '').trim();
    let graphqlEndpoint = (options.graphqlEndpoint || '').trim();
    let adminSecret = (options.adminSecret || '').trim();

    if (!options.nonInteractive) {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'orgId',
          message: 'Organization ID:',
          default: orgId,
          filter: (v: string) => v.trim(),
          validate: (v: string) => v.trim().length >= 1 || 'Organization ID is required',
        },
        {
          type: 'input',
          name: 'orgName',
          message: 'Organization name:',
          default: orgName,
          filter: (v: string) => v.trim(),
          validate: (v: string) => v.trim().length >= 1 || 'Name is required',
        },
        {
          type: 'input',
          name: 'graphqlEndpoint',
          message: 'GraphQL endpoint:',
          default: graphqlEndpoint || (process.env.STATESET_GRAPHQL_ENDPOINT || '').trim(),
          filter: (v: string) => v.trim(),
          validate: (v: string) => {
            try {
              validateGraphQLEndpoint(v);
              return true;
            } catch (e: unknown) {
              return getErrorMessage(e);
            }
          },
        },
        {
          type: 'password',
          name: 'adminSecret',
          message: 'Hasura admin secret:',
          filter: (v: string) => v.trim(),
          validate: (v: string) => v.trim().length >= 1 || 'Admin secret is required',
        },
      ]);

      orgId = String(answers.orgId || '').trim();
      orgName = String(answers.orgName || '').trim();
      graphqlEndpoint = String(answers.graphqlEndpoint || '').trim();
      adminSecret = String(answers.adminSecret || '').trim();
    } else if (!graphqlEndpoint) {
      graphqlEndpoint = (process.env.STATESET_GRAPHQL_ENDPOINT || '').trim();
    }

    if (!orgId) {
      throw new Error('Organization ID is required. Pass --org-id.');
    }
    if (!orgName) {
      throw new Error('Organization name is required. Pass --org-name.');
    }
    if (!graphqlEndpoint) {
      throw new Error('GraphQL endpoint is required. Pass --graphql-endpoint.');
    }
    if (!adminSecret) {
      throw new Error('Admin secret is required. Pass --admin-secret.');
    }

    const validatedGraphqlEndpoint = validateGraphQLEndpoint(graphqlEndpoint);
    existing.currentOrg = orgId;
    existing.organizations[orgId] = {
      name: orgName,
      graphqlEndpoint: validatedGraphqlEndpoint,
      adminSecret,
    };
  } else {
    throw new Error('Unknown authentication method selected.');
  }

  saveConfig(existing);
  const { orgId, config: orgConfig } = getCurrentOrg();
  console.log(chalk.green(`\n  Logged in to "${orgConfig.name}" (${orgId})\n`));

  if (!existing.anthropicApiKey && !envAnthropicApiKey) {
    console.log(
      chalk.yellow(
        '  Warning: no Anthropic API key stored. Set ANTHROPIC_API_KEY or run "response auth login --anthropic-api-key <key>".',
      ),
    );
    console.log('');
  }
}

export function registerAuthCommands(program: Command): void {
  const auth = program.command('auth').description('Manage authentication and organizations');

  auth
    .command('login')
    .description('Configure credentials for an organization')
    .option('--device', 'Use browser/device code authentication')
    .option('--manual', 'Use manual admin-secret authentication')
    .option('--instance-url <url>', 'StateSet ResponseCX instance URL')
    .option('--org-id <id>', 'Organization ID (manual mode)')
    .option('--org-name <name>', 'Organization name (manual mode)')
    .option('--graphql-endpoint <url>', 'GraphQL endpoint (manual mode)')
    .option('--admin-secret <secret>', 'Hasura admin secret (manual mode)')
    .option('--anthropic-api-key <key>', 'Anthropic API key to store in config')
    .option('--non-interactive', 'Fail instead of prompting for missing values')
    .option('--no-open-browser', 'Do not attempt to open the device verification URL')
    .action(async (opts: AuthLoginOptions) => {
      try {
        await runAuthLogin(opts);
      } catch (e: unknown) {
        console.error(formatError(getErrorMessage(e)));
        process.exitCode = 1;
      }
    });

  auth
    .command('switch <org-id>')
    .description('Switch to a different organization')
    .action((orgId: string) => {
      const config = loadConfig();
      if (!config.organizations[orgId]) {
        console.error(
          formatError(`Organization "${orgId}" not found. Run "response auth login" first.`),
        );
        process.exitCode = 1;
        return;
      }
      config.currentOrg = orgId;
      saveConfig(config);
      console.log(
        chalk.green(`\n  Switched to "${config.organizations[orgId].name}" (${orgId})\n`),
      );
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
        console.log(chalk.gray(`  Auth:     ${orgConfig.cliToken ? 'CLI token' : 'Admin secret'}`));
        console.log('');
        const orgCount = Object.keys(cfg.organizations).length;
        if (orgCount > 1) {
          console.log(
            chalk.gray(
              `  ${orgCount} organizations configured. Use "response auth switch <org-id>" to change.`,
            ),
          );
          for (const [id, org] of Object.entries(cfg.organizations)) {
            const marker = id === orgId ? chalk.green(' *') : '  ';
            console.log(chalk.gray(`  ${marker} ${id} (${org.name})`));
          }
          console.log('');
        }
      } catch (e: unknown) {
        console.error(formatError(getErrorMessage(e)));
      }
    });
}
