import { getCommandNames } from './command-registry.js';
import { listSessionSummaries } from './session-meta.js';
import { MODEL_ALIAS_NAMES } from '../config.js';

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

const RULES_SUBS = ['get', 'list', 'create', 'toggle', 'delete', 'import', 'export', 'agent'];
const KB_SUBS = ['search', 'add', 'delete', 'scroll', 'list', 'info'];
const AGENTS_SUBS = ['list', 'get', 'create', 'switch', 'export', 'import', 'bootstrap'];
const POLICY_SUBS = ['list', 'set', 'unset', 'clear', 'edit', 'init', 'import', 'export'];
const TAG_SUBS = ['list', 'add', 'remove'];

function completeArgs(command: string, partial: string): string[] {
  switch (command) {
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
export function smartCompleter(line: string, extensionCommands: string[] = []): [string[], string] {
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
  const argHits = completeArgs(command, partial);
  if (argHits.length > 0) {
    return [argHits, partial];
  }

  return [[], line];
}
