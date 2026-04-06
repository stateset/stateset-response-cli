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
    name: '/capabilities',
    aliases: ['/caps'],
    usage: '/capabilities [area]',
    description: 'Show the CLI grouped by common jobs-to-be-done',
    category: 'core',
    detailedHelp:
      'Summarize the CLI by workflow area instead of raw command count. Useful for discovering the right command family for setup, runtime, workflow-studio, curation, operations, or resources.',
    examples: ['/capabilities', '/capabilities workflow', '/caps curation'],
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
    examples: [
      '/engine',
      '/engine brands',
      '/engine config pull acme-co',
      '/engine executions acme-co',
    ],
  });
  registerCommand({
    name: '/engine setup',
    usage: '/engine setup',
    description: 'Configure the workflow engine connection',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine init',
    usage: '/engine init [brand-slug]',
    description: 'Initialize .stateset/<brand>/ config-as-code directory with scaffold files',
    category: 'engine',
    helpOnly: true,
    examples: ['/engine init my-brand'],
  });
  registerCommand({
    name: '/engine config',
    usage: '/engine config [pull|push|validate|history] <brand>',
    description: 'Manage local .stateset brand workflow studio config against the engine',
    category: 'engine',
    helpOnly: true,
    detailedHelp:
      'Pull a brand config from the workflow engine into .stateset/<brand>, validate local file consistency, inspect config version history, or push local workflow studio config back to the engine.',
    examples: [
      '/engine config pull acme-co',
      '/engine config history acme-co',
      '/engine config validate acme-co',
      '/engine config push acme-co',
    ],
  });
  registerCommand({
    name: '/engine config pull',
    usage: '/engine config pull <brand-slug|brand-id>',
    description: 'Pull brand workflow studio config into .stateset/<brand>',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine config validate',
    usage: '/engine config validate <brand-slug>',
    description: 'Validate local brand workflow studio config files',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine config history',
    usage: '/engine config history <brand-slug|brand-id>',
    description: 'Show config version history for a brand',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine config show',
    usage: '/engine config show <brand-slug|brand-id>',
    description: 'Show the effective remote workflow studio config for a brand',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine config push',
    usage: '/engine config push <brand-slug>',
    description: 'Push local brand workflow studio config to the engine',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine activate',
    usage: '/engine activate <brand-slug|brand-id> [config-version]',
    description: 'Activate the current config for a brand',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine validate',
    usage: '/engine validate <brand-slug|brand-id>',
    description: 'Run remote engine validation for a brand',
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
    name: '/engine brands show',
    usage: '/engine brands show <brand-slug|brand-id>',
    description: 'Show brand details from the workflow engine',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine brands create',
    usage: '/engine brands create <json-file>',
    description: 'Create a brand from a JSON file (supports template bootstrap)',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine brands bootstrap',
    usage:
      '/engine brands bootstrap <brand-slug|brand-id> [ecommerce|subscription|knowledge_base] [activate]',
    description: 'Create or repair a workflow-studio brand and bootstrap response automation',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine brands update',
    usage: '/engine brands update <brand-slug|brand-id> <json-file>',
    description: 'Update a brand from a JSON patch file',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine onboard',
    usage: '/engine onboard <brand-slug|brand-id> [notes]',
    description: 'Start an onboarding run for a brand',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine onboard list',
    usage: '/engine onboard list <brand-slug|brand-id>',
    description: 'List onboarding runs for a brand',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine onboard show',
    usage: '/engine onboard show <brand-slug|brand-id> <run-id>',
    description: 'Show a specific onboarding run',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine onboard update',
    usage: '/engine onboard update <brand-slug|brand-id> <run-id> <status> [notes]',
    description: 'Update onboarding run status or notes',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine migration',
    usage: '/engine migration <brand-slug|brand-id>',
    description: 'Show migration state for a brand',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine migration update',
    usage: '/engine migration update <brand-slug|brand-id> <json-file>',
    description: 'Update migration state for a brand from a JSON patch file',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine parity',
    usage: '/engine parity <brand-slug|brand-id> [from] [to]',
    description: 'Show parity dashboard for a brand',
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
    name: '/engine dispatch-health',
    usage: '/engine dispatch-health [--tenant-id <tenant-id>] [--limit <n>] [--offset <n>]',
    description: 'Show dispatch health dashboard across brands',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine dispatch-guard',
    usage:
      '/engine dispatch-guard [--tenant-id <tenant-id>] [--apply true|false] [--minimum-health-status warning|critical] [--max-actions <n>]',
    description: 'Plan or apply dispatch guard actions for unhealthy brands',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine executions',
    usage: '/engine executions <brand-slug|brand-id> [status]',
    description: 'List recent workflow executions for a brand',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine connectors',
    usage:
      '/engine connectors <brand-slug|brand-id> [create <json-file>|health <connector-id>|plan [loop-mode] [--source local|platform]|sync [loop-mode] [--source local|platform]|env [loop-mode] [dotenv|shell|json] [out=path] [--unsafe-path]]',
    description:
      'List connectors, create connectors, plan sync, export local secret env, or run health checks for a brand',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine connectors create',
    usage: '/engine connectors <brand-slug|brand-id> create <json-file>',
    description: 'Create a connector for a brand from a JSON file',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine connectors plan',
    usage:
      '/engine connectors <brand-slug|brand-id> plan [subscriptions|returns|both] [--source local|platform]',
    description:
      'Show the workflow-studio connector sync plan for a brand from local or platform credentials',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine connectors sync',
    usage:
      '/engine connectors <brand-slug|brand-id> sync [subscriptions|returns|both] [--source local|platform]',
    description:
      'Write local connector config and create missing live connectors for a brand from local or platform credentials',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine connectors env',
    usage:
      '/engine connectors <brand-slug|brand-id> env [subscriptions|returns|both] [dotenv|shell|json] [out=path] [--unsafe-path]',
    description: 'Inspect or export brand-scoped connector secret env vars for local workers',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine local',
    usage:
      '/engine local apply <brand-slug|brand-id> [subscriptions|returns|both] [out=path] [compose=path] [services=a,b,c] [--write-only] [--unsafe-path]',
    description: 'Write brand-scoped env and refresh the local Temporal stack services',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine local apply',
    usage:
      '/engine local apply <brand-slug|brand-id> [subscriptions|returns|both] [out=path] [compose=path] [services=a,b,c] [--write-only] [--unsafe-path]',
    description: 'Write brand-scoped env and run docker compose for the local stack',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine test',
    usage: '/engine test <brand-slug|brand-id> <ticket-id>',
    description: 'Dispatch a dry-run workflow-studio test event for a brand',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine event',
    usage: '/engine event <brand-slug|brand-id> <json-file> [idempotency-key]',
    description: 'Ingest a workflow engine event payload from a JSON file',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine templates',
    usage: '/engine templates [key] [version]',
    description: 'List or get workflow templates',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine templates create',
    usage: '/engine templates create <json-file>',
    description: 'Create a workflow template version from a JSON file',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine templates update',
    usage: '/engine templates update <template-key> <version> <json-file>',
    description: 'Update a workflow template version from a JSON file',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine policy-sets',
    usage: '/engine policy-sets [key]',
    description: 'List or get versioned policy sets',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine policy-sets get',
    usage: '/engine policy-sets get <policy-set-key> [version]',
    description: 'Get a policy set version',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine policy-sets create',
    usage: '/engine policy-sets create <json-file>',
    description: 'Create a policy set version from a JSON file',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine policy-sets update',
    usage: '/engine policy-sets update <policy-set-key> <version> <json-file>',
    description: 'Update a policy set version from a JSON file',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine dlq',
    usage: '/engine dlq <brand-slug|brand-id> [status]',
    description: 'List dead-letter queue items for a brand',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine dlq retry',
    usage: '/engine dlq retry <brand-slug|brand-id> <dlq-id>',
    description: 'Retry a dead-letter queue item',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/engine dlq resolve',
    usage: '/engine dlq resolve <brand-slug|brand-id> <dlq-id> [action] [notes]',
    description: 'Resolve a dead-letter queue item',
    category: 'engine',
    helpOnly: true,
  });

  registerCommand({
    name: '/workflows',
    aliases: ['/wf'],
    usage: '/workflows [list|start|status|cancel|terminate|restart|review|retry]',
    description: 'Manage workflow executions in the engine',
    category: 'engine',
    detailedHelp:
      'List recent workflow executions for a brand, start new ones, check status, review, restart, cancel, terminate, or retry failed workflows.',
    examples: [
      '/workflows list acme-co',
      '/workflows status <workflow-id>',
      '/workflows cancel <workflow-id>',
      '/workflows review <workflow-id> approve',
    ],
  });

  // ── Onboarding ──────────────────────────────────────────────────
  registerCommand({
    name: '/onboard',
    usage: '/onboard [init]',
    description: 'Interactive onboarding wizard — brand, integrations, KB, rules, workflow, deploy',
    category: 'engine',
    detailedHelp:
      'Full CLI-first onboarding: create brand → connect integrations → ingest KB from local files → configure rules → build workflow config → write to .stateset/ → deploy to engine. Afterward use /engine config push <brand> for iterative updates.',
    examples: ['/onboard', '/onboard init my-brand'],
  });
  registerCommand({
    name: '/onboard init',
    usage: '/onboard init [brand-slug]',
    description: 'Initialize .stateset/<brand>/ config-as-code directory',
    category: 'engine',
    helpOnly: true,
  });

  // ── Fine-tuning ─────────────────────────────────────────────────
  registerCommand({
    name: '/finetune',
    usage: '/finetune [list|export|validate|create|deploy]',
    description: 'Fine-tuning pipeline: export evals → create job → deploy model',
    category: 'engine',
    detailedHelp:
      'Manage the fine-tuning lifecycle. Export approved eval data into the SFT and DPO dataset formats used by workflow studio, validate datasets before training, create fine-tune job specs, and deploy fine-tuned models to workflow config.',
    examples: [
      '/finetune list',
      '/finetune export --format all --validation-ratio 0.1',
      '/finetune validate .stateset/finetune',
      '/finetune create',
      '/finetune deploy ft:gpt-4.1:stateset:...',
    ],
  });
  registerCommand({
    name: '/finetune export',
    usage:
      '/finetune export [output-dir] [--format all|sft|dpo|openai-sft|studio-sft|trl-sft|studio-dpo|pair-dpo] [--status approved] [--validation-ratio 0.1]',
    description: 'Export evals into workflow-studio SFT and DPO dataset files',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/finetune validate',
    usage:
      '/finetune validate [path] [--format auto|openai-sft|studio-sft|trl-sft|studio-dpo|pair-dpo]',
    description: 'Validate exported training datasets before fine-tuning',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/finetune create',
    usage: '/finetune create [dataset-file] [--method supervised|dpo]',
    description: 'Create a new fine-tuning job spec from a validated dataset',
    category: 'engine',
    helpOnly: true,
  });
  registerCommand({
    name: '/finetune deploy',
    usage: '/finetune deploy <model-id>',
    description: 'Deploy a fine-tuned model to workflow config',
    category: 'engine',
    helpOnly: true,
  });

  // ── Evals ───────────────────────────────────────────────────────
  registerCommand({
    name: '/evals',
    usage: '/evals [list|create|create-from-response|get|update|delete|export|review|suggest|<id>]',
    description: 'Manage evals and fine-tuning training examples',
    category: 'shortcuts',
    detailedHelp:
      'List, create, seed from real responses, review, update, delete, export, or inspect eval records. Use /evals suggest to bootstrap quality criteria, /evals create-from-response to capture live agent outputs, then /finetune export to generate training data.',
    examples: [
      '/evals list',
      '/evals create --name Accuracy --type quality --message "Where is my order?" --preferred "Your order is in transit."',
      '/evals create-from-response resp-123 --seed rejected',
      '/evals review',
      '/evals update <eval-id> --status approved',
      '/evals export --out .stateset/evals.json',
      '/evals suggest',
    ],
  });
  registerCommand({
    name: '/evals list',
    usage: '/evals list [--limit N] [--offset N]',
    description: 'List eval records',
    category: 'shortcuts',
    helpOnly: true,
  });
  registerCommand({
    name: '/evals create',
    usage:
      '/evals create --name <name> --type <type> [--status <status>] [--message <text>] [--preferred <text>]',
    description: 'Create an eval record',
    category: 'shortcuts',
    helpOnly: true,
  });
  registerCommand({
    name: '/evals create-from-response',
    usage:
      '/evals create-from-response <response-id> [--seed preferred|rejected|none] [--name <name>] [--type <type>]',
    description: 'Seed an eval from a stored agent response for curation and DPO review',
    category: 'shortcuts',
    helpOnly: true,
  });
  registerCommand({
    name: '/evals get',
    usage: '/evals get <eval-id>',
    description: 'Show a single eval record',
    category: 'shortcuts',
    helpOnly: true,
  });
  registerCommand({
    name: '/evals update',
    usage: '/evals update <eval-id> [--status <status>] [--preferred <text>] [--rejected <text>]',
    description: 'Update an eval record',
    category: 'shortcuts',
    helpOnly: true,
  });
  registerCommand({
    name: '/evals delete',
    usage: '/evals delete <eval-id>',
    description: 'Delete an eval record',
    category: 'shortcuts',
    helpOnly: true,
  });
  registerCommand({
    name: '/evals export',
    usage: '/evals export [eval-id ...] [--out <path>]',
    description: 'Export evals in fine-tuning format',
    category: 'shortcuts',
    helpOnly: true,
  });
  registerCommand({
    name: '/evals review',
    usage: '/evals review [eval-id] [--status pending]',
    description: 'Interactively review pending evals',
    category: 'shortcuts',
    helpOnly: true,
  });
  registerCommand({
    name: '/evals suggest',
    aliases: ['/evals-suggest'],
    usage: '/evals suggest',
    description: 'Auto-suggest eval criteria based on conversation patterns',
    category: 'shortcuts',
    helpOnly: true,
  });
  registerCommand({
    name: '/datasets',
    usage:
      '/datasets [list|create|get|update|delete|add-entry|update-entry|delete-entry|import|export|<id>]',
    description: 'Manage datasets and dataset entries for training-data curation',
    category: 'shortcuts',
    detailedHelp:
      'List, create, update, delete, import, and export datasets, plus add or update message-based dataset entries used for SFT curation and workflow-studio training loops.',
    examples: [
      '/datasets list',
      '/datasets create --name "Returns Triage"',
      '/datasets add-entry <dataset-id> --messages \'[{"role":"user","content":"Where is my order?"}]\'',
      '/datasets import <dataset-id> ./train.jsonl',
      '/datasets export <dataset-id> --out .stateset/datasets/returns-triage.json',
    ],
  });
  registerCommand({
    name: '/datasets create',
    usage:
      '/datasets create --name <name> [--description <text>] [--status active|archived|draft] [--metadata <json>]',
    description: 'Create a dataset',
    category: 'shortcuts',
    helpOnly: true,
  });
  registerCommand({
    name: '/datasets get',
    usage: '/datasets get <dataset-id>',
    description: 'Show a dataset with its entries',
    category: 'shortcuts',
    helpOnly: true,
  });
  registerCommand({
    name: '/datasets update',
    usage:
      '/datasets update <dataset-id> [--name <name>] [--description <text>] [--status active|archived|draft] [--metadata <json>]',
    description: 'Update dataset metadata',
    category: 'shortcuts',
    helpOnly: true,
  });
  registerCommand({
    name: '/datasets delete',
    usage: '/datasets delete <dataset-id>',
    description: 'Delete a dataset and all of its entries',
    category: 'shortcuts',
    helpOnly: true,
  });
  registerCommand({
    name: '/datasets add-entry',
    usage: '/datasets add-entry <dataset-id> (--messages <json> | --file <path>)',
    description: 'Add a message-based training entry to a dataset',
    category: 'shortcuts',
    helpOnly: true,
  });
  registerCommand({
    name: '/datasets update-entry',
    usage: '/datasets update-entry <entry-id> (--messages <json> | --file <path>)',
    description: 'Update a dataset entry by ID',
    category: 'shortcuts',
    helpOnly: true,
  });
  registerCommand({
    name: '/datasets delete-entry',
    usage: '/datasets delete-entry <entry-id>',
    description: 'Delete a dataset entry by ID',
    category: 'shortcuts',
    helpOnly: true,
  });
  registerCommand({
    name: '/datasets import',
    usage: '/datasets import <dataset-id> <json|jsonl-file>',
    description: 'Bulk import dataset entries from JSON or JSONL',
    category: 'shortcuts',
    helpOnly: true,
  });
  registerCommand({
    name: '/datasets export',
    usage: '/datasets export <dataset-id> [--out <path>]',
    description: 'Export a dataset with its entries',
    category: 'shortcuts',
    helpOnly: true,
  });

  // ── Rules Generation ────────────────────────────────────────────
  registerCommand({
    name: '/rules generate',
    usage: '/rules generate [brand-slug]',
    description: 'Auto-generate rules from KB and business data (with human confirmation)',
    category: 'engine',
    helpOnly: true,
    detailedHelp:
      'Analyzes your knowledge base and business context to suggest skip rules, escalation patterns, and response rules. All suggestions require human confirmation.',
    examples: ['/rules generate', '/rules generate my-brand'],
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
    usage: '/kb [search|add|ingest|delete|scroll|list|info]',
    description: 'Manage KB entries',
    category: 'shortcuts',
    detailedHelp:
      'Search, add, bulk ingest, delete, or browse knowledge base entries. Use /kb ingest <path> to recursively process local files (.md, .txt, .json, .yaml, .csv, .html) into KB entries with automatic chunking.',
    examples: ['/kb search shipping policy', '/kb add ./faq.md', '/kb ingest ./docs/', '/kb list'],
  });
  registerCommand({
    name: '/kb ingest',
    usage: '/kb ingest <path> [--chunk_size 2000] [--overlap 200]',
    description: 'Bulk ingest local files/directories into KB with chunking',
    category: 'shortcuts',
    helpOnly: true,
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
    usage: '/webhooks [list|get|create|update|deliveries|logs|delete]',
    description: 'Manage remote webhook subscriptions and delivery history',
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
