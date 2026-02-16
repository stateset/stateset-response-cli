import chalk from 'chalk';
import { loadMemory } from '../memory.js';
import { buildSystemPrompt } from '../prompt.js';
import { resolveModel } from '../config.js';
import { formatError, formatSuccess, formatWarning } from '../utils/display.js';
import type { ChatContext, CommandResult } from './types.js';
import { parseToggleValue } from './utils.js';

export async function handleConfigCommand(input: string, ctx: ChatContext): Promise<CommandResult> {
  // /apply — toggle write operations
  if (input.startsWith('/apply')) {
    const arg = input.slice('/apply'.length).trim();
    const parsed = parseToggleValue(arg);
    const current = process.env.STATESET_ALLOW_APPLY === 'true';
    if (!arg) {
      console.log(formatSuccess(`Writes enabled: ${current ? 'yes' : 'no'}`));
      console.log(chalk.gray('  Usage: /apply on|off'));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }
    if (parsed === undefined) {
      console.log(formatWarning('Usage: /apply on|off'));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }
    if (parsed === current) {
      console.log(formatSuccess(`Writes already ${current ? 'enabled' : 'disabled'}.`));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    process.env.STATESET_ALLOW_APPLY = parsed ? 'true' : 'false';
    try {
      await ctx.reconnectAgent();
    } catch (err) {
      process.env.STATESET_ALLOW_APPLY = current ? 'true' : 'false';
      console.error(formatError(err instanceof Error ? err.message : String(err)));
    }
    const memory = loadMemory(ctx.sessionId);
    ctx.agent.setSystemPrompt(
      buildSystemPrompt({
        sessionId: ctx.sessionId,
        memory,
        cwd: ctx.cwd,
        activeSkills: ctx.activeSkills,
      }),
    );
    console.log(formatSuccess(`Writes ${parsed ? 'enabled' : 'disabled'}.`));
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /redact — toggle redaction
  if (input.startsWith('/redact')) {
    const arg = input.slice('/redact'.length).trim();
    const parsed = parseToggleValue(arg);
    const current = process.env.STATESET_REDACT === 'true';
    if (!arg) {
      console.log(formatSuccess(`Redaction: ${current ? 'enabled' : 'disabled'}`));
      console.log(chalk.gray('  Usage: /redact on|off'));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }
    if (parsed === undefined) {
      console.log(formatWarning('Usage: /redact on|off'));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }
    if (parsed === current) {
      console.log(formatSuccess(`Redaction already ${current ? 'enabled' : 'disabled'}.`));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    process.env.STATESET_REDACT = parsed ? 'true' : 'false';
    try {
      await ctx.reconnectAgent();
    } catch (err) {
      process.env.STATESET_REDACT = current ? 'true' : 'false';
      console.error(formatError(err instanceof Error ? err.message : String(err)));
    }
    const memory = loadMemory(ctx.sessionId);
    ctx.agent.setSystemPrompt(
      buildSystemPrompt({
        sessionId: ctx.sessionId,
        memory,
        cwd: ctx.cwd,
        activeSkills: ctx.activeSkills,
      }),
    );
    console.log(formatSuccess(`Redaction ${parsed ? 'enabled' : 'disabled'}.`));
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /usage — toggle usage summaries
  if (input.startsWith('/usage')) {
    const arg = input.slice('/usage'.length).trim();
    const parsed = parseToggleValue(arg);
    if (!arg) {
      console.log(formatSuccess(`Usage summaries: ${ctx.showUsage ? 'enabled' : 'disabled'}`));
      console.log(chalk.gray('  Usage: /usage on|off'));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }
    if (parsed === undefined) {
      console.log(formatWarning('Usage: /usage on|off'));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }
    ctx.showUsage = parsed;
    process.env.STATESET_SHOW_USAGE = parsed ? 'true' : 'false';
    console.log(formatSuccess(`Usage summaries ${parsed ? 'enabled' : 'disabled'}.`));
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /model — show or change model
  if (input.startsWith('/model')) {
    const modelArg = input.slice(6).trim();
    if (!modelArg) {
      console.log(formatSuccess(`Current model: ${ctx.agent.getModel()}`));
      console.log(chalk.gray('  Usage: /model <sonnet|haiku|opus>'));
    } else {
      const resolved = resolveModel(modelArg);
      if (resolved) {
        ctx.agent.setModel(resolved);
        console.log(formatSuccess(`Model switched to: ${resolved}`));
      } else {
        console.log(formatWarning(`Unknown model "${modelArg}". Use sonnet, haiku, or opus.`));
      }
    }
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  return { handled: false };
}
