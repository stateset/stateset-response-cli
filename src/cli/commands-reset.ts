import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import { getConfigPath } from '../config.js';
import { getErrorMessage } from '../lib/errors.js';
import { getSessionsDir, getStateSetDir } from '../session.js';
import { formatError } from '../utils/display.js';

export type ResetScope =
  | 'config'
  | 'sessions'
  | 'metrics'
  | 'events'
  | 'history'
  | 'permissions'
  | 'integrations'
  | 'all';

type ConcreteResetScope = Exclude<ResetScope, 'all'>;
type ResetTargetKind = 'file' | 'directory';

export interface ResetTarget {
  bytes: number;
  description: string;
  exists: boolean;
  kind: ResetTargetKind;
  path: string;
  scope: ConcreteResetScope;
}

export interface ResetPlan {
  bytesToRemove: number;
  configPath: string;
  stateDir: string;
  targets: ResetTarget[];
}

export interface ResetApplyResult {
  bytesRemoved: number;
  errors: string[];
  missing: ResetTarget[];
  removed: ResetTarget[];
}

interface ResetCommandOptions {
  dryRun?: boolean;
  json?: boolean;
  yes?: boolean;
}

interface ResetDeps {
  error?: (message: string) => void;
  existsSync?: typeof fs.existsSync;
  getConfigPathFn?: typeof getConfigPath;
  getSessionsDirFn?: typeof getSessionsDir;
  getStateSetDirFn?: typeof getStateSetDir;
  log?: (message: string) => void;
  lstatSync?: typeof fs.lstatSync;
  readdirSync?: typeof fs.readdirSync;
  rmSync?: typeof fs.rmSync;
}

const RESET_SCOPE_ORDER: ConcreteResetScope[] = [
  'config',
  'sessions',
  'metrics',
  'events',
  'history',
  'permissions',
  'integrations',
];

const RESET_SCOPE_DESCRIPTIONS: Record<ConcreteResetScope, string> = {
  config: 'CLI config, org selection, and stored credentials',
  sessions: 'Session transcripts and chat logs',
  metrics: 'Saved session metrics',
  events: 'Queued event files',
  history: 'Prompt history and integration telemetry',
  permissions: 'Saved tool permissions and policies',
  integrations: 'Global integration defaults',
};

function getParentBooleanOption(command: Command | undefined, name: string): boolean {
  if (!command?.parent) {
    return false;
  }
  return Boolean(command.parent.opts()?.[name]);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function getPathSize(
  targetPath: string,
  deps: Pick<ResetDeps, 'existsSync' | 'lstatSync' | 'readdirSync'> = {},
): number {
  const existsSync = deps.existsSync ?? fs.existsSync;
  const lstatSync = deps.lstatSync ?? fs.lstatSync;
  const readdirSync = deps.readdirSync ?? fs.readdirSync;

  if (!existsSync(targetPath)) {
    return 0;
  }

  let stats: fs.Stats;
  try {
    stats = lstatSync(targetPath);
  } catch {
    return 0;
  }

  if (!stats.isDirectory()) {
    return stats.size;
  }

  let total = 0;
  try {
    const entries = readdirSync(targetPath, { withFileTypes: true }) as fs.Dirent[];
    for (const entry of entries) {
      total += getPathSize(path.join(targetPath, entry.name), deps);
    }
  } catch {
    return total;
  }

  return total;
}

function normalizeResetScope(raw: string): ResetScope {
  const value = raw.trim().toLowerCase();
  if (!value) {
    throw new Error('Reset scope is required');
  }
  if (value === 'auth' || value === 'credentials') {
    return 'config';
  }
  if (value === 'telemetry') {
    return 'history';
  }
  if (
    value === 'config' ||
    value === 'sessions' ||
    value === 'metrics' ||
    value === 'events' ||
    value === 'history' ||
    value === 'permissions' ||
    value === 'integrations' ||
    value === 'all'
  ) {
    return value;
  }
  throw new Error(
    `Unknown reset scope "${raw}". Valid scopes: ${[...RESET_SCOPE_ORDER, 'all'].join(', ')}`,
  );
}

export function resolveResetScopes(values: string[]): ConcreteResetScope[] {
  if (values.length === 0) {
    throw new Error('Specify at least one reset scope.');
  }

  const selected = new Set<ConcreteResetScope>();
  for (const raw of values) {
    const scope = normalizeResetScope(raw);
    if (scope === 'all') {
      for (const entry of RESET_SCOPE_ORDER) {
        selected.add(entry);
      }
      continue;
    }
    selected.add(scope);
  }

  return RESET_SCOPE_ORDER.filter((scope) => selected.has(scope));
}

function createResetTargets(
  scope: ConcreteResetScope,
  paths: {
    configPath: string;
    sessionsDir: string;
    stateDir: string;
  },
): Array<Pick<ResetTarget, 'description' | 'kind' | 'path' | 'scope'>> {
  switch (scope) {
    case 'config':
      return [
        {
          scope,
          kind: 'file',
          path: paths.configPath,
          description: RESET_SCOPE_DESCRIPTIONS.config,
        },
      ];
    case 'sessions':
      return [
        {
          scope,
          kind: 'directory',
          path: paths.sessionsDir,
          description: RESET_SCOPE_DESCRIPTIONS.sessions,
        },
      ];
    case 'metrics':
      return [
        {
          scope,
          kind: 'directory',
          path: path.join(paths.stateDir, 'metrics'),
          description: RESET_SCOPE_DESCRIPTIONS.metrics,
        },
      ];
    case 'events':
      return [
        {
          scope,
          kind: 'directory',
          path: path.join(paths.stateDir, 'events'),
          description: RESET_SCOPE_DESCRIPTIONS.events,
        },
      ];
    case 'history':
      return [
        {
          scope,
          kind: 'file',
          path: path.join(paths.stateDir, 'prompt-history.jsonl'),
          description: RESET_SCOPE_DESCRIPTIONS.history,
        },
        {
          scope,
          kind: 'file',
          path: path.join(paths.stateDir, 'integration-telemetry.jsonl'),
          description: RESET_SCOPE_DESCRIPTIONS.history,
        },
      ];
    case 'permissions':
      return [
        {
          scope,
          kind: 'file',
          path: path.join(paths.stateDir, 'permissions.json'),
          description: RESET_SCOPE_DESCRIPTIONS.permissions,
        },
        {
          scope,
          kind: 'file',
          path: path.join(paths.stateDir, 'policies.json'),
          description: RESET_SCOPE_DESCRIPTIONS.permissions,
        },
      ];
    case 'integrations':
      return [
        {
          scope,
          kind: 'file',
          path: path.join(paths.stateDir, 'integrations.json'),
          description: RESET_SCOPE_DESCRIPTIONS.integrations,
        },
      ];
  }
}

export function buildResetPlan(scopes: string[], deps: ResetDeps = {}): ResetPlan {
  const getStateSetDirFn = deps.getStateSetDirFn ?? getStateSetDir;
  const getSessionsDirFn = deps.getSessionsDirFn ?? getSessionsDir;
  const getConfigPathFn = deps.getConfigPathFn ?? getConfigPath;
  const existsSync = deps.existsSync ?? fs.existsSync;
  const selectedScopes = resolveResetScopes(scopes);
  const stateDir = getStateSetDirFn();
  const sessionsDir = getSessionsDirFn();
  const configPath = getConfigPathFn();

  const deduped = new Map<string, ResetTarget>();
  for (const scope of selectedScopes) {
    for (const target of createResetTargets(scope, { stateDir, sessionsDir, configPath })) {
      if (deduped.has(target.path)) {
        continue;
      }
      const exists = existsSync(target.path);
      deduped.set(target.path, {
        ...target,
        exists,
        bytes: exists ? getPathSize(target.path, deps) : 0,
      });
    }
  }

  const targets = Array.from(deduped.values());
  return {
    stateDir,
    configPath,
    targets,
    bytesToRemove: targets.reduce((total, target) => total + target.bytes, 0),
  };
}

function assertSafeResetTarget(targetPath: string, stateDir: string, configPath: string): void {
  if (path.resolve(targetPath) === path.resolve(configPath)) {
    return;
  }
  if (isPathWithin(stateDir, targetPath)) {
    return;
  }
  throw new Error(`Refusing to remove path outside CLI state: ${targetPath}`);
}

export function applyResetPlan(plan: ResetPlan, deps: ResetDeps = {}): ResetApplyResult {
  const rmSync = deps.rmSync ?? fs.rmSync;
  const result: ResetApplyResult = {
    removed: [],
    missing: [],
    errors: [],
    bytesRemoved: 0,
  };

  for (const target of plan.targets) {
    if (!target.exists) {
      result.missing.push(target);
      continue;
    }

    try {
      assertSafeResetTarget(target.path, plan.stateDir, plan.configPath);
      rmSync(target.path, { recursive: target.kind === 'directory', force: true });
      result.removed.push(target);
      result.bytesRemoved += target.bytes;
    } catch (error) {
      result.errors.push(`${target.path}: ${getErrorMessage(error)}`);
    }
  }

  return result;
}

function printResetPlan(plan: ResetPlan, log: (message: string) => void): void {
  log('');
  log(chalk.bold('  response reset'));
  log('');
  log(`  State directory: ${plan.stateDir}`);
  log(`  Config path: ${plan.configPath}`);
  log(`  Matched targets: ${plan.targets.filter((target) => target.exists).length}`);
  log(`  Estimated reclaimed space: ${formatBytes(plan.bytesToRemove)}`);

  if (plan.targets.length === 0) {
    log('');
    log(chalk.gray('  No reset targets resolved.'));
    return;
  }

  log('');
  for (const target of plan.targets) {
    const status = target.exists ? chalk.yellow('[PLAN]') : chalk.gray('[SKIP]');
    log(`  ${status} ${target.scope}: ${target.path}`);
  }
}

export async function runResetCommand(
  scopes: string[],
  options: ResetCommandOptions = {},
  deps: ResetDeps = {},
): Promise<number> {
  const log = deps.log ?? console.log;
  const error = deps.error ?? ((message: string) => console.error(message));

  let plan: ResetPlan;
  try {
    plan = buildResetPlan(scopes, deps);
  } catch (err) {
    error(formatError(getErrorMessage(err)));
    return 1;
  }

  const applyChanges = Boolean(options.yes) && !options.dryRun;
  const matchedTargets = plan.targets.filter((target) => target.exists);

  if (!applyChanges) {
    if (options.json) {
      log(
        JSON.stringify(
          {
            applyRequested: false,
            dryRun: Boolean(options.dryRun),
            matchedTargets,
            missingTargets: plan.targets.filter((target) => !target.exists),
            bytesToRemove: plan.bytesToRemove,
            stateDir: plan.stateDir,
            configPath: plan.configPath,
          },
          null,
          2,
        ),
      );
      return 0;
    }

    printResetPlan(plan, log);
    log('');
    log(chalk.gray('  Preview only. Re-run with --yes to remove the matched targets.'));
    log('');
    return 0;
  }

  const result = applyResetPlan(plan, deps);

  if (options.json) {
    log(
      JSON.stringify(
        {
          applyRequested: true,
          dryRun: false,
          removed: result.removed,
          missing: result.missing,
          errors: result.errors,
          bytesRemoved: result.bytesRemoved,
          stateDir: plan.stateDir,
          configPath: plan.configPath,
        },
        null,
        2,
      ),
    );
    return result.errors.length > 0 ? 1 : 0;
  }

  log('');
  log(chalk.bold('  response reset'));
  log('');

  if (matchedTargets.length === 0) {
    log(chalk.gray('  No matching local state found for the requested scope(s).'));
    log('');
    return 0;
  }

  if (result.removed.length > 0) {
    log(
      chalk.green(
        `  Removed ${result.removed.length} target(s), reclaiming ${formatBytes(result.bytesRemoved)}.`,
      ),
    );
    for (const target of result.removed) {
      log(`  [REMOVED] ${target.scope}: ${target.path}`);
    }
  }

  if (result.missing.length > 0) {
    for (const target of result.missing) {
      log(chalk.gray(`  [SKIP] ${target.scope}: ${target.path}`));
    }
  }

  if (result.errors.length > 0) {
    for (const entry of result.errors) {
      error(formatError(entry));
    }
    log('');
    return 1;
  }

  log('');
  return 0;
}

export function registerResetCommand(program: Command): void {
  program
    .command('reset')
    .description('Preview or remove local CLI state in the active state directory')
    .argument('<scope...>', `Scopes: ${[...RESET_SCOPE_ORDER, 'all'].join(', ')}`)
    .option('--yes', 'Apply the reset instead of printing a preview')
    .option('--dry-run', 'Preview the reset plan without applying changes')
    .option('--json', 'Output the reset plan or result as JSON')
    .addHelpText(
      'after',
      [
        '',
        'Examples:',
        '  response reset sessions',
        '  response reset metrics history --yes',
        '  response reset all --json',
        '',
      ].join('\n'),
    )
    .action(
      async (scopes: string[], opts: ResetCommandOptions, command: Command): Promise<void> => {
        try {
          const exitCode = await runResetCommand(scopes, {
            yes: Boolean(opts.yes),
            dryRun: Boolean(opts.dryRun),
            json: Boolean(opts.json) || getParentBooleanOption(command, 'json'),
          });
          process.exitCode = exitCode;
        } catch (error) {
          console.error(formatError(getErrorMessage(error)));
          process.exitCode = 1;
        }
      },
    );
}
