import { spawnSync } from 'node:child_process';
import { Command } from 'commander';
import chalk from 'chalk';
import { configExists, loadConfig, type StateSetConfig } from '../config.js';
import { getErrorMessage } from '../lib/errors.js';
import { formatError } from '../utils/display.js';
import { normalizeInstanceUrl } from './utils.js';

const DEFAULT_DASHBOARD_URL = 'https://response.stateset.app';

type DashboardSource = 'instance_env' | 'graphql_env' | 'config' | 'default';

interface DashboardInfo {
  currentOrg?: string;
  source: DashboardSource;
  url: string;
}

interface DashboardDeps {
  configExistsFn?: typeof configExists;
  loadConfigFn?: typeof loadConfig;
  log?: (message: string) => void;
  error?: (message: string) => void;
  openBrowser?: (url: string) => boolean;
}

function getParentBooleanOption(command: Command | undefined, name: string): boolean {
  if (!command?.parent) {
    return false;
  }
  return Boolean(command.parent.opts()?.[name]);
}

function tryOpenBrowser(url: string): boolean {
  try {
    let command: string;
    let args: string[];
    if (process.platform === 'darwin') {
      command = 'open';
      args = [url];
    } else if (process.platform === 'win32') {
      command = 'explorer.exe';
      args = [url];
    } else {
      command = 'xdg-open';
      args = [url];
    }

    const result = spawnSync(command, args, {
      stdio: 'ignore',
      timeout: 5000,
      windowsHide: true,
    });
    if (result.error) {
      return false;
    }
    return result.status === 0;
  } catch {
    return false;
  }
}

export function deriveDashboardUrl(graphqlEndpoint: string | undefined): string {
  const raw = graphqlEndpoint?.trim() ?? '';
  if (!raw) {
    return DEFAULT_DASHBOARD_URL;
  }

  try {
    const parsed = new URL(raw);
    let pathname = parsed.pathname;
    if (pathname.endsWith('/v1/graphql')) {
      pathname = pathname.slice(0, -'/v1/graphql'.length);
    } else if (pathname.endsWith('/graphql')) {
      pathname = pathname.slice(0, -'/graphql'.length);
    } else {
      pathname = '';
    }
    return normalizeInstanceUrl(new URL(pathname || '/', parsed.origin).toString());
  } catch {
    return DEFAULT_DASHBOARD_URL;
  }
}

export function resolveDashboardInfo(
  env: NodeJS.ProcessEnv = process.env,
  deps: Pick<DashboardDeps, 'configExistsFn' | 'loadConfigFn'> = {},
): DashboardInfo {
  const explicitInstanceUrl = env.STATESET_INSTANCE_URL?.trim();
  if (explicitInstanceUrl) {
    return {
      source: 'instance_env',
      url: normalizeInstanceUrl(explicitInstanceUrl),
    };
  }

  const explicitGraphqlEndpoint = env.STATESET_GRAPHQL_ENDPOINT?.trim();
  if (explicitGraphqlEndpoint) {
    return {
      source: 'graphql_env',
      url: deriveDashboardUrl(explicitGraphqlEndpoint),
    };
  }

  const configExistsFn = deps.configExistsFn ?? configExists;
  const loadConfigFn = deps.loadConfigFn ?? loadConfig;
  if (configExistsFn()) {
    try {
      const config = loadConfigFn() as StateSetConfig;
      const currentOrg = config.currentOrg;
      const orgConfig = config.organizations[currentOrg];
      if (orgConfig?.graphqlEndpoint) {
        return {
          currentOrg,
          source: 'config',
          url: deriveDashboardUrl(orgConfig.graphqlEndpoint),
        };
      }
    } catch {
      // Fall back to the default app URL if config is missing or invalid.
    }
  }

  return {
    source: 'default',
    url: DEFAULT_DASHBOARD_URL,
  };
}

export async function runDashboardCommand(
  options: { json?: boolean; open?: boolean } = {},
  deps: DashboardDeps = {},
): Promise<number> {
  const log = deps.log ?? console.log;
  const error = deps.error ?? ((message: string) => console.error(message));
  const openBrowser = deps.openBrowser ?? tryOpenBrowser;
  const info = resolveDashboardInfo(process.env, deps);

  if (options.json) {
    log(
      JSON.stringify(
        {
          ...info,
          openRequested: Boolean(options.open),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  log('');
  log(chalk.bold('  response dashboard'));
  log('');
  log(`  URL: ${info.url}`);
  if (info.currentOrg) {
    log(`  Organization: ${info.currentOrg}`);
  }
  log(`  Source: ${info.source}`);

  if (!options.open) {
    log('');
    log(chalk.gray('  Use --open to launch this URL in your browser.'));
    return 0;
  }

  if (openBrowser(info.url)) {
    log(chalk.green('Opened dashboard in your browser.'));
    return 0;
  }

  error(formatError(`Unable to open a browser automatically. Open ${info.url} manually.`));
  return 1;
}

export function registerDashboardCommand(program: Command): void {
  program
    .command('dashboard')
    .alias('console')
    .description('Show the StateSet Response app URL for the active org and optionally open it')
    .option('--open', 'Open the dashboard in your default browser')
    .option('--json', 'Output dashboard info as JSON')
    .addHelpText(
      'after',
      [
        '',
        'Examples:',
        '  response dashboard',
        '  response dashboard --open',
        '  response dashboard --json',
        '',
      ].join('\n'),
    )
    .action(async (opts: { json?: boolean; open?: boolean }, command: Command) => {
      try {
        const exitCode = await runDashboardCommand({
          json: Boolean(opts.json) || getParentBooleanOption(command, 'json'),
          open: Boolean(opts.open),
        });
        process.exitCode = exitCode;
      } catch (err) {
        console.error(formatError(getErrorMessage(err)));
        process.exitCode = 1;
      }
    });
}
