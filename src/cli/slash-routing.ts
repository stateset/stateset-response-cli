import { getCommandNames } from './command-registry.js';
import { levenshteinDistance } from './fuzzy.js';
import type { CommandResult } from './types.js';

export type SlashRouteAction = 'send' | 'prompt' | 'handled' | 'ignore';

export type SlashInputAction = 'send' | 'prompt' | 'handled' | 'exit' | 'unhandled';

let knownSlashCommands: string[] | null = null;

function getKnownSlashCommands(): string[] {
  if (knownSlashCommands === null) {
    knownSlashCommands = getCommandNames();
  }
  return knownSlashCommands;
}

export function resolveSlashRouteAction(routeResult: CommandResult): SlashRouteAction {
  if (routeResult.handled !== true) return 'ignore';

  if (typeof routeResult.sendMessage === 'string' && routeResult.sendMessage.trim().length > 0) {
    return 'send';
  }

  if (routeResult.needsPrompt === true) {
    return 'prompt';
  }

  if (routeResult.needsPrompt !== undefined && routeResult.needsPrompt !== false) {
    return 'prompt';
  }

  return 'handled';
}

export function getSlashCommandSuggestions(
  input: string,
  extensionCommands: string[] = [],
): string[] {
  const command = input.split(/\s+/)[0] ?? '';
  if (!command.startsWith('/')) return [];
  if (command.length <= 1) return [];

  const normalizedExtensions = extensionCommands.map((name) =>
    name.startsWith('/') ? name : `/${name}`,
  );
  const knownCommands = Array.from(new Set([...getKnownSlashCommands(), ...normalizedExtensions]));

  const exactPrefix = knownCommands.filter((value) => value.startsWith(command));
  if (exactPrefix.length > 0) {
    return exactPrefix.slice(0, 6);
  }

  return knownCommands
    .map((candidate) => ({
      candidate,
      distance: levenshteinDistance(command, candidate),
    }))
    .filter((entry) => entry.distance <= 3)
    .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate))
    .slice(0, 3)
    .map((entry) => entry.candidate);
}

export function resolveSlashInputAction(
  input: string,
  routeResult: CommandResult,
): SlashInputAction {
  const routeAction = resolveSlashRouteAction(routeResult);
  if (routeAction === 'send') return 'send';
  if (routeAction === 'prompt') return 'prompt';
  if (routeAction === 'handled') return 'handled';
  if (input === '/exit' || input === '/quit') return 'exit';
  return 'unhandled';
}
