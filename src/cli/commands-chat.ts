import chalk from 'chalk';
import { loadMemory } from '../memory.js';
import { buildSystemPrompt } from '../prompt.js';
import {
  printHelp,
  printCommandHelp,
  formatError,
  formatSuccess,
  formatWarning,
  formatTable,
} from '../utils/display.js';
import {
  findCommand,
  getRegisteredCommands,
  getCommandsForCategory,
  getCategoryLabel,
  type CommandCategory,
} from './command-registry.js';
import { levenshteinDistance } from './fuzzy.js';
import { getSkill, listSkills } from '../resources.js';
import { getErrorMessage } from '../lib/errors.js';
import type { ChatContext, CommandResult } from './types.js';
import { handleConfigCommand } from './commands-config.js';
import { handleAuditCommand } from './commands-audit.js';
import { handlePolicyCommand } from './commands-policy.js';
import { handleTemplateCommand } from './commands-templates.js';
import {
  printIntegrationHealth,
  printIntegrationLimits,
  printIntegrationLogs,
} from './commands-integrations.js';
import { hasCommand } from './utils.js';
import { metrics } from '../lib/metrics.js';
import { printCapabilityMap } from './capabilities.js';

const HELP_CATEGORIES: CommandCategory[] = [
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

const HELP_CATEGORY_ALIASES: Record<CommandCategory, string[]> = {
  core: ['core'],
  safety: ['safety', 'policy', 'policies', 'security'],
  integrations: ['integration', 'integrations'],
  engine: ['engine', 'workflow', 'workflows'],
  sessions: ['session', 'sessions'],
  shortcuts: ['shortcut', 'shortcuts'],
  exports: ['export', 'exports'],
  prompts: ['prompt', 'prompts', 'skill', 'skills'],
  extensions: ['extension', 'extensions'],
};

const INTEGRATIONS_SUBCOMMANDS = ['status', 'setup', 'health', 'limits', 'logs'] as const;

function normalizeHelpLookup(value: string): string {
  return value.trim().toLowerCase().replace(/^\//, '');
}

function resolveHelpCategory(query: string): CommandCategory | null {
  const normalized = normalizeHelpLookup(query);
  if (!normalized) return null;

  const exactMatches = HELP_CATEGORIES.filter((category) => {
    const names = [
      category,
      getCategoryLabel(category).toLowerCase(),
      ...HELP_CATEGORY_ALIASES[category],
    ];
    return names.some((name) => name === normalized);
  });
  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  const prefixMatches = HELP_CATEGORIES.filter((category) => {
    const names = [
      category,
      getCategoryLabel(category).toLowerCase(),
      ...HELP_CATEGORY_ALIASES[category],
    ];
    return names.some((name) => name.startsWith(normalized) || normalized.startsWith(name));
  });
  return prefixMatches.length === 1 ? prefixMatches[0] : null;
}

function scoreHelpMatch(commandName: string, query: string): number {
  const normalizedCommand = normalizeHelpLookup(commandName);
  const normalizedQuery = normalizeHelpLookup(query);
  if (!normalizedQuery) return 0;
  if (normalizedCommand === normalizedQuery) return 500;
  if (normalizedCommand.startsWith(normalizedQuery)) return 400;
  if (normalizedCommand.includes(normalizedQuery)) return 300;
  const distance = levenshteinDistance(normalizedQuery, normalizedCommand);
  return distance <= 3 ? 100 - distance : 0;
}

function findHelpMatches(query: string) {
  const normalizedQuery = normalizeHelpLookup(query);
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const scored = getRegisteredCommands()
    .map((cmd) => {
      const aliasScores = (cmd.aliases ?? []).map((alias) => scoreHelpMatch(alias, query));
      const usageScore = scoreHelpMatch(cmd.usage, query);
      const detailParts = [
        cmd.description.toLowerCase(),
        cmd.detailedHelp?.toLowerCase() ?? '',
        getCategoryLabel(cmd.category).toLowerCase(),
        cmd.category,
      ];
      const termScore = terms.every((term) => detailParts.some((part) => part.includes(term)))
        ? 200
        : 0;
      const score = Math.max(
        scoreHelpMatch(cmd.name, query),
        usageScore,
        termScore,
        ...aliasScores,
      );
      return { cmd, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.cmd.name.localeCompare(b.cmd.name));

  const deduped = new Set<string>();
  return scored
    .map((entry) => entry.cmd)
    .filter((cmd) => {
      if (deduped.has(cmd.name)) return false;
      deduped.add(cmd.name);
      return true;
    })
    .slice(0, 8);
}

function printCategoryCommands(category: CommandCategory): void {
  const cmds = getCommandsForCategory(category);
  if (cmds.length === 0) {
    return;
  }

  console.log('');
  console.log(chalk.bold(`  ${getCategoryLabel(category)}`));
  for (const c of cmds) {
    const aliasStr =
      c.aliases && c.aliases.length > 0 ? chalk.gray(` (${c.aliases.join(', ')})`) : '';
    console.log(chalk.cyan(`    ${c.usage}`) + aliasStr + chalk.gray('  ' + c.description));
  }
  console.log('');
}

function printHelpMatches(query: string, commands: ReturnType<typeof findHelpMatches>): void {
  console.log('');
  console.log(chalk.bold(`  Matches for "${query}"`));
  for (const cmd of commands) {
    const aliasStr =
      cmd.aliases && cmd.aliases.length > 0 ? chalk.gray(` (${cmd.aliases.join(', ')})`) : '';
    console.log(chalk.cyan(`    ${cmd.usage}`) + aliasStr + chalk.gray('  ' + cmd.description));
  }
  console.log('');
}

function getSubcommandSuggestions(query: string, candidates: readonly string[]): string[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const prefixMatches = candidates.filter((candidate) => candidate.startsWith(normalizedQuery));
  if (prefixMatches.length > 0) {
    return prefixMatches.slice(0, 4);
  }

  return candidates
    .map((candidate) => ({
      candidate,
      distance: levenshteinDistance(normalizedQuery, candidate),
    }))
    .filter((entry) => entry.distance <= 3)
    .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate))
    .slice(0, 3)
    .map((entry) => entry.candidate);
}

export async function handleChatCommand(input: string, ctx: ChatContext): Promise<CommandResult> {
  const prefix = input.split(/\s/)[0];

  // Delegate to extracted command modules
  if (['/apply', '/redact', '/agentic', '/usage', '/model'].includes(prefix)) {
    return await handleConfigCommand(input, ctx);
  }

  // /debug on|off — toggle debug logging
  if (hasCommand(input, '/debug')) {
    const arg = input.split(/\s+/).slice(1).join(' ').trim().toLowerCase();
    const { logger } = await import('../lib/logger.js');
    if (arg === 'on' || arg === 'true') {
      logger.configure({ level: 'debug' });
      console.log(formatSuccess('Debug logging enabled.'));
    } else if (arg === 'off' || arg === 'false') {
      logger.configure({ level: 'info' });
      console.log(formatSuccess('Debug logging disabled.'));
    } else {
      const current = logger.getLevel();
      console.log(
        chalk.gray(
          `  Debug mode: ${current === 'debug' || current === 'trace' ? 'on' : 'off'} (level: ${current})`,
        ),
      );
    }
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }
  if (
    hasCommand(input, '/audit') ||
    hasCommand(input, '/audit-show') ||
    hasCommand(input, '/audit-clear')
  ) {
    return await handleAuditCommand(input, ctx);
  }
  if (hasCommand(input, '/permissions') || hasCommand(input, '/policy')) {
    return await handlePolicyCommand(input, ctx);
  }
  if (
    hasCommand(input, '/prompts') ||
    hasCommand(input, '/prompt-history') ||
    hasCommand(input, '/prompt-validate') ||
    hasCommand(input, '/prompt')
  ) {
    return await handleTemplateCommand(input, ctx);
  }

  // /whoami — show full session dashboard
  if (hasCommand(input, '/whoami')) {
    const { calculateCost, formatUsd } = await import('../lib/pricing.js');
    const { getFallbackChain } = await import('../lib/model-fallback.js');
    const { getWorkflowEngineConfig } = await import('../config.js');
    const { isIntegrationConfigured } = await import('../integrations/config.js');
    const { INTEGRATION_DEFINITIONS } = await import('../integrations/registry.js');

    const snap = metrics.snapshot();
    const model = ctx.agent.getModel();
    const breakdown = calculateCost(snap.tokenUsage, model);
    const chain = getFallbackChain();
    const engineConfig = getWorkflowEngineConfig();
    const activeIntegrations = INTEGRATION_DEFINITIONS.filter((d) => {
      try {
        return isIntegrationConfigured(d.id);
      } catch {
        return false;
      }
    });
    const profile = process.env.STATESET_PROFILE || 'default';
    const totalTokens = snap.tokenUsage.inputTokens + snap.tokenUsage.outputTokens;

    console.log('');
    console.log(chalk.bold('  Session Dashboard'));
    console.log(chalk.gray(`  ─────────────────────────────────────`));
    console.log(chalk.gray(`  Session:      ${ctx.sessionId}`));
    if (profile !== 'default') {
      console.log(chalk.gray(`  Profile:      ${profile}`));
    }
    console.log(chalk.gray(`  Model:        ${model}`));
    console.log(chalk.gray(`  Fallback:     ${chain.join(' → ')}`));
    console.log(chalk.gray(`  Messages:     ${ctx.agent.getHistoryLength()}`));
    console.log(
      chalk.gray(
        `  Tokens:       ${totalTokens.toLocaleString()} (${snap.tokenUsage.inputTokens.toLocaleString()} in / ${snap.tokenUsage.outputTokens.toLocaleString()} out)`,
      ),
    );
    console.log(chalk.gray(`  Est. cost:    ${formatUsd(breakdown.totalCost)}`));
    console.log(chalk.gray(`  Writes:       ${ctx.allowApply ? 'enabled' : 'disabled'}`));
    console.log(chalk.gray(`  Redaction:    ${ctx.redactEmails ? 'enabled' : 'disabled'}`));
    console.log(chalk.gray(`  Engine:       ${engineConfig ? 'configured' : 'not configured'}`));
    console.log(
      chalk.gray(
        `  Integrations: ${activeIntegrations.length} active (${activeIntegrations.map((d) => d.label).join(', ') || 'none'})`,
      ),
    );
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /cost — show estimated session cost
  if (hasCommand(input, '/cost')) {
    const { calculateCost, formatUsd, formatCostBreakdown } = await import('../lib/pricing.js');
    const snap = metrics.snapshot();
    const model = ctx.agent.getModel();
    const breakdown = calculateCost(snap.tokenUsage, model);
    const totalTokens = snap.tokenUsage.inputTokens + snap.tokenUsage.outputTokens;

    console.log('');
    console.log(chalk.bold('  Session Cost Estimate'));
    console.log(chalk.gray(`  Model: ${model}`));
    console.log(
      chalk.gray(
        `  Tokens: ${totalTokens.toLocaleString()} (${snap.tokenUsage.inputTokens.toLocaleString()} in / ${snap.tokenUsage.outputTokens.toLocaleString()} out)`,
      ),
    );
    console.log('');
    for (const line of formatCostBreakdown(breakdown).split('\n')) {
      console.log(`  ${line}`);
    }
    console.log('');
    const msgCount = ctx.agent.getHistoryLength();
    if (msgCount > 0) {
      const costPerMsg = breakdown.totalCost / Math.ceil(msgCount / 2);
      console.log(chalk.gray(`  Avg cost per exchange: ~${formatUsd(costPerMsg)}`));
    }
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /trends — show historical token/cost trends
  if (hasCommand(input, '/trends')) {
    const arg = input.split(/\s+/).slice(1).join(' ').trim().toLowerCase();
    const { computeTrends, formatTrendsSummary } = await import('../lib/trends.js');
    const { formatUsd } = await import('../lib/pricing.js');

    let days: number | undefined;
    if (arg === '7d') days = 7;
    else if (arg === '30d') days = 30;
    else if (arg === '90d') days = 90;
    else if (arg === 'all') days = undefined;
    else days = 30; // default

    const summary = computeTrends(days);

    if (summary.totalSessions === 0) {
      console.log(formatWarning('No session metrics found. Metrics are saved on session exit.'));
    } else {
      console.log('');
      console.log(chalk.bold(`  Usage Trends${days ? ` (last ${days} days)` : ' (all time)'}`));
      console.log(chalk.gray(`  ─────────────────────────────────────`));
      for (const line of formatTrendsSummary(summary).split('\n')) {
        console.log(`  ${line}`);
      }

      if (summary.topSessionsByCost.length > 1) {
        console.log('');
        console.log(chalk.bold('  Top sessions by cost:'));
        for (const s of summary.topSessionsByCost.slice(0, 5)) {
          console.log(
            chalk.gray(
              `    ${s.date}  ${s.sessionId.padEnd(20)}  ${formatUsd(s.cost).padStart(8)}  ${s.tokens.toLocaleString()} tokens`,
            ),
          );
        }
      }
    }
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /metrics — show session metrics
  if (hasCommand(input, '/metrics')) {
    const tokens = input.split(/\s+/).slice(1);
    const arg = tokens[0]?.toLowerCase();

    if (arg === 'reset') {
      metrics.reset();
      console.log(formatSuccess('Metrics reset.'));
    } else if (arg === 'json') {
      console.log(JSON.stringify(metrics.snapshot(), null, 2));
    } else {
      const snap = metrics.snapshot();

      // Counters
      const counterEntries = Object.entries(snap.counters);
      if (counterEntries.length > 0) {
        console.log(chalk.bold('Counters:'));
        const rows = counterEntries.map(([name, value]) => ({ name, value: String(value) }));
        console.log(formatTable(rows, ['name', 'value']));
      }

      // Token usage
      const tu = snap.tokenUsage;
      if (tu.inputTokens > 0 || tu.outputTokens > 0) {
        console.log(chalk.bold('Token Usage:'));
        console.log(
          `  Input: ${tu.inputTokens}  Output: ${tu.outputTokens}  Cache-create: ${tu.cacheCreationInputTokens}  Cache-read: ${tu.cacheReadInputTokens}`,
        );
      }

      // Tool breakdown
      if (snap.toolBreakdown.length > 0) {
        console.log(chalk.bold('Tool Breakdown:'));
        const rows = snap.toolBreakdown.map((t) => ({
          tool: t.name,
          calls: String(t.calls),
          errors: String(t.errors),
          'p50 ms': String(Math.round(t.p50Ms)),
          'p95 ms': String(Math.round(t.p95Ms)),
        }));
        console.log(formatTable(rows, ['tool', 'calls', 'errors', 'p50 ms', 'p95 ms']));
      }

      // Connection events
      if (snap.connectionEvents.length > 0) {
        console.log(chalk.bold('Connection Events:'));
        for (const evt of snap.connectionEvents.slice(-5)) {
          const ts = evt.timestamp.slice(11, 23);
          const dur = evt.durationMs ? ` (${evt.durationMs}ms)` : '';
          const err = evt.error ? ` — ${evt.error}` : '';
          console.log(`  ${ts} ${evt.type}${dur}${err}`);
        }
      }

      if (counterEntries.length === 0 && snap.toolBreakdown.length === 0) {
        console.log(formatSuccess('No metrics recorded yet.'));
      }
    }
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /help — show help (optionally for a specific command or category)
  if (hasCommand(input, '/help') || hasCommand(input, '/commands')) {
    const arg = input.split(/\s+/).slice(1).join(' ').trim();
    if (arg) {
      // Try to find a command by name or alias
      const cmd = findCommand(arg.startsWith('/') ? arg : `/${arg}`);
      if (cmd) {
        printCommandHelp(cmd);
        ctx.rl.prompt();
        return { handled: true };
      }
      const category = resolveHelpCategory(arg);
      if (category) {
        printCategoryCommands(category);
        ctx.rl.prompt();
        return { handled: true };
      }
      const matches = findHelpMatches(arg);
      if (matches.length > 0) {
        printHelpMatches(arg, matches);
        console.log(chalk.gray('  Tip: use /help <command> for full details.'));
        console.log('');
        ctx.rl.prompt();
        return { handled: true };
      }
      console.log(
        formatWarning(`No command or category found: "${arg}". Use /help for full list.`),
      );
      const suggestions = getSubcommandSuggestions(normalizeHelpLookup(arg), [
        ...HELP_CATEGORIES,
        ...getRegisteredCommands().map((cmd) => normalizeHelpLookup(cmd.name)),
      ]);
      if (suggestions.length > 0) {
        console.log(formatWarning(`Try: ${suggestions.join(', ')}`));
      }
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }
    printHelp();
    ctx.rl.prompt();
    return { handled: true };
  }

  // /capabilities — show the CLI grouped by jobs-to-be-done
  if (hasCommand(input, '/capabilities') || hasCommand(input, '/caps')) {
    const arg = input.split(/\s+/).slice(1).join(' ').trim();
    printCapabilityMap(arg || undefined, false);
    ctx.rl.prompt();
    return { handled: true };
  }

  // /clear — clear conversation history
  if (hasCommand(input, '/clear')) {
    ctx.agent.clearHistory();
    try {
      ctx.sessionStore.clear();
    } catch (error) {
      console.error(formatError(`Unable to clear session history: ${getErrorMessage(error)}`));
    }
    console.log(formatSuccess('Conversation history cleared.'));
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /history — show message count
  if (hasCommand(input, '/history')) {
    const count = ctx.agent.getHistoryLength();
    console.log(formatSuccess(`Conversation history: ${count} messages.`));
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /context — show context window usage
  if (hasCommand(input, '/context')) {
    const current = ctx.agent.getHistoryLength();
    const max = ctx.agent.getMaxHistoryMessages();
    const pct = max > 0 ? Math.round((current / max) * 100) : 0;
    const barWidth = 20;
    const filled = Math.round((pct / 100) * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
    const trimInfo = ctx.agent.getLastTrimInfo();
    console.log('');
    console.log(chalk.bold('  Context Window'));
    console.log(`  Messages: ${current}/${max} (${pct}%) [${bar}]`);
    console.log(chalk.gray(`  Model: ${ctx.model}`));
    if (trimInfo?.trimmed) {
      console.log(
        chalk.yellow(
          `  Note: History was trimmed (${trimInfo.messagesBefore} → ${trimInfo.messagesAfter} messages)`,
        ),
      );
    }
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /copy — copy last assistant response to clipboard
  if (hasCommand(input, '/copy')) {
    const history = ctx.agent.getHistory();
    let lastAssistantText: string | null = null;
    if (Array.isArray(history)) {
      for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg.role === 'assistant') {
          if (typeof msg.content === 'string') {
            lastAssistantText = msg.content;
          } else if (Array.isArray(msg.content)) {
            const texts: string[] = [];
            for (const block of msg.content) {
              if ('type' in block && block.type === 'text' && 'text' in block) {
                texts.push((block as { text: string }).text);
              }
            }
            lastAssistantText = texts.join('\n') || null;
          }
          if (lastAssistantText) break;
        }
      }
    }
    if (!lastAssistantText) {
      console.log(formatWarning('No assistant response to copy.'));
    } else {
      const { copyToClipboard } = await import('../lib/clipboard.js');
      if (copyToClipboard(lastAssistantText)) {
        console.log(formatSuccess('Copied to clipboard.'));
      } else {
        console.log(formatWarning('Could not copy to clipboard. No clipboard tool found.'));
      }
    }
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /retry — resend the last user message
  if (hasCommand(input, '/retry')) {
    if (!ctx.lastUserMessage) {
      console.log(formatWarning('No previous message to retry.'));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }
    return { handled: true, sendMessage: ctx.lastUserMessage };
  }

  // /extensions — list loaded extensions
  if (hasCommand(input, '/extensions')) {
    const loaded = ctx.extensions.listExtensions();
    const diagnostics = ctx.extensions.listDiagnostics();
    if (loaded.length === 0) {
      console.log(formatSuccess('No extensions loaded.'));
    } else {
      console.log(formatSuccess('Loaded extensions:'));
      const rows = loaded.map((ext) => ({
        name: ext.name,
        commands: ext.commands.map((cmd) => cmd.name).join(', ') || '-',
        hooks:
          ext.toolHooks.length > 0 || ext.toolResultHooks.length > 0
            ? `pre:${ext.toolHooks.length} post:${ext.toolResultHooks.length}`
            : '-',
        path: ext.path,
      }));
      console.log(formatTable(rows, ['name', 'commands', 'hooks', 'path']));
    }

    if (diagnostics.length > 0) {
      console.log(formatWarning('Extension diagnostics:'));
      for (const diag of diagnostics) {
        console.log(chalk.gray(`  - ${diag.source}: ${diag.message}`));
      }
    }

    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /reload — reload extensions
  if (hasCommand(input, '/reload')) {
    try {
      await ctx.extensions.load(ctx.cwd);
      console.log(formatSuccess('Extensions reloaded.'));
    } catch (err) {
      console.error(formatError(getErrorMessage(err)));
    }
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /integrations — show integration status or run setup
  if (hasCommand(input, '/integrations')) {
    const tokens = input.split(/\s+/).slice(1);
    const action = tokens[0];
    if (action === 'status') {
      ctx.printIntegrationStatus();
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }
    if (action === 'health') {
      const detailed = tokens.includes('--detailed');
      printIntegrationHealth(
        process.cwd(),
        tokens[1] === '--detailed' ? undefined : tokens[1],
        detailed,
      );
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }
    if (action === 'limits') {
      printIntegrationLimits(process.cwd(), tokens[1]);
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }
    if (action === 'logs') {
      let integration: string | undefined;
      let last: number | undefined;
      const args = tokens.slice(1);
      for (let i = 0; i < args.length; i++) {
        const token = args[i];
        if (!token) continue;
        if (token === '--last') {
          const next = args[i + 1];
          if (next && !next.startsWith('--')) {
            const parsed = Number.parseInt(next, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
              last = parsed;
            }
            i += 1;
          }
          continue;
        }
        if (token.startsWith('--last=')) {
          const parsed = Number.parseInt(token.slice('--last='.length), 10);
          if (Number.isFinite(parsed) && parsed > 0) {
            last = parsed;
          }
          continue;
        }
        if (!token.startsWith('--') && !integration) {
          integration = token;
        }
      }
      printIntegrationLogs(process.cwd(), integration, last);
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }
    if (action === 'setup') {
      let setupSucceeded = false;
      ctx.rl.pause();
      ctx.rl.removeListener('line', ctx.handleLine);
      try {
        await ctx.runIntegrationsSetup();
        setupSucceeded = true;
      } catch (err) {
        console.error(formatError(getErrorMessage(err)));
      } finally {
        if (!ctx.rl.listeners('line').includes(ctx.handleLine)) {
          ctx.rl.on('line', ctx.handleLine);
        }
        ctx.rl.resume();
      }
      if (setupSucceeded) {
        try {
          await ctx.reconnectAgent();
          const memory = loadMemory(ctx.sessionId);
          ctx.agent.setSystemPrompt(
            buildSystemPrompt({
              sessionId: ctx.sessionId,
              memory,
              cwd: ctx.cwd,
              activeSkills: ctx.activeSkills,
            }),
          );
          console.log(formatSuccess('Integration tools refreshed.'));
        } catch (err) {
          console.error(formatError(getErrorMessage(err)));
          console.log(formatWarning('Restart the chat session if tools appear missing.'));
        }
      }
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }
    if (action && !action.startsWith('--')) {
      console.log(
        formatWarning(
          `Unknown /integrations subcommand "${action}". Available: ${INTEGRATIONS_SUBCOMMANDS.join(', ')}.`,
        ),
      );
      const suggestions = getSubcommandSuggestions(action, INTEGRATIONS_SUBCOMMANDS);
      if (suggestions.length > 0) {
        console.log(formatWarning(`Did you mean: ${suggestions.join(', ')}?`));
      }
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    ctx.printIntegrationStatus();
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /skills — list available skills
  if (hasCommand(input, '/skills')) {
    const skills = listSkills(ctx.cwd);
    if (skills.length === 0) {
      console.log(formatSuccess('No skills found.'));
    } else {
      console.log(formatSuccess('Available skills:'));
      const rows = skills.map((skill) => ({
        name: skill.name,
        description: (skill.description || '').slice(0, 80),
      }));
      console.log(formatTable(rows, ['name', 'description']));
      if (ctx.activeSkills.length > 0) {
        console.log(chalk.gray(`  Active: ${ctx.activeSkills.join(', ')}`));
      }
    }
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /skill <name> — activate a skill
  if (hasCommand(input, '/skill') && !hasCommand(input, '/skill-clear')) {
    const skillName = input.slice('/skill '.length).trim();
    if (!skillName) {
      console.log(formatWarning('Usage: /skill <name>'));
    } else {
      const skill = getSkill(skillName, ctx.cwd);
      if (!skill) {
        console.log(
          formatWarning(`Skill "${skillName}" not found. Use /skills to list available skills.`),
        );
      } else if (ctx.activeSkills.includes(skillName)) {
        console.log(formatSuccess(`Skill "${skillName}" already active.`));
      } else {
        ctx.activeSkills.push(skillName);
        console.log(formatSuccess(`Skill "${skillName}" activated.`));
      }
    }
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /skill-clear — deactivate all skills
  if (hasCommand(input, '/skill-clear')) {
    ctx.activeSkills.splice(0, ctx.activeSkills.length);
    console.log(formatSuccess('Active skills cleared.'));
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /attach <path> — stage a file attachment
  if (
    hasCommand(input, '/attach') &&
    !hasCommand(input, '/attach-clear') &&
    !hasCommand(input, '/attachments')
  ) {
    const pathInput = input.slice('/attach '.length).trim();
    if (!pathInput) {
      console.log(formatWarning('Usage: /attach <path>'));
    } else {
      ctx.pendingAttachments.push(pathInput);
      console.log(formatSuccess(`Attachment staged (${ctx.pendingAttachments.length} total).`));
    }
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /attachments — list staged attachments
  if (hasCommand(input, '/attachments')) {
    if (ctx.pendingAttachments.length === 0) {
      console.log(formatSuccess('No attachments staged.'));
    } else {
      console.log(formatSuccess('Staged attachments:'));
      for (const p of ctx.pendingAttachments) {
        console.log(chalk.gray(`  - ${p}`));
      }
    }
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /attach-clear — clear all staged attachments
  if (hasCommand(input, '/attach-clear')) {
    ctx.pendingAttachments.length = 0;
    console.log(formatSuccess('Attachments cleared.'));
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  return { handled: false };
}
