import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_LOCAL_STACK_SERVICES = ['api', 'worker', 'dispatcher', 'tools'] as const;

export interface LocalStackApplyCommandOptions {
  cwd?: string;
  composeFilePath?: string;
  envFilePath: string;
  services?: string[];
}

export interface LocalStackApplyCommand {
  composeFilePath: string;
  composeProjectDir: string;
  envFilePath: string;
  services: string[];
  args: string[];
  command: string;
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@=+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function resolveCandidatePath(candidate: string, cwd: string): string {
  return path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(cwd, candidate);
}

export function parseLocalStackServices(value?: string): string[] {
  const parsed = value
    ?.split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const next = parsed && parsed.length > 0 ? parsed : [...DEFAULT_LOCAL_STACK_SERVICES];

  for (const service of next) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(service)) {
      throw new Error(
        `Invalid local stack service "${service}". Use a comma-separated list such as api,worker,dispatcher,tools.`,
      );
    }
  }

  return uniqueValues(next);
}

export function resolveLocalStackComposeFile(cwd = process.cwd(), explicitPath?: string): string {
  const candidates: string[] = [];
  if (explicitPath?.trim()) {
    candidates.push(explicitPath.trim());
  } else if (process.env.STATESET_ENGINE_LOCAL_COMPOSE_FILE?.trim()) {
    candidates.push(process.env.STATESET_ENGINE_LOCAL_COMPOSE_FILE.trim());
  }

  if (candidates.length === 0) {
    candidates.push(
      '../next-temporal-rs/deploy/local/docker-compose.yml',
      'deploy/local/docker-compose.yml',
      '../deploy/local/docker-compose.yml',
    );
  }

  const attempted = candidates.map((candidate) => resolveCandidatePath(candidate, cwd));
  for (const resolved of attempted) {
    if (!fs.existsSync(resolved)) {
      continue;
    }
    const stats = fs.statSync(resolved);
    if (stats.isFile()) {
      return resolved;
    }
  }

  const source = explicitPath?.trim()
    ? '--compose-file'
    : process.env.STATESET_ENGINE_LOCAL_COMPOSE_FILE?.trim()
      ? 'STATESET_ENGINE_LOCAL_COMPOSE_FILE'
      : 'default search paths';
  throw new Error(
    `Unable to find the local engine compose file from ${source}. Tried: ${attempted.join(', ')}`,
  );
}

export function buildLocalStackApplyCommand(
  options: LocalStackApplyCommandOptions,
): LocalStackApplyCommand {
  const cwd = options.cwd ?? process.cwd();
  const envFilePath = path.resolve(options.envFilePath);
  const composeFilePath = resolveLocalStackComposeFile(cwd, options.composeFilePath);
  const composeProjectDir = path.dirname(composeFilePath);
  const services = uniqueValues(options.services ?? [...DEFAULT_LOCAL_STACK_SERVICES]);
  const args = [
    'compose',
    '--env-file',
    envFilePath,
    '-f',
    composeFilePath,
    'up',
    '-d',
    ...services,
  ];

  return {
    composeFilePath,
    composeProjectDir,
    envFilePath,
    services,
    args,
    command: ['docker', ...args].map(quoteShellArg).join(' '),
  };
}
