import { getModelAliasText } from '../config.js';

export type CommandCategory =
  | 'core'
  | 'safety'
  | 'integrations'
  | 'engine'
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
  /** Extended help text shown by `/help <command>`. */
  detailedHelp?: string;
  /** Example usages shown by `/help <command>`. */
  examples?: string[];
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

/**
 * Find a command by its canonical name or any alias.
 * Returns the first matching definition, or null.
 */
export function findCommand(nameOrAlias: string): CommandDefinition | null {
  const normalized = nameOrAlias.startsWith('/') ? nameOrAlias : `/${nameOrAlias}`;
  for (const def of registry) {
    if (def.name === normalized) return def;
    if (def.aliases?.includes(normalized)) return def;
  }
  return null;
}

/**
 * Find all commands in a category by category name.
 */
export function getCommandsForCategory(categoryName: string): CommandDefinition[] {
  const lower = categoryName.toLowerCase();
  return registry.filter((def) => def.category === lower);
}

const CATEGORY_ORDER: CommandCategory[] = [
  'core',
  'safety',
  'integrations',
  'engine',
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
  engine: 'Workflow Engine',
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
    aliases: ['/commands', '/h'],
    usage: '/help [command|category]',
    description: 'Show help (optionally for a specific command or category)',
    category: 'core',
    detailedHelp:
      'Show the full command reference, or detailed help for a specific command or category.',
    examples: ['/help', '/help model', '/help sessions'],
  });
  registerCommand({
    name: '/clear',
    aliases: ['/c'],
    usage: '/clear',
    description: 'Reset conversation history',
    category: 'core',
  });
  registerCommand({
    name: '/history',
    aliases: ['/hist'],
    usage: '/history',
    description: 'Show conversation turn count',
    category: 'core',
  });
  registerCommand({
    name: '/model',
    aliases: ['/m'],
    usage: '/model <name>',
    description: `Switch model (${getModelAliasText('list')})`,
    category: 'core',
    detailedHelp: 'Switch the active Claude model for this session.',
    examples: ['/model sonnet', '/model haiku', '/model opus'],
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
    name: '/whoami',
    usage: '/whoami',
    description: 'Show full session dashboard (org, model, profile, engine, cost)',
    category: 'core',
  });
  registerCommand({
    name: '/cost',
    usage: '/cost',
    description: 'Show estimated session cost based on token usage',
    category: 'core',
  });
  registerCommand({
    name: '/trends',
    usage: '/trends [7d|30d|90d|all]',
    description: 'Show token usage and cost trends over time',
    category: 'core',
    detailedHelp:
      'Aggregates session metrics from persistent storage. Shows daily breakdown, top sessions by cost, and monthly cost projection.',
    examples: ['/trends', '/trends 7d', '/trends 30d', '/trends all'],
  });
  registerCommand({
    name: '/debug',
    usage: '/debug on|off',
    description: 'Toggle debug logging for this session',
    category: 'core',
  });
  registerCommand({
    name: '/copy',
    usage: '/copy',
    description: 'Copy the last assistant response to clipboard',
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
    name: '/integrations status',
    usage: '/integrations status',
    description: 'Alias for /integrations',
    category: 'integrations',
    helpOnly: true,
  });
  registerCommand({
    name: '/integrations setup',
    usage: '/integrations setup [integration]',
    description: 'Run integration setup wizard',
    category: 'integrations',
    helpOnly: true,
  });
  registerCommand({
    name: '/integrations health',
    usage: '/integrations health [integration] [--detailed]',
    description: 'Show integration readiness and config health',
    category: 'integrations',
    helpOnly: true,
    examples: ['/integrations health', '/integrations health shopify --detailed'],
  });
  registerCommand({
    name: '/integrations limits',
    usage: '/integrations limits [integration]',
    description: 'Show integration call/error and rate-limit telemetry',
    category: 'integrations',
    helpOnly: true,
    examples: ['/integrations limits', '/integrations limits shopify'],
  });
  registerCommand({
    name: '/integrations logs',
    usage: '/integrations logs [integration] [--last 20]',
    description: 'Show recent integration audit events',
    category: 'integrations',
    helpOnly: true,
    examples: ['/integrations logs', '/integrations logs shopify --last 50'],
  });

  // ── Workflow Engine ──────────────────────────────────────────────
  registerCommand({
    name: '/engine',
    usage: '/engine',
    description: 'Show workflow engine connection status',
    category: 'engine',
    detailedHelp: 'Display the current workflow engine connection status and configuration.',
    examples: ['/engine', '/engine brands', '/engine setup'],
  });
  registerCommand({
    name: '/engine setup',
    usage: '/engine setup',
    description: 'Configure the workflow engine connection',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine brands',
    usage: '/engine brands [slug]',
    description: 'List or search brands in the workflow engine',
    category: 'engine',
    helpOnly: true,
    examples: ['/engine brands', '/engine brands acme-co'],
  });
  registerCommand({
    name: '/engine onboard',
    usage: '/engine onboard <brand-id>',
    description: 'Start an onboarding run for a brand',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine health',
    usage: '/engine health',
    description: 'Check workflow engine health',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine templates',
    usage: '/engine templates [key]',
    description: 'List or get workflow templates',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine dlq',
    usage: '/engine dlq <brand-id>',
    description: 'List dead-letter queue items for a brand',
    category: 'engine',
    helpOnly: true,
  });

  registerCommand({
    name: '/workflows',
    aliases: ['/wf'],
    usage: '/workflows [list|start|status|cancel|retry]',
    description: 'Manage workflow executions in the engine',
    category: 'engine',
    detailedHelp:
      'List running workflows, start new ones, check status, cancel, or retry failed workflows.',
    examples: [
      '/workflows list',
      '/workflows status <workflow-id>',
      '/workflows cancel <workflow-id>',
    ],
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
    aliases: ['/s'],
    usage: '/sessions [all] [tag=tag]',
    description: 'List sessions (optionally include archived or filter by tag)',
    category: 'sessions',
    examples: ['/sessions', '/sessions all', '/sessions tag=debug'],
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
    examples: ['/tag list', '/tag add debug', '/tag remove debug'],
  });
  registerCommand({
    name: '/search',
    usage:
      '/search <text> [all] [role=user|assistant] [since=YYYY-MM-DD] [until=YYYY-MM-DD] [regex=/.../] [limit=100]',
    description: 'Search session transcripts (scans up to 5000 entries)',
    category: 'sessions',
    examples: ['/search refund', '/search error role=assistant since=2025-01-01'],
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
    aliases: ['/r'],
    usage: '/rules [get|list|create|toggle|delete|import|export|agent|<id>]',
    description: 'Manage agent rules',
    category: 'shortcuts',
    detailedHelp:
      'List, create, toggle, delete, import, or export agent rules. Use a rule ID to view details.',
    examples: ['/rules list', '/rules create', '/rules toggle <id>', '/rules export'],
  });
  registerCommand({
    name: '/kb',
    usage: '/kb [search|add|delete|scroll|list|info]',
    description: 'Manage KB entries',
    category: 'shortcuts',
    detailedHelp: 'Search, add, delete, or browse knowledge base entries.',
    examples: ['/kb search shipping policy', '/kb add', '/kb list'],
  });
  registerCommand({
    name: '/agents',
    aliases: ['/a'],
    usage: '/agents [list|get|create|switch|export|import|bootstrap|<id>]',
    description: 'Manage agents',
    category: 'shortcuts',
    detailedHelp: 'List, create, switch between, or import/export agents.',
    examples: ['/agents list', '/agents get <id>', '/agents switch <id>', '/agents bootstrap'],
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
    aliases: ['/st'],
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
    name: '/drift',
    usage: '/drift [--json]',
    description: 'Detect configuration drift between local and remote state',
    category: 'shortcuts',
    detailedHelp:
      'Compares agents, rules, skills, and attributes against the remote GraphQL state. Shows deactivated, stale, or missing resources.',
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
    name: '/context',
    usage: '/context',
    description: 'Show context window usage',
    category: 'core',
    detailedHelp: 'Display how much of the conversation history window is used.',
  });
  registerCommand({
    name: '/retry',
    usage: '/retry',
    description: 'Retry the last user message',
    category: 'core',
    detailedHelp:
      'Re-send the last user message to the agent. Useful after errors or cancelled requests.',
  });

  registerCommand({
    name: '/export',
    usage: '/export [session] [md|json|jsonl|html] [path] [--unsafe-path]',
    description: 'Export session to markdown/json/jsonl/html',
    category: 'exports',
    examples: [
      '/export md',
      '/export html',
      '/export my-session json',
      '/export jsonl ./out.jsonl',
    ],
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
