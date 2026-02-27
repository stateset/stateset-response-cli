import chalk from 'chalk';
import { loadMemory } from '../memory.js';
import { buildSystemPrompt } from '../prompt.js';
import {
  printHelp,
  formatError,
  formatSuccess,
  formatWarning,
  formatTable,
} from '../utils/display.js';
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

export async function handleChatCommand(input: string, ctx: ChatContext): Promise<CommandResult> {
  const prefix = input.split(/\s/)[0];

  // Delegate to extracted command modules
  if (['/apply', '/redact', '/agentic', '/usage', '/model'].includes(prefix)) {
    return await handleConfigCommand(input, ctx);
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

  // /help — show help
  if (hasCommand(input, '/help')) {
    printHelp();
    ctx.rl.prompt();
    return { handled: true };
  }

  // /clear — clear conversation history
  if (hasCommand(input, '/clear')) {
    ctx.agent.clearHistory();
    ctx.sessionStore.clear();
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
