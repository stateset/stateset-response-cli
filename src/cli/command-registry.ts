import { getModelAliasText } from '../config.js';

export type CommandCategory =
  | 'core'
  | 'safety'
  | 'integrations'
  | 'sessions'
  | 'shortcuts'
  | 'exports'
  | 'prompts'
  | 'extensions';

export interface CommandDefinition {
  name: string;
  aliases?: string[];
  usage: string;
  description: string;
  category: CommandCategory;
  /** When true the entry appears in help text but not in tab completion. */
  helpOnly?: boolean;
}

const registry: CommandDefinition[] = [];

export function registerCommand(def: CommandDefinition): void {
  registry.push(def);
}

export function getRegisteredCommands(): CommandDefinition[] {
  return [...registry];
}

export function getCommandNames(): string[] {
  const names: string[] = [];
  for (const def of registry) {
    if (def.helpOnly) continue;
    names.push(def.name);
    if (def.aliases) {
      for (const alias of def.aliases) {
        names.push(alias);
      }
    }
  }
  return names;
}

export function getCommandsByCategory(): Map<CommandCategory, CommandDefinition[]> {
  const map = new Map<CommandCategory, CommandDefinition[]>();
  for (const def of registry) {
    const list = map.get(def.category);
    if (list) {
      list.push(def);
    } else {
      map.set(def.category, [def]);
    }
  }
  return map;
}

const CATEGORY_ORDER: CommandCategory[] = [
  'core',
  'safety',
  'integrations',
  'sessions',
  'shortcuts',
  'exports',
  'prompts',
  'extensions',
];

const CATEGORY_LABELS: Record<CommandCategory, string> = {
  core: 'Core',
  safety: 'Safety & Policy',
  integrations: 'Integrations',
  sessions: 'Sessions',
  shortcuts: 'Shortcut Commands',
  exports: 'Exports',
  prompts: 'Prompts & Skills',
  extensions: 'Extensions',
};

export function getCategoryOrder(): CommandCategory[] {
  return [...CATEGORY_ORDER];
}

export function getCategoryLabel(category: CommandCategory): string {
  return CATEGORY_LABELS[category];
}

export function registerAllCommands(): void {
  // Avoid double-registration if called more than once
  if (registry.length > 0) return;

  // ── Core ──────────────────────────────────────────────────────────
  registerCommand({
    name: '/help',
    aliases: ['/commands'],
    usage: '/help',
    description: 'Show this help message',
    category: 'core',
  });
  registerCommand({
    name: '/clear',
    usage: '/clear',
    description: 'Reset conversation history',
    category: 'core',
  });
  registerCommand({
    name: '/history',
    usage: '/history',
    description: 'Show conversation turn count',
    category: 'core',
  });
  registerCommand({
    name: '/model',
    usage: '/model <name>',
    description: `Switch model (${getModelAliasText('list')})`,
    category: 'core',
  });
  registerCommand({
    name: '/usage',
    usage: '/usage on|off',
    description: 'Enable or disable usage summaries',
    category: 'core',
  });
  registerCommand({
    name: '/metrics',
    usage: '/metrics [json] [reset]',
    description: 'Show session metrics, token usage, and tool breakdown',
    category: 'core',
  });
  registerCommand({
    name: '/attach',
    usage: '/attach <path>',
    description: 'Attach a file or image to the next message',
    category: 'core',
  });
  registerCommand({
    name: '/attachments',
    usage: '/attachments',
    description: 'List staged attachments',
    category: 'core',
  });
  registerCommand({
    name: '/attach-clear',
    usage: '/attach-clear',
    description: 'Clear staged attachments',
    category: 'core',
  });

  // ── Safety & Policy ───────────────────────────────────────────────
  registerCommand({
    name: '/apply',
    usage: '/apply on|off',
    description: 'Enable or disable write operations',
    category: 'safety',
  });
  registerCommand({
    name: '/agentic',
    usage: '/agentic on|off',
    description: 'Enable or disable structured MCP metadata',
    category: 'safety',
  });
  registerCommand({
    name: '/redact',
    usage: '/redact on|off',
    description: 'Enable or disable PII redaction',
    category: 'safety',
  });
  registerCommand({
    name: '/audit',
    usage: '/audit on|off [detail]',
    description: 'Toggle tool audit logging (optional excerpts)',
    category: 'safety',
  });
  registerCommand({
    name: '/audit-show',
    usage: '/audit-show [session] [tool=name] [errors] [limit=20]',
    description: 'Show recent audit entries',
    category: 'safety',
  });
  registerCommand({
    name: '/audit-clear',
    usage: '/audit-clear [session]',
    description: 'Clear audit log for a session',
    category: 'safety',
  });
  registerCommand({
    name: '/permissions',
    usage: '/permissions [list|clear]',
    description: 'List or clear stored permissions',
    category: 'safety',
  });
  registerCommand({
    name: '/policy',
    usage: '/policy list|set|unset|clear|edit|init|import',
    description: 'Manage policy overrides',
    category: 'safety',
  });
  registerCommand({
    name: '/policy export',
    usage: '/policy export [local|global] [out=path] [--unsafe-path]',
    description: 'Export policy overrides',
    category: 'safety',
    helpOnly: true,
  });
  registerCommand({
    name: '/policy import',
    usage: '/policy import <path> [merge|replace]',
    description: 'Import policy overrides from JSON',
    category: 'safety',
    helpOnly: true,
  });

  // ── Integrations ──────────────────────────────────────────────────
  registerCommand({
    name: '/integrations',
    usage: '/integrations',
    description: 'Show integration status',
    category: 'integrations',
  });
  registerCommand({
    name: '/integrations setup',
    usage: '/integrations setup [integration]',
    description: 'Run integration setup wizard',
    category: 'integrations',
    helpOnly: true,
  });

  // ── Sessions ──────────────────────────────────────────────────────
  registerCommand({
    name: '/session stats',
    usage: '/session stats',
    description: 'Show session storage statistics',
    category: 'sessions',
    helpOnly: true,
  });
  registerCommand({
    name: '/session cleanup',
    usage: '/session cleanup [days=30] [--dry-run]',
    description: 'Remove empty sessions older than N days',
    category: 'sessions',
    helpOnly: true,
  });
  registerCommand({
    name: '/session',
    usage: '/session',
    description: 'Show current session info',
    category: 'sessions',
  });
  registerCommand({
    name: '/sessions',
    usage: '/sessions [all] [tag=tag]',
    description: 'List sessions (optionally include archived or filter by tag)',
    category: 'sessions',
  });
  registerCommand({
    name: '/new',
    usage: '/new [name]',
    description: 'Start a new session',
    category: 'sessions',
  });
  registerCommand({
    name: '/resume',
    usage: '/resume <name>',
    description: 'Resume a saved session',
    category: 'sessions',
  });
  registerCommand({
    name: '/archive',
    usage: '/archive [name]',
    description: 'Archive a session',
    category: 'sessions',
  });
  registerCommand({
    name: '/unarchive',
    usage: '/unarchive [name]',
    description: 'Unarchive a session',
    category: 'sessions',
  });
  registerCommand({
    name: '/rename',
    usage: '/rename <name>',
    description: 'Rename the current session',
    category: 'sessions',
  });
  registerCommand({
    name: '/delete',
    usage: '/delete [name]',
    description: 'Delete a session',
    category: 'sessions',
  });
  registerCommand({
    name: '/tag',
    usage: '/tag list|add|remove <tag> [session]',
    description: 'Manage session tags',
    category: 'sessions',
  });
  registerCommand({
    name: '/search',
    usage:
      '/search <text> [all] [role=user|assistant] [since=YYYY-MM-DD] [until=YYYY-MM-DD] [regex=/.../] [limit=100]',
    description: 'Search session transcripts (scans up to 5000 entries)',
    category: 'sessions',
  });
  registerCommand({
    name: '/session-meta',
    usage: '/session-meta [session] [json|md] [out=path] [--unsafe-path]',
    description: 'Show or export session metadata',
    category: 'sessions',
  });

  // ── Shortcut Commands ─────────────────────────────────────────────
  registerCommand({
    name: '/rules',
    usage: '/rules [get|list|create|toggle|delete|import|export|agent|<id>]',
    description: 'Manage agent rules',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/kb',
    usage: '/kb [search|add|delete|scroll|list|info]',
    description: 'Manage KB entries',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/agents',
    usage: '/agents [list|get|create|switch|export|import|bootstrap|<id>]',
    description: 'Manage agents',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/channels',
    usage: '/channels [list|create|messages|<id>]',
    description: 'Manage conversation channels',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/convos',
    usage: '/convos [get|recent|search|count|export|replay|tag|<id>]',
    description: 'Inspect conversations',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/conversations',
    usage: '/conversations [get|recent|search|count|export|replay|tag|<id>]',
    description: 'Alias for /convos',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/messages',
    usage: '/messages [list|get|search|count|create|annotate|delete|<id>]',
    description: 'Manage messages',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/responses',
    usage: '/responses [list|search|count|get|rate|<id>]',
    description: 'Inspect and rate responses',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/status',
    usage: '/status',
    description: 'Show platform status summary',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/stats',
    usage: '/stats',
    description: 'Show analytics summary (supports positional window: 7d/30d/90d)',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/analytics',
    usage: '/analytics',
    description: 'Show analytics summaries (supports positional window: 7d/30d/90d)',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/snapshot',
    usage: '/snapshot [list|create|show]',
    description: 'Manage local snapshots',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/bulk',
    usage: '/bulk [export|import]',
    description: 'Bulk import/export workflows',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/pull',
    usage: '/pull [dir]',
    description: 'Pull remote config into a directory',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/push',
    usage: '/push [source]',
    description: 'Push a local config file or directory',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/validate',
    usage: '/validate [source]',
    description: 'Validate local state-set payload',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/watch',
    usage: '/watch [dir]',
    description: 'Watch .stateset for changes and sync',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/webhooks',
    usage: '/webhooks [list|create|test|logs|delete]',
    description: 'Manage webhook subscriptions',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/alerts',
    usage: '/alerts [list|get|create|delete]',
    description: 'Manage alert rules',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/monitor',
    usage: '/monitor [status|live]',
    description: 'Watch live platform metrics',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/test',
    usage: '/test [message...] [--agent <agent-id>]',
    description: 'Run a non-persistent test message',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/diff',
    usage: '/diff',
    description: 'Show config diff',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/deploy',
    usage: '/deploy',
    description: 'Push snapshot-backed changes (--schedule/--approve)',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/rollback',
    usage: '/rollback',
    description: 'Rollback config changes (--schedule/--approve)',
    category: 'shortcuts',
  });
  registerCommand({
    name: '/deployments',
    usage: '/deployments',
    description: 'Inspect deployment history and scheduled jobs',
    category: 'shortcuts',
  });

  // ── Exports ───────────────────────────────────────────────────────
  registerCommand({
    name: '/export',
    usage: '/export [session] [md|json|jsonl] [path] [--unsafe-path]',
    description: 'Export session to markdown/json/jsonl',
    category: 'exports',
  });
  registerCommand({
    name: '/export-list',
    usage: '/export-list [session]',
    description: 'List export files for a session',
    category: 'exports',
  });
  registerCommand({
    name: '/export-show',
    usage: '/export-show <file> [session] [head=40]',
    description: 'Preview an export file',
    category: 'exports',
  });
  registerCommand({
    name: '/export-open',
    usage: '/export-open <file> [session]',
    description: 'Show export file path',
    category: 'exports',
  });
  registerCommand({
    name: '/export-delete',
    usage: '/export-delete <file> [session]',
    description: 'Delete an export file',
    category: 'exports',
  });
  registerCommand({
    name: '/export-prune',
    usage: '/export-prune [session] keep=5',
    description: 'Delete older exports',
    category: 'exports',
  });

  // ── Prompts & Skills ──────────────────────────────────────────────
  registerCommand({
    name: '/prompts',
    usage: '/prompts',
    description: 'List prompt templates',
    category: 'prompts',
  });
  registerCommand({
    name: '/prompt',
    usage: '/prompt <name>',
    description: 'Fill and send a prompt template',
    category: 'prompts',
  });
  registerCommand({
    name: '/prompt-history',
    usage: '/prompt-history',
    description: 'Show recent prompt templates',
    category: 'prompts',
  });
  registerCommand({
    name: '/prompt-validate',
    usage: '/prompt-validate [name|all]',
    description: 'Validate prompt templates',
    category: 'prompts',
  });
  registerCommand({
    name: '/skills',
    usage: '/skills',
    description: 'List available skills',
    category: 'prompts',
  });
  registerCommand({
    name: '/skill',
    usage: '/skill <name>',
    description: 'Activate a skill for this session',
    category: 'prompts',
  });
  registerCommand({
    name: '/skill-clear',
    usage: '/skill-clear',
    description: 'Clear active skills',
    category: 'prompts',
  });

  // ── Extensions ────────────────────────────────────────────────────
  registerCommand({
    name: '/extensions',
    usage: '/extensions',
    description: 'List loaded extensions',
    category: 'extensions',
  });
  registerCommand({
    name: '/reload',
    usage: '/reload',
    description: 'Reload extensions',
    category: 'extensions',
  });
  registerCommand({
    name: '/exit',
    aliases: ['/quit'],
    usage: '/exit /quit',
    description: 'End the session',
    category: 'extensions',
  });
}
