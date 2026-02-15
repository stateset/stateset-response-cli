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
import type { ChatContext } from './types.js';
import { handleConfigCommand } from './commands-config.js';
import { handleAuditCommand } from './commands-audit.js';
import { handlePolicyCommand } from './commands-policy.js';
import { handleTemplateCommand } from './commands-templates.js';

export async function handleChatCommand(
  input: string,
  ctx: ChatContext,
): Promise<{ handled: boolean; sendMessage?: string }> {
  const prefix = input.split(/\s/)[0];

  // Delegate to extracted command modules
  if (['/apply', '/redact', '/usage', '/model'].includes(prefix)) {
    return (await handleConfigCommand(input, ctx))!;
  }
  if (prefix.startsWith('/audit')) {
    return (await handleAuditCommand(input, ctx))!;
  }
  if (prefix === '/permissions' || prefix === '/policy') {
    return (await handlePolicyCommand(input, ctx))!;
  }
  if (['/prompts', '/prompt-history', '/prompt-validate', '/prompt'].includes(prefix)) {
    return (await handleTemplateCommand(input, ctx))!;
  }

  // /help — show help
  if (input === '/help') {
    printHelp();
    ctx.rl.prompt();
    return { handled: true };
  }

  // /clear — clear conversation history
  if (input === '/clear') {
    ctx.agent.clearHistory();
    ctx.sessionStore.clear();
    console.log(formatSuccess('Conversation history cleared.'));
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /history — show message count
  if (input === '/history') {
    const count = ctx.agent.getHistoryLength();
    console.log(formatSuccess(`Conversation history: ${count} messages.`));
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /extensions — list loaded extensions
  if (input === '/extensions') {
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
  if (input === '/reload') {
    try {
      await ctx.extensions.load(ctx.cwd);
      console.log(formatSuccess('Extensions reloaded.'));
    } catch (err) {
      console.error(formatError(err instanceof Error ? err.message : String(err)));
    }
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /integrations — show integration status or run setup
  if (input.startsWith('/integrations')) {
    const tokens = input.split(/\s+/).slice(1);
    const action = tokens[0];
    if (action === 'setup') {
      let setupSucceeded = false;
      ctx.rl.pause();
      ctx.rl.removeListener('line', ctx.handleLine);
      try {
        await ctx.runIntegrationsSetup();
        setupSucceeded = true;
      } catch (err) {
        console.error(formatError(err instanceof Error ? err.message : String(err)));
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
          console.error(formatError(err instanceof Error ? err.message : String(err)));
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
  if (input === '/skills') {
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
  if (input.startsWith('/skill ') && !input.startsWith('/skill-clear')) {
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
  if (input === '/skill-clear') {
    ctx.activeSkills.splice(0, ctx.activeSkills.length);
    console.log(formatSuccess('Active skills cleared.'));
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /attach <path> — stage a file attachment
  if (
    input.startsWith('/attach ') &&
    !input.startsWith('/attach-clear') &&
    !input.startsWith('/attachments')
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
  if (input === '/attachments') {
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
  if (input === '/attach-clear') {
    ctx.pendingAttachments.length = 0;
    console.log(formatSuccess('Attachments cleared.'));
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // Extension command fallthrough
  if (input.startsWith('/')) {
    const trimmed = input.slice(1).trim();
    if (trimmed) {
      const [commandName, ...restParts] = trimmed.split(/\s+/);
      const extCommand = ctx.extensions.getCommand(commandName);
      if (extCommand) {
        try {
          const result = await extCommand.handler(restParts.join(' '), ctx.buildExtensionContext());
          if (typeof result === 'string') {
            return { handled: true, sendMessage: result };
          } else if (result && typeof result === 'object' && 'send' in result) {
            return { handled: true, sendMessage: String((result as { send: string }).send) };
          } else {
            console.log('');
            ctx.rl.prompt();
            return { handled: true };
          }
        } catch (err) {
          console.error(formatError(err instanceof Error ? err.message : String(err)));
          console.log('');
          ctx.rl.prompt();
          return { handled: true };
        }
      }
    }
  }

  return { handled: false };
}
