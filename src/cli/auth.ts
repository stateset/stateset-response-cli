import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
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

export function registerAuthCommands(program: Command): void {
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
            { name: 'Manual setup (admin secret)', value: 'manual' },
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
            default: (process.env.STATESET_INSTANCE_URL || '').trim(),
            filter: (v: string) => v.trim(),
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
      } else if (loginMethod === 'manual') {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'orgId',
            message: 'Organization ID:',
            filter: (v: string) => v.trim(),
            validate: (v: string) => v.trim().length >= 1 || 'Organization ID is required',
          },
          {
            type: 'input',
            name: 'orgName',
            message: 'Organization name:',
            filter: (v: string) => v.trim(),
            validate: (v: string) => v.trim().length >= 1 || 'Name is required',
          },
          {
            type: 'input',
            name: 'graphqlEndpoint',
            message: 'GraphQL endpoint:',
            default: (process.env.STATESET_GRAPHQL_ENDPOINT || '').trim(),
            filter: (v: string) => v.trim(),
            validate: (v: string) => v.trim().length >= 1 || 'GraphQL endpoint is required',
          },
          {
            type: 'password',
            name: 'adminSecret',
            message: 'Hasura admin secret:',
            filter: (v: string) => v.trim(),
            validate: (v: string) => v.trim().length >= 1 || 'Admin secret is required',
          },
        ]);

        existing.currentOrg = answers.orgId;
        existing.organizations[answers.orgId] = {
          name: answers.orgName,
          graphqlEndpoint: answers.graphqlEndpoint,
          adminSecret: answers.adminSecret,
        };
      } else {
        throw new Error('Unknown authentication method selected.');
      }

      const trimmedAnthropicApiKey = anthropicApiKey?.trim();
      if (trimmedAnthropicApiKey) {
        existing.anthropicApiKey = trimmedAnthropicApiKey;
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
        console.error(
          formatError(`Organization "${orgId}" not found. Run "response auth login" first.`),
        );
        process.exit(1);
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
