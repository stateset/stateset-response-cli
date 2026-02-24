import chalk from 'chalk';
import { loadMemory } from '../memory.js';
import { buildSystemPrompt } from '../prompt.js';
import { resolveModelOrThrow, formatUnknownModelError, getModelAliasText } from '../config.js';
import { getErrorMessage } from '../lib/errors.js';
import { formatError, formatSuccess, formatWarning } from '../utils/display.js';
import type { ChatContext, CommandResult } from './types.js';
import { parseToggleValue } from './utils.js';

export async function handleConfigCommand(input: string, ctx: ChatContext): Promise<CommandResult> {
  const applyMatch = /^\/apply(?:\s+(.*))?$/.exec(input);

  // /apply — toggle write operations
  if (applyMatch) {
    const arg = applyMatch[1] ? applyMatch[1].trim() : '';
    const parsed = parseToggleValue(arg);
    const current = ctx.allowApply;
    const currentStructuredToolResults =
      process.env.STATESET_MCP_STRUCTURED_TOOL_RESULTS === 'true';
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

    ctx.allowApply = parsed;
    ctx.agent.setMcpEnvOverrides({
      STATESET_ALLOW_APPLY: ctx.allowApply ? 'true' : 'false',
      STATESET_REDACT: ctx.redactEmails ? 'true' : 'false',
      STATESET_MCP_STRUCTURED_TOOL_RESULTS: currentStructuredToolResults ? 'true' : 'false',
    });
    try {
      await ctx.reconnectAgent();
    } catch (err) {
      ctx.allowApply = current;
      ctx.agent.setMcpEnvOverrides({
        STATESET_ALLOW_APPLY: ctx.allowApply ? 'true' : 'false',
        STATESET_REDACT: ctx.redactEmails ? 'true' : 'false',
        STATESET_MCP_STRUCTURED_TOOL_RESULTS: currentStructuredToolResults ? 'true' : 'false',
      });
      console.error(formatError(`Unable to apply writes toggle: ${getErrorMessage(err)}`));
      console.log(chalk.gray('  Writes setting unchanged.'));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
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

  const redactMatch = /^\/redact(?:\s+(.*))?$/.exec(input);

  // /redact — toggle redaction
  if (redactMatch) {
    const arg = redactMatch[1] ? redactMatch[1].trim() : '';
    const parsed = parseToggleValue(arg);
    const current = ctx.redactEmails;
    const currentStructuredToolResults =
      process.env.STATESET_MCP_STRUCTURED_TOOL_RESULTS === 'true';
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

    ctx.redactEmails = parsed;
    ctx.agent.setMcpEnvOverrides({
      STATESET_ALLOW_APPLY: ctx.allowApply ? 'true' : 'false',
      STATESET_REDACT: ctx.redactEmails ? 'true' : 'false',
      STATESET_MCP_STRUCTURED_TOOL_RESULTS: currentStructuredToolResults ? 'true' : 'false',
    });
    try {
      await ctx.reconnectAgent();
    } catch (err) {
      ctx.redactEmails = current;
      ctx.agent.setMcpEnvOverrides({
        STATESET_ALLOW_APPLY: ctx.allowApply ? 'true' : 'false',
        STATESET_REDACT: ctx.redactEmails ? 'true' : 'false',
        STATESET_MCP_STRUCTURED_TOOL_RESULTS: currentStructuredToolResults ? 'true' : 'false',
      });
      console.error(formatError(`Unable to apply redaction toggle: ${getErrorMessage(err)}`));
      console.log(chalk.gray('  Redaction setting unchanged.'));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
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

  const agenticMatch = /^\/agentic(?:\s+(.*))?$/.exec(input);

  // /agentic — toggle structured tool result metadata
  if (agenticMatch) {
    const arg = agenticMatch[1] ? agenticMatch[1].trim() : '';
    const parsed = parseToggleValue(arg);
    const current = process.env.STATESET_MCP_STRUCTURED_TOOL_RESULTS === 'true';
    if (!arg) {
      console.log(formatSuccess(`Structured tool results: ${current ? 'enabled' : 'disabled'}`));
      console.log(chalk.gray('  Usage: /agentic on|off'));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }
    if (parsed === undefined) {
      console.log(formatWarning('Usage: /agentic on|off'));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }
    if (parsed === current) {
      console.log(
        formatSuccess(`Structured tool results already ${current ? 'enabled' : 'disabled'}.`),
      );
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    process.env.STATESET_MCP_STRUCTURED_TOOL_RESULTS = parsed ? 'true' : 'false';
    ctx.agent.setMcpEnvOverrides({
      STATESET_ALLOW_APPLY: ctx.allowApply ? 'true' : 'false',
      STATESET_REDACT: ctx.redactEmails ? 'true' : 'false',
      STATESET_MCP_STRUCTURED_TOOL_RESULTS: parsed ? 'true' : 'false',
    });
    try {
      await ctx.reconnectAgent();
    } catch (err) {
      process.env.STATESET_MCP_STRUCTURED_TOOL_RESULTS = current ? 'true' : 'false';
      ctx.agent.setMcpEnvOverrides({
        STATESET_ALLOW_APPLY: ctx.allowApply ? 'true' : 'false',
        STATESET_REDACT: ctx.redactEmails ? 'true' : 'false',
        STATESET_MCP_STRUCTURED_TOOL_RESULTS: current ? 'true' : 'false',
      });
      console.error(
        formatError(`Unable to toggle structured tool results: ${getErrorMessage(err)}`),
      );
      console.log(chalk.gray('  Structured tool results setting unchanged.'));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    console.log(formatSuccess(`Structured tool results ${parsed ? 'enabled' : 'disabled'}.`));
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  const usageMatch = /^\/usage(?:\s+(.*))?$/.exec(input);

  // /usage — toggle usage summaries
  if (usageMatch) {
    const arg = usageMatch[1] ? usageMatch[1].trim() : '';
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
    console.log(formatSuccess(`Usage summaries ${parsed ? 'enabled' : 'disabled'}.`));
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /model — show or change model
  const modelMatch = /^\/model(?:\s+(.*))?$/.exec(input);
  if (modelMatch) {
    const modelArg = modelMatch[1] ? modelMatch[1].trim() : '';
    if (!modelArg) {
      console.log(formatSuccess(`Current model: ${ctx.agent.getModel()}`));
      console.log(
        chalk.gray(
          `  Usage: /model <${getModelAliasText('list').replace(/,\s*/g, '|')} | full model ID>`,
        ),
      );
    } else {
      try {
        const resolved = resolveModelOrThrow(modelArg);
        ctx.agent.setModel(resolved);
        console.log(formatSuccess(`Model switched to: ${resolved}`));
      } catch {
        console.log(formatWarning(formatUnknownModelError(modelArg)));
      }
    }
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  return { handled: false };
}
