import chalk from 'chalk';
import { loadMemory } from '../memory.js';
import { buildSystemPrompt } from '../prompt.js';
import { resolveModelOrThrow, formatUnknownModelError, getModelAliasText } from '../config.js';
import { getErrorMessage } from '../lib/errors.js';
import {
  getOutputMode,
  isJsonMode,
  output,
  outputError,
  outputSuccess,
  outputWarn,
} from '../lib/output.js';
import type { ChatContext, CommandResult } from './types.js';
import { parseToggleValue } from './utils.js';

function printSpacer(): void {
  if (getOutputMode() === 'pretty') {
    console.log('');
  }
}

function printUsage(usage: string): void {
  if (isJsonMode()) {
    return;
  }
  output(`Usage: ${usage}`);
}

function finishHandled(ctx: ChatContext): CommandResult {
  printSpacer();
  ctx.rl.prompt();
  return { handled: true };
}

export async function handleConfigCommand(input: string, ctx: ChatContext): Promise<CommandResult> {
  const applyMatch = /^\/apply(?:\s+(.*))?$/.exec(input);

  // /apply — toggle write operations
  if (applyMatch) {
    const usage = '/apply on|off';
    const arg = applyMatch[1] ? applyMatch[1].trim() : '';
    const parsed = parseToggleValue(arg);
    const current = ctx.allowApply;
    const currentStructuredToolResults =
      process.env.STATESET_MCP_STRUCTURED_TOOL_RESULTS === 'true';
    if (!arg) {
      outputSuccess(`Writes enabled: ${current ? 'yes' : 'no'}`, {
        command: 'apply',
        enabled: current,
        usage,
      });
      printUsage(usage);
      return finishHandled(ctx);
    }
    if (parsed === undefined) {
      outputWarn(`Usage: ${usage}`, { command: 'apply', usage });
      return finishHandled(ctx);
    }
    if (parsed === current) {
      outputSuccess(`Writes already ${current ? 'enabled' : 'disabled'}.`, {
        command: 'apply',
        enabled: current,
        unchanged: true,
      });
      return finishHandled(ctx);
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
      outputError(`Unable to apply writes toggle: ${getErrorMessage(err)}`, {
        command: 'apply',
        enabled: current,
        unchanged: true,
      });
      if (!isJsonMode()) {
        output('Writes setting unchanged.');
      }
      return finishHandled(ctx);
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
    outputSuccess(`Writes ${parsed ? 'enabled' : 'disabled'}.`, {
      command: 'apply',
      enabled: parsed,
    });
    return finishHandled(ctx);
  }

  const redactMatch = /^\/redact(?:\s+(.*))?$/.exec(input);

  // /redact — toggle redaction
  if (redactMatch) {
    const usage = '/redact on|off';
    const arg = redactMatch[1] ? redactMatch[1].trim() : '';
    const parsed = parseToggleValue(arg);
    const current = ctx.redactEmails;
    const currentStructuredToolResults =
      process.env.STATESET_MCP_STRUCTURED_TOOL_RESULTS === 'true';
    if (!arg) {
      outputSuccess(`Redaction: ${current ? 'enabled' : 'disabled'}`, {
        command: 'redact',
        enabled: current,
        usage,
      });
      printUsage(usage);
      return finishHandled(ctx);
    }
    if (parsed === undefined) {
      outputWarn(`Usage: ${usage}`, { command: 'redact', usage });
      return finishHandled(ctx);
    }
    if (parsed === current) {
      outputSuccess(`Redaction already ${current ? 'enabled' : 'disabled'}.`, {
        command: 'redact',
        enabled: current,
        unchanged: true,
      });
      return finishHandled(ctx);
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
      outputError(`Unable to apply redaction toggle: ${getErrorMessage(err)}`, {
        command: 'redact',
        enabled: current,
        unchanged: true,
      });
      if (!isJsonMode()) {
        output('Redaction setting unchanged.');
      }
      return finishHandled(ctx);
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
    outputSuccess(`Redaction ${parsed ? 'enabled' : 'disabled'}.`, {
      command: 'redact',
      enabled: parsed,
    });
    return finishHandled(ctx);
  }

  const agenticMatch = /^\/agentic(?:\s+(.*))?$/.exec(input);

  // /agentic — toggle structured tool result metadata
  if (agenticMatch) {
    const usage = '/agentic on|off';
    const arg = agenticMatch[1] ? agenticMatch[1].trim() : '';
    const parsed = parseToggleValue(arg);
    const current = process.env.STATESET_MCP_STRUCTURED_TOOL_RESULTS === 'true';
    if (!arg) {
      outputSuccess(`Structured tool results: ${current ? 'enabled' : 'disabled'}`, {
        command: 'agentic',
        enabled: current,
        usage,
      });
      printUsage(usage);
      return finishHandled(ctx);
    }
    if (parsed === undefined) {
      outputWarn(`Usage: ${usage}`, { command: 'agentic', usage });
      return finishHandled(ctx);
    }
    if (parsed === current) {
      outputSuccess(`Structured tool results already ${current ? 'enabled' : 'disabled'}.`, {
        command: 'agentic',
        enabled: current,
        unchanged: true,
      });
      return finishHandled(ctx);
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
      outputError(`Unable to toggle structured tool results: ${getErrorMessage(err)}`, {
        command: 'agentic',
        enabled: current,
        unchanged: true,
      });
      if (!isJsonMode()) {
        output('Structured tool results setting unchanged.');
      }
      return finishHandled(ctx);
    }

    outputSuccess(`Structured tool results ${parsed ? 'enabled' : 'disabled'}.`, {
      command: 'agentic',
      enabled: parsed,
    });
    return finishHandled(ctx);
  }

  const usageMatch = /^\/usage(?:\s+(.*))?$/.exec(input);

  // /usage — toggle usage summaries
  if (usageMatch) {
    const usage = '/usage on|off';
    const arg = usageMatch[1] ? usageMatch[1].trim() : '';
    const parsed = parseToggleValue(arg);
    if (!arg) {
      outputSuccess(`Usage summaries: ${ctx.showUsage ? 'enabled' : 'disabled'}`, {
        command: 'usage',
        enabled: ctx.showUsage,
        usage,
      });
      printUsage(usage);
      return finishHandled(ctx);
    }
    if (parsed === undefined) {
      outputWarn(`Usage: ${usage}`, { command: 'usage', usage });
      return finishHandled(ctx);
    }
    ctx.showUsage = parsed;
    outputSuccess(`Usage summaries ${parsed ? 'enabled' : 'disabled'}.`, {
      command: 'usage',
      enabled: parsed,
    });
    return finishHandled(ctx);
  }

  // /model — show or change model
  const modelMatch = /^\/model(?:\s+(.*))?$/.exec(input);
  if (modelMatch) {
    const usage = `/model <${getModelAliasText('list').replace(/,\s*/g, '|')} | full model ID>`;
    const modelArg = modelMatch[1] ? modelMatch[1].trim() : '';
    if (!modelArg || modelArg === '--chain' || modelArg === '--show-chain') {
      const currentModel = ctx.agent.getModel();
      if (modelArg === '--chain' || modelArg === '--show-chain') {
        const { getFallbackChain } = await import('../lib/model-fallback.js');
        const chain = getFallbackChain();
        outputSuccess(`Current model: ${currentModel}`, {
          command: 'model',
          currentModel,
          fallbackChain: chain,
        });
        if (!isJsonMode()) {
          output(chalk.gray(`  Fallback chain: ${chain.join(' → ')}`));
        }
      } else {
        outputSuccess(`Current model: ${currentModel}`, {
          command: 'model',
          currentModel,
          usage,
        });
        if (!isJsonMode()) {
          printUsage(usage);
          output('Use /model --chain to see the fallback chain.');
        }
      }
    } else {
      try {
        const resolved = resolveModelOrThrow(modelArg);
        ctx.agent.setModel(resolved);
        outputSuccess(`Model switched to: ${resolved}`, {
          command: 'model',
          previousModel: ctx.model,
          currentModel: resolved,
        });
      } catch {
        outputWarn(formatUnknownModelError(modelArg), {
          command: 'model',
          input: modelArg,
          validModels: getModelAliasText('list').split(/,\s*/),
        });
      }
    }
    return finishHandled(ctx);
  }

  return { handled: false };
}
