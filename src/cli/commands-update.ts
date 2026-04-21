import { spawnSync } from 'node:child_process';
import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { getErrorMessage } from '../lib/errors.js';
import { formatError } from '../utils/display.js';
import { getUpdateStatus, type UpdateStatus } from '../utils/update-check.js';

const PACKAGE_NAME = 'stateset-response-cli';
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

type PackageManagerName = 'npm' | 'pnpm' | 'bun';
type InstallKind = 'source' | 'package';

interface InstallContext {
  kind: InstallKind;
  packageRoot: string;
}

interface CommandSpec {
  command: string;
  args: string[];
  display: string;
}

interface SourceStep extends CommandSpec {
  label: string;
}

interface UpdateSummary extends UpdateStatus {
  installKind: InstallKind;
  packageRoot: string;
  packageManager: PackageManagerName | null;
}

interface SpawnSyncResultLike {
  status: number | null;
  error?: Error;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

type SpawnSyncLike = (
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio?: 'ignore' | 'inherit' | ['ignore', 'pipe', 'pipe'] | ['inherit', 'inherit', 'inherit'];
    encoding?: BufferEncoding;
  },
) => SpawnSyncResultLike;

interface RuntimeDeps {
  env?: NodeJS.ProcessEnv;
  existsSync?: typeof fs.existsSync;
  spawnSyncFn?: SpawnSyncLike;
  log?: (message: string) => void;
  error?: (message: string) => void;
  resolveUpdateStatus?: typeof getUpdateStatus;
}

function getParentBooleanOption(command: Command | undefined, name: string): boolean {
  if (!command?.parent) {
    return false;
  }
  const value = command.parent.opts()?.[name];
  return Boolean(value);
}

export function detectInstallContext(
  packageRoot = PACKAGE_ROOT,
  existsSync: typeof fs.existsSync = fs.existsSync,
): InstallContext {
  const hasGitDir = existsSync(path.join(packageRoot, '.git'));
  const hasSourceTree =
    existsSync(path.join(packageRoot, 'src')) && existsSync(path.join(packageRoot, 'package.json'));
  return {
    kind: hasGitDir || hasSourceTree ? 'source' : 'package',
    packageRoot,
  };
}

function commandAvailable(
  command: string,
  spawnSyncFn: SpawnSyncLike,
  env: NodeJS.ProcessEnv,
): boolean {
  const result = spawnSyncFn(command, ['--version'], {
    env,
    stdio: 'ignore',
  });
  return !result.error && result.status === 0;
}

export function detectPackageManager(
  env: NodeJS.ProcessEnv = process.env,
  spawnSyncFn: SpawnSyncLike = spawnSync as SpawnSyncLike,
): PackageManagerName | null {
  const userAgent = env.npm_config_user_agent?.trim() ?? '';
  if (userAgent.startsWith('pnpm/')) {
    return 'pnpm';
  }
  if (userAgent.startsWith('bun/')) {
    return 'bun';
  }
  if (userAgent.startsWith('npm/')) {
    return 'npm';
  }

  for (const command of ['npm', 'pnpm', 'bun'] as const) {
    if (commandAvailable(command, spawnSyncFn, env)) {
      return command;
    }
  }
  return null;
}

export function buildPackageUpdateCommand(
  packageManager: PackageManagerName,
  versionTag = 'latest',
): CommandSpec {
  const target = `${PACKAGE_NAME}@${versionTag}`;
  switch (packageManager) {
    case 'pnpm':
      return {
        command: 'pnpm',
        args: ['add', '-g', target],
        display: `pnpm add -g ${target}`,
      };
    case 'bun':
      return {
        command: 'bun',
        args: ['add', '-g', target],
        display: `bun add -g ${target}`,
      };
    default:
      return {
        command: 'npm',
        args: ['install', '-g', target],
        display: `npm install -g ${target}`,
      };
  }
}

function buildSourceUpdateSteps(): SourceStep[] {
  return [
    {
      label: 'Fetch and rebase the current branch',
      command: 'git',
      args: ['pull', '--rebase'],
      display: 'git pull --rebase',
    },
    {
      label: 'Install locked dependencies',
      command: 'npm',
      args: ['ci'],
      display: 'npm ci',
    },
    {
      label: 'Build the CLI artifacts',
      command: 'npm',
      args: ['run', 'build'],
      display: 'npm run build',
    },
  ];
}

function readSpawnOutput(output: string | Buffer | undefined): string {
  if (typeof output === 'string') {
    return output;
  }
  return output ? output.toString('utf-8') : '';
}

function getSourceRepoState(
  packageRoot: string,
  spawnSyncFn: SpawnSyncLike,
  env: NodeJS.ProcessEnv,
): 'clean' | 'dirty' | 'unavailable' {
  const result = spawnSyncFn('git', ['status', '--porcelain'], {
    cwd: packageRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    return 'unavailable';
  }
  return readSpawnOutput(result.stdout).trim().length > 0 ? 'dirty' : 'clean';
}

async function resolveUpdateSummary(
  currentVersion: string,
  deps: RuntimeDeps = {},
): Promise<UpdateSummary> {
  const existsSync = deps.existsSync ?? fs.existsSync;
  const spawnSyncFn = deps.spawnSyncFn ?? (spawnSync as SpawnSyncLike);
  const env = deps.env ?? process.env;
  const resolveUpdateStatus = deps.resolveUpdateStatus ?? getUpdateStatus;
  const installContext = detectInstallContext(PACKAGE_ROOT, existsSync);
  const status = await resolveUpdateStatus(currentVersion, PACKAGE_NAME);

  return {
    ...status,
    installKind: installContext.kind,
    packageRoot: installContext.packageRoot,
    packageManager:
      installContext.kind === 'package' ? detectPackageManager(env, spawnSyncFn) : null,
  };
}

function printPrettyStatus(summary: UpdateSummary, log: (message: string) => void): void {
  log('');
  log(chalk.bold('  response update status'));
  log('');
  log(`  Current version: ${summary.currentVersion}`);
  log(`  Latest version: ${summary.latestVersion ?? 'unavailable'}`);
  log(`  Update available: ${summary.updateAvailable ? 'yes' : 'no'}`);
  log(`  Install type: ${summary.installKind}`);
  log(`  Package root: ${summary.packageRoot}`);
  if (summary.packageManager) {
    log(`  Package manager: ${summary.packageManager}`);
  }
  log(`  Version source: ${summary.source}`);
  if (summary.installKind === 'package' && summary.packageManager) {
    log(`  Apply with: ${buildPackageUpdateCommand(summary.packageManager).display}`);
  } else if (summary.installKind === 'source') {
    log('  Apply with: response update --yes');
  }
  log('');
}

export async function runUpdateStatusCommand(
  currentVersion: string,
  options: { json?: boolean } = {},
  deps: RuntimeDeps = {},
): Promise<number> {
  const log = deps.log ?? console.log;
  const summary = await resolveUpdateSummary(currentVersion, deps);

  if (options.json) {
    log(JSON.stringify(summary, null, 2));
    return 0;
  }

  printPrettyStatus(summary, log);
  return 0;
}

function runExternalCommand(
  spec: CommandSpec,
  packageRoot: string,
  spawnSyncFn: SpawnSyncLike,
  env: NodeJS.ProcessEnv,
): number {
  const result = spawnSyncFn(spec.command, spec.args, {
    cwd: packageRoot,
    env,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  return typeof result.status === 'number' ? result.status : 1;
}

export async function runUpdateCommand(
  currentVersion: string,
  options: { dryRun?: boolean; yes?: boolean } = {},
  deps: RuntimeDeps = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? console.log;
  const error = deps.error ?? ((message: string) => console.error(message));
  const spawnSyncFn = deps.spawnSyncFn ?? (spawnSync as SpawnSyncLike);
  const summary = await resolveUpdateSummary(currentVersion, deps);

  if (summary.installKind === 'package') {
    const packageManager = summary.packageManager;
    if (!packageManager) {
      error(formatError('No supported package manager was found. Install npm, pnpm, or bun.'));
      return 1;
    }

    if (summary.latestVersion && !summary.updateAvailable) {
      log(chalk.green(`Already up to date: ${summary.currentVersion}`));
      return 0;
    }

    const spec = buildPackageUpdateCommand(packageManager);
    log('');
    log(chalk.bold('  response update'));
    log('');
    log(`  Install type: package (${packageManager})`);
    log(`  Current version: ${summary.currentVersion}`);
    log(`  Latest version: ${summary.latestVersion ?? 'unavailable'}`);
    log(`  Planned command: ${spec.display}`);

    if (options.dryRun || !options.yes) {
      log('');
      log(
        chalk.gray(
          options.dryRun
            ? '  Dry run only. Re-run without --dry-run and with --yes to apply.'
            : '  Re-run with --yes to apply this update.',
        ),
      );
      return 0;
    }

    try {
      const status = runExternalCommand(spec, summary.packageRoot, spawnSyncFn, env);
      if (status !== 0) {
        error(formatError(`Update command failed with exit code ${status}.`));
        return status;
      }
      log(chalk.green('Update complete.'));
      return 0;
    } catch (err) {
      error(formatError(`Unable to run update command: ${getErrorMessage(err)}`));
      return 1;
    }
  }

  const repoState = getSourceRepoState(summary.packageRoot, spawnSyncFn, env);
  const steps = buildSourceUpdateSteps();

  log('');
  log(chalk.bold('  response update'));
  log('');
  log('  Install type: source checkout');
  log(`  Repository: ${summary.packageRoot}`);
  log(`  Current version: ${summary.currentVersion}`);
  log(`  Latest npm version: ${summary.latestVersion ?? 'unavailable'}`);
  log(`  Working tree: ${repoState}`);
  log('  Planned steps:');
  for (const step of steps) {
    log(`    - ${step.display}`);
  }

  if (repoState === 'dirty') {
    log('');
    error(formatError('Source checkout has uncommitted changes. Automatic update is blocked.'));
    return options.yes ? 1 : 0;
  }

  if (repoState === 'unavailable') {
    log('');
    error(
      formatError('Unable to inspect git status for this checkout. Run the update steps manually.'),
    );
    return options.yes ? 1 : 0;
  }

  if (options.dryRun || !options.yes) {
    log('');
    log(
      chalk.gray(
        options.dryRun
          ? '  Dry run only. Re-run without --dry-run and with --yes to apply.'
          : '  Re-run with --yes from this repository to apply the update.',
      ),
    );
    return 0;
  }

  for (const step of steps) {
    log(chalk.gray(`Running: ${step.display}`));
    try {
      const status = runExternalCommand(step, summary.packageRoot, spawnSyncFn, env);
      if (status !== 0) {
        error(formatError(`${step.display} failed with exit code ${status}.`));
        return status;
      }
    } catch (err) {
      error(formatError(`Unable to run "${step.display}": ${getErrorMessage(err)}`));
      return 1;
    }
  }

  log(chalk.green('Source checkout updated.'));
  return 0;
}

export function registerUpdateCommand(program: Command, currentVersion: string): void {
  const update = program
    .command('update')
    .description('Check for updates and apply the right update flow for this installation')
    .option('--yes', 'Apply the update plan instead of printing it');

  update
    .addHelpText(
      'after',
      [
        '',
        'Examples:',
        '  response update status',
        '  response update',
        '  response update --yes',
        '',
      ].join('\n'),
    )
    .action(async (opts: { yes?: boolean }, command: Command) => {
      try {
        const exitCode = await runUpdateCommand(currentVersion, {
          yes: Boolean(opts.yes),
          dryRun: getParentBooleanOption(command, 'dryRun'),
        });
        process.exitCode = exitCode;
      } catch (err) {
        console.error(formatError(getErrorMessage(err)));
        process.exitCode = 1;
      }
    });

  update
    .command('status')
    .description('Show installed version, latest npm version, and update strategy')
    .option('--json', 'Output update status as JSON')
    .action(async (opts: { json?: boolean }, command: Command) => {
      try {
        const exitCode = await runUpdateStatusCommand(
          currentVersion,
          {
            json: Boolean(opts.json) || getParentBooleanOption(command, 'json'),
          },
          {},
        );
        process.exitCode = exitCode;
      } catch (err) {
        console.error(formatError(getErrorMessage(err)));
        process.exitCode = 1;
      }
    });
}
