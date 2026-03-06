import { getCategoryOrder, getCommandNames, getRegisteredCommands } from './command-registry.js';
import { listSessionSummaries } from './session-meta.js';
import { MODEL_ALIAS_NAMES } from '../config.js';
import { listPromptTemplates, listSkills } from '../resources.js';
import { listIntegrations } from '../integrations/registry.js';

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
}

const TOGGLE_VALUES = ['on', 'off'];
const EXPORT_FORMATS = ['md', 'json', 'jsonl'];
const METRICS_SUBS = ['json', 'reset'];
const INTEGRATIONS_SUBS = ['status', 'setup', 'health', 'limits', 'logs'];
const INTEGRATIONS_FLAG_SUBS = ['--detailed', '--last'];

const RULES_SUBS = ['get', 'list', 'create', 'toggle', 'delete', 'import', 'export', 'agent'];
const KB_SUBS = ['search', 'add', 'delete', 'scroll', 'list', 'info'];
const AGENTS_SUBS = ['list', 'get', 'create', 'switch', 'export', 'import', 'bootstrap'];
const POLICY_SUBS = ['list', 'set', 'unset', 'clear', 'edit', 'init', 'import', 'export'];
const TAG_SUBS = ['list', 'add', 'remove'];

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

function completeArgs(parts: string[], cwd: string): string[] {
  const command = parts[0];
  const partial = parts[parts.length - 1] || '';
  const subcommand = parts[1];
  const previous = parts[parts.length - 2] || '';

  switch (command) {
    case '/help':
    case '/commands':
      return filterHelpTopics(partial);

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

    case '/kb':
      return filterPrefix(KB_SUBS, partial);

    case '/agents':
    case '/a':
      return filterPrefix(AGENTS_SUBS, partial);

    case '/policy':
      return filterPrefix(POLICY_SUBS, partial);

    case '/tag':
      return filterPrefix(TAG_SUBS, partial);

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
  const command = parts[0];

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
