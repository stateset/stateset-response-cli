import fs from 'node:fs';
import path from 'node:path';
import { getCategoryOrder, getCommandNames, getRegisteredCommands } from './command-registry.js';
import { listSessionSummaries } from './session-meta.js';
import { MODEL_ALIAS_NAMES } from '../config.js';
import { listPromptTemplates, listSkills } from '../resources.js';
import { listIntegrations } from '../integrations/registry.js';
import { listCapabilityAreas } from './capabilities.js';
import { loadBrandStudioBundle } from '../lib/brand-studio.js';
import { readEngineCompletionCache } from './engine-completion-cache.js';
import {
  getCompletionFlags,
  getCompletionFlagValues,
  getSlashPositionalHints,
  resolveSlashCompletionHintPath,
} from './completion-hints.js';

/**
 * Context-aware tab completer for the CLI readline interface.
 * Completes slash command names and their arguments.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const TTL_MS = 5000;
let sessionCache: CacheEntry<string[]> | null = null;
const localBrandCache = new Map<string, CacheEntry<string[]>>();
const localConnectorCache = new Map<string, CacheEntry<string[]>>();
const engineRefCache = new Map<string, CacheEntry<string[]>>();

function getCachedSessionIds(): string[] {
  const now = Date.now();
  if (sessionCache && sessionCache.expiresAt > now) {
    return sessionCache.data;
  }
  try {
    const summaries = listSessionSummaries({ includeArchived: true });
    const ids = summaries.map((s) => s.id);
    sessionCache = { data: ids, expiresAt: now + TTL_MS };
    return ids;
  } catch {
    return [];
  }
}

/** Invalidate the session cache (e.g., after session switch). */
export function invalidateCompleterCache(): void {
  sessionCache = null;
  localBrandCache.clear();
  localConnectorCache.clear();
  engineRefCache.clear();
}

const TOGGLE_VALUES = ['on', 'off'];
const EXPORT_FORMATS = ['md', 'json', 'jsonl'];
const METRICS_SUBS = ['json', 'reset'];
const INTEGRATIONS_SUBS = ['status', 'setup', 'health', 'limits', 'logs'];
const INTEGRATIONS_FLAG_SUBS = ['--detailed', '--last'];
const FINETUNE_SUBS = ['list', 'export', 'validate', 'create', 'deploy'];

const RULES_SUBS = ['get', 'list', 'create', 'toggle', 'delete', 'import', 'export', 'agent'];
const WEBHOOKS_SUBS = ['list', 'get', 'create', 'update', 'deliveries', 'logs', 'delete'];
const EVALS_SUBS = [
  'list',
  'create',
  'create-from-response',
  'get',
  'update',
  'delete',
  'export',
  'review',
  'suggest',
];
const DATASETS_SUBS = [
  'list',
  'create',
  'get',
  'update',
  'delete',
  'add-entry',
  'update-entry',
  'delete-entry',
  'import',
  'export',
];
const KB_SUBS = ['search', 'add', 'delete', 'scroll', 'list', 'info'];
const AGENTS_SUBS = ['list', 'get', 'create', 'switch', 'export', 'import', 'bootstrap'];
const POLICY_SUBS = ['list', 'set', 'unset', 'clear', 'edit', 'init', 'import', 'export'];
const TAG_SUBS = ['list', 'add', 'remove'];
const CAPABILITY_AREAS = listCapabilityAreas().map((area) => area.id);

function getHelpTopics(): string[] {
  return Array.from(
    new Set([
      ...getCategoryOrder(),
      ...getRegisteredCommands().map((cmd) => cmd.name),
      ...getCommandNames(),
    ]),
  ).sort((a, b) => a.localeCompare(b));
}

function filterHelpTopics(partial: string): string[] {
  const normalized = partial.trim().toLowerCase().replace(/^\//, '');
  const topics = getHelpTopics();
  if (!normalized) {
    return topics;
  }
  return topics.filter((topic) => topic.toLowerCase().replace(/^\//, '').startsWith(normalized));
}

function getPromptTemplateNames(cwd: string): string[] {
  try {
    return listPromptTemplates(cwd).map((template) => template.name);
  } catch {
    return [];
  }
}

function getSkillNames(cwd: string): string[] {
  try {
    return listSkills(cwd).map((skill) => skill.name);
  } catch {
    return [];
  }
}

function getIntegrationIds(): string[] {
  return listIntegrations().map((integration) => integration.id);
}

function toCompletionPath(value: string): string {
  return value.split(path.sep).join('/');
}

function listFilesystemCandidates(
  partial: string,
  cwd: string,
  options: {
    assignmentPrefix?: string;
    allowedExtensions?: string[];
  } = {},
): string[] {
  const assignmentPrefix = options.assignmentPrefix ?? '';
  if (assignmentPrefix && partial && !partial.startsWith(assignmentPrefix)) {
    return [];
  }

  const rawPath = assignmentPrefix ? partial.slice(assignmentPrefix.length) : partial;
  const normalizedInput = rawPath.replace(/\\/g, '/');
  const endsWithSlash = normalizedInput.endsWith('/');
  const dirnamePart = !normalizedInput
    ? ''
    : endsWithSlash
      ? normalizedInput.slice(0, -1)
      : path.posix.dirname(normalizedInput) === '.'
        ? ''
        : path.posix.dirname(normalizedInput);
  const basenamePart =
    !normalizedInput || endsWithSlash ? '' : path.posix.basename(normalizedInput);
  const lookupDir = dirnamePart ? path.resolve(cwd, dirnamePart) : path.resolve(cwd);

  try {
    const entries = fs.readdirSync(lookupDir, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.name.startsWith(basenamePart))
      .flatMap((entry) => {
        const relativePath = dirnamePart ? `${dirnamePart}/${entry.name}` : entry.name;
        const completionPath = toCompletionPath(relativePath);
        if (entry.isDirectory()) {
          return [`${assignmentPrefix}${completionPath}/`];
        }
        if (
          options.allowedExtensions &&
          !options.allowedExtensions.some((extension) => entry.name.endsWith(extension))
        ) {
          return [];
        }
        return [`${assignmentPrefix}${completionPath}`];
      });
    return candidates.sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function hasBrandStudioMarkers(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, 'manifest.json')) ||
    fs.existsSync(path.join(dir, 'automation-config.json')) ||
    fs.existsSync(path.join(dir, 'connectors.json')) ||
    fs.existsSync(path.join(dir, 'connectors', 'connectors.json'))
  );
}

function getCachedLocalBrandRefs(cwd: string): string[] {
  const resolvedCwd = path.resolve(cwd);
  const now = Date.now();
  const cached = localBrandCache.get(resolvedCwd);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  try {
    const statesetDir = path.join(resolvedCwd, '.stateset');
    const brands = fs
      .readdirSync(statesetDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name !== 'snapshots' && !name.startsWith('.'))
      .filter((name) => hasBrandStudioMarkers(path.join(statesetDir, name)))
      .sort((a, b) => a.localeCompare(b));
    localBrandCache.set(resolvedCwd, { data: brands, expiresAt: now + TTL_MS });
    return brands;
  } catch {
    localBrandCache.set(resolvedCwd, { data: [], expiresAt: now + TTL_MS });
    return [];
  }
}

function getCachedLocalConnectorRefs(brandRef: string, cwd: string): string[] {
  const resolvedCwd = path.resolve(cwd);
  const cacheKey = `${resolvedCwd}::${brandRef}`;
  const now = Date.now();
  const cached = localConnectorCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  try {
    const bundle = loadBrandStudioBundle(brandRef, resolvedCwd);
    const refs = new Set<string>();
    for (const connector of bundle.connectors as unknown as Array<Record<string, unknown>>) {
      for (const value of [
        connector.id,
        connector.connector_id,
        connector.connectorId,
        connector.connector_key,
        connector.key,
      ]) {
        const text = String(value ?? '').trim();
        if (text) {
          refs.add(text);
        }
      }
    }
    const values = Array.from(refs).sort((a, b) => a.localeCompare(b));
    localConnectorCache.set(cacheKey, { data: values, expiresAt: now + TTL_MS });
    return values;
  } catch {
    localConnectorCache.set(cacheKey, { data: [], expiresAt: now + TTL_MS });
    return [];
  }
}

function getCachedEngineRefs(
  brandRef: string,
  cwd: string,
  field: 'onboardingRunIds' | 'dlqItemIds',
): string[] {
  const resolvedCwd = path.resolve(cwd);
  const cacheKey = `${resolvedCwd}::${brandRef}::${field}`;
  const now = Date.now();
  const cached = engineRefCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const next = readEngineCompletionCache(brandRef, resolvedCwd)?.[field] ?? [];
  engineRefCache.set(cacheKey, { data: next, expiresAt: now + TTL_MS });
  return next;
}

function getSlashIdentifierHints(parts: string[], cwd: string): string[] {
  if (parts[0] !== '/engine') {
    return [];
  }

  const engineCommand = parts[1]?.toLowerCase();
  if (!engineCommand) {
    return [];
  }

  const brandRefs = getCachedLocalBrandRefs(cwd);
  switch (engineCommand) {
    case 'brands': {
      const action = parts[2]?.toLowerCase();
      if (
        (action === 'show' || action === 'bootstrap' || action === 'update') &&
        parts.length <= 4
      ) {
        return brandRefs;
      }
      return [];
    }

    case 'onboard': {
      const action = parts[2]?.toLowerCase();
      if ((action === 'list' || action === 'show' || action === 'update') && parts.length <= 4) {
        return brandRefs;
      }
      if ((action === 'show' || action === 'update') && parts[3] && parts.length <= 5) {
        return getCachedEngineRefs(parts[3], cwd, 'onboardingRunIds');
      }
      return [];
    }

    case 'config': {
      const action = parts[2]?.toLowerCase();
      if (
        (action === 'show' ||
          action === 'pull' ||
          action === 'push' ||
          action === 'validate' ||
          action === 'history') &&
        parts.length <= 4
      ) {
        return brandRefs;
      }
      return [];
    }

    case 'activate':
    case 'validate':
    case 'executions':
    case 'test':
    case 'event':
      return parts.length <= 3 ? brandRefs : [];

    case 'connectors':
      if (parts.length <= 3) {
        return brandRefs;
      }
      if (parts[3]?.toLowerCase() === 'health' && parts.length <= 5) {
        return getCachedLocalConnectorRefs(parts[2] ?? '', cwd);
      }
      return [];

    case 'local':
      return parts[2]?.toLowerCase() === 'apply' && parts.length <= 4 ? brandRefs : [];

    case 'dlq': {
      const action = parts[2]?.toLowerCase();
      if ((action === 'retry' || action === 'resolve') && parts.length <= 4) {
        return brandRefs;
      }
      if ((action === 'retry' || action === 'resolve') && parts[3] && parts.length <= 5) {
        return getCachedEngineRefs(parts[3], cwd, 'dlqItemIds');
      }
      return [];
    }

    default:
      return [];
  }
}

function getSlashPathHints(parts: string[], cwd: string): string[] {
  if (parts[0] !== '/engine') {
    return [];
  }

  const partial = parts[parts.length - 1] || '';
  const jsonFileExtensions = ['.json', '.jsonl'];

  if (parts[1] === 'brands') {
    if (parts[2] === 'create' && parts.length <= 4) {
      return listFilesystemCandidates(partial, cwd, { allowedExtensions: jsonFileExtensions });
    }
    if (parts[2] === 'update' && parts[3] && parts.length <= 5) {
      return listFilesystemCandidates(partial, cwd, { allowedExtensions: jsonFileExtensions });
    }
  }

  if (parts[1] === 'connectors') {
    if (parts[3] === 'create' && parts.length <= 5) {
      return listFilesystemCandidates(partial, cwd, { allowedExtensions: jsonFileExtensions });
    }
    if (parts[3] === 'env' && partial.startsWith('out=')) {
      return listFilesystemCandidates(partial, cwd, { assignmentPrefix: 'out=' });
    }
  }

  if (parts[1] === 'event' && parts[2] && parts.length <= 4) {
    return listFilesystemCandidates(partial, cwd, { allowedExtensions: jsonFileExtensions });
  }

  if (parts[1] === 'migration' && parts[2] === 'update' && parts[3] && parts.length <= 5) {
    return listFilesystemCandidates(partial, cwd, { allowedExtensions: jsonFileExtensions });
  }

  if (parts[1] === 'templates') {
    if (parts[2] === 'create' && parts.length <= 4) {
      return listFilesystemCandidates(partial, cwd, { allowedExtensions: jsonFileExtensions });
    }
    if (parts[2] === 'update' && parts[3] && parts[4] && parts.length <= 6) {
      return listFilesystemCandidates(partial, cwd, { allowedExtensions: jsonFileExtensions });
    }
  }

  if (parts[1] === 'policy-sets') {
    if (parts[2] === 'create' && parts.length <= 4) {
      return listFilesystemCandidates(partial, cwd, { allowedExtensions: jsonFileExtensions });
    }
    if (parts[2] === 'update' && parts[3] && parts[4] && parts.length <= 6) {
      return listFilesystemCandidates(partial, cwd, { allowedExtensions: jsonFileExtensions });
    }
  }

  if (parts[1] === 'local' && parts[2] === 'apply' && parts[3]) {
    if (partial.startsWith('compose=')) {
      return listFilesystemCandidates(partial, cwd, {
        assignmentPrefix: 'compose=',
        allowedExtensions: ['.yml', '.yaml'],
      });
    }
    if (partial.startsWith('out=')) {
      return listFilesystemCandidates(partial, cwd, { assignmentPrefix: 'out=' });
    }
  }

  return [];
}

function completeArgs(parts: string[], cwd: string): string[] {
  const command = parts[0];
  const partial = parts[parts.length - 1] || '';
  const subcommand = parts[1];
  const previous = parts[parts.length - 2] || '';
  const hintPath = resolveSlashCompletionHintPath(parts);

  if (previous.startsWith('--')) {
    const flagValues = getCompletionFlagValues(hintPath, previous);
    if (flagValues.length > 0) {
      return filterPrefix(flagValues, partial);
    }
  }

  if (partial.startsWith('--')) {
    const flags = getCompletionFlags(hintPath);
    if (flags.length > 0) {
      return filterPrefix(flags, partial);
    }
  }

  const pathHints = getSlashPathHints(parts, cwd);
  if (pathHints.length > 0) {
    const filteredPathHints = filterPrefix(pathHints, partial);
    if (filteredPathHints.length > 0) {
      return filteredPathHints;
    }
  }

  const positionalHints = getSlashPositionalHints(parts);
  if (positionalHints.length > 0) {
    const filteredPositionalHints = filterPrefix(positionalHints, partial);
    if (filteredPositionalHints.length > 0) {
      return filteredPositionalHints;
    }
  }

  const identifierHints = getSlashIdentifierHints(parts, cwd);
  if (identifierHints.length > 0) {
    const filteredIdentifierHints = filterPrefix(identifierHints, partial);
    if (filteredIdentifierHints.length > 0) {
      return filteredIdentifierHints;
    }
  }

  switch (command) {
    case '/help':
    case '/commands':
      return filterHelpTopics(partial);

    case '/capabilities':
    case '/caps':
      return filterPrefix(CAPABILITY_AREAS, partial);

    case '/model':
    case '/m':
      return filterPrefix([...MODEL_ALIAS_NAMES], partial);

    case '/resume':
    case '/delete':
    case '/archive':
    case '/unarchive':
    case '/rename':
      return filterPrefix(getCachedSessionIds(), partial);

    case '/export': {
      // Could be session ID or format
      const formats = filterPrefix(EXPORT_FORMATS, partial);
      const sessions = filterPrefix(getCachedSessionIds(), partial);
      return [...formats, ...sessions].slice(0, 10);
    }

    case '/apply':
    case '/redact':
    case '/usage':
    case '/audit':
    case '/agentic':
      return filterPrefix(TOGGLE_VALUES, partial);

    case '/metrics':
      return filterPrefix(METRICS_SUBS, partial);

    case '/integrations':
      if (parts.length <= 2) {
        return filterPrefix(INTEGRATIONS_SUBS, partial);
      }
      if (subcommand === 'health') {
        if (partial.startsWith('--')) {
          return filterPrefix(['--detailed'], partial);
        }
        if (previous === '--detailed') {
          return [];
        }
        return filterPrefix(getIntegrationIds(), partial);
      }
      if (subcommand === 'limits' || subcommand === 'setup') {
        return filterPrefix(getIntegrationIds(), partial);
      }
      if (subcommand === 'logs') {
        if (partial.startsWith('--')) {
          return filterPrefix(['--last'], partial);
        }
        if (previous === '--last') {
          return [];
        }
        return filterPrefix(getIntegrationIds(), partial);
      }
      return filterPrefix(INTEGRATIONS_FLAG_SUBS, partial);

    case '/rules':
    case '/r':
      return filterPrefix(RULES_SUBS, partial);

    case '/webhooks':
      return filterPrefix(WEBHOOKS_SUBS, partial);

    case '/evals':
      return filterPrefix(EVALS_SUBS, partial);

    case '/datasets':
      return filterPrefix(DATASETS_SUBS, partial);

    case '/finetune':
      return filterPrefix(FINETUNE_SUBS, partial);

    case '/kb':
      return filterPrefix(KB_SUBS, partial);

    case '/agents':
    case '/a':
      return filterPrefix(AGENTS_SUBS, partial);

    case '/policy':
      return filterPrefix(POLICY_SUBS, partial);

    case '/tag':
      return filterPrefix(TAG_SUBS, partial);

    case '/engine':
      if (subcommand === 'config') {
        return filterPrefix(['show', 'pull', 'push', 'validate', 'history'], partial);
      }
      if (subcommand === 'brands') {
        return filterPrefix(['show', 'create', 'bootstrap', 'update'], partial);
      }
      if (subcommand === 'connectors') {
        return filterPrefix(['create', 'health', 'plan', 'sync', 'env'], partial);
      }
      if (subcommand === 'local') {
        return filterPrefix(['apply'], partial);
      }
      if (subcommand === 'onboard') {
        return filterPrefix(['list', 'show', 'update'], partial);
      }
      if (subcommand === 'migration') {
        return filterPrefix(['update'], partial);
      }
      if (subcommand === 'dlq') {
        return filterPrefix(['retry', 'resolve'], partial);
      }
      if (subcommand === 'templates') {
        return filterPrefix(['create', 'update'], partial);
      }
      if (subcommand === 'policy-sets') {
        return filterPrefix(['get', 'create', 'update'], partial);
      }
      return filterPrefix(
        [
          'setup',
          'status',
          'init',
          'config',
          'activate',
          'dispatch-health',
          'dispatch-guard',
          'validate',
          'brands',
          'connectors',
          'local',
          'executions',
          'event',
          'migration',
          'onboard',
          'parity',
          'policy-sets',
          'health',
          'test',
          'templates',
          'dlq',
        ],
        partial,
      );

    case '/workflows':
      return filterPrefix(
        ['list', 'start', 'status', 'cancel', 'terminate', 'restart', 'review', 'retry'],
        partial,
      );

    case '/prompt':
      return filterPrefix(getPromptTemplateNames(cwd), partial);

    case '/prompt-validate':
      return filterPrefix(['all', ...getPromptTemplateNames(cwd)], partial);

    case '/skill':
      return filterPrefix(getSkillNames(cwd), partial);

    default:
      return [];
  }
}

function filterPrefix(candidates: readonly string[], partial: string): string[] {
  if (!partial) return [...candidates];
  return candidates.filter((c) => c.startsWith(partial));
}

/**
 * Smart tab completer. Call as: `readline.createInterface({ completer: smartCompleter })`.
 */
export function smartCompleter(
  line: string,
  extensionCommands: string[] = [],
  cwd: string = process.cwd(),
): [string[], string] {
  if (!line.startsWith('/')) return [[], line];

  const parts = line.split(/\s+/);

  // Still typing the command name
  if (parts.length === 1) {
    const normalizedExtensions = extensionCommands.map((name) =>
      name.startsWith('/') ? name : `/${name}`,
    );
    const allCommands = Array.from(new Set([...getCommandNames(), ...normalizedExtensions]));
    const hits = allCommands.filter((cmd) => cmd.startsWith(line));
    return [hits.length > 0 ? hits : allCommands, line];
  }

  // Completing arguments
  const partial = parts[parts.length - 1] || '';
  const argHits = completeArgs(parts, cwd);
  if (argHits.length > 0) {
    return [argHits, partial];
  }

  return [[], line];
}
