import { handleChatCommand } from './commands-chat.js';
import { handleSessionCommand } from './commands-session.js';
import { handleExportCommand } from './commands-export.js';
import { handleShortcutCommand } from './commands-shortcuts.js';
import { handleEngineCommand, handleWorkflowsCommand } from './commands-engine.js';
import { handleOnboardCommand } from './commands-onboard.js';
import { handleFinetuneCommand, handleEvalsSuggestCommand } from './commands-finetune.js';
import { handleRulesGenerateCommand } from './commands-rules-generate.js';
import { findCommand, registerAllCommands } from './command-registry.js';
import type { ChatContext, CommandResult } from './types.js';
import { formatError } from '../utils/display.js';
import { getErrorMessage } from '../lib/errors.js';
import type { ExtensionCommand } from '../extensions.js';

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && value.trim().length > 0;
};

function normalizeSlashCommandAlias(input: string): string {
  const trimmedStart = input.trimStart();
  if (!trimmedStart.startsWith('/')) {
    return input;
  }

  registerAllCommands();
  const firstWhitespace = trimmedStart.search(/\s/);
  const rawCommand = firstWhitespace === -1 ? trimmedStart : trimmedStart.slice(0, firstWhitespace);
  const commandSuffix = firstWhitespace === -1 ? '' : trimmedStart.slice(firstWhitespace);
  const commandDefinition = findCommand(rawCommand.toLowerCase());
  if (!commandDefinition) {
    return trimmedStart;
  }

  return `${commandDefinition.name}${commandSuffix}`;
}

/**
 * Route a slash command to the appropriate handler module.
 *
 * Returns `{ handled: true }` if the command was processed.
 * Returns `{ handled: true, sendMessage }` if the command produced
 * a message that should be sent to the agent.
 * Returns `{ handled: true, needsPrompt: true }` if the command was
 * handled locally and the caller should continue prompting, or if a
 * command handler throws while processing.
 * Returns `{ handled: false }` if no handler matched.
 */
export async function routeSlashCommand(input: string, ctx: ChatContext): Promise<CommandResult> {
  const routedInput = normalizeSlashCommandAlias(input);

  // Chat meta-commands: help, clear, history, extensions, reload,
  // apply, redact, usage, audit, permissions, policy, integrations,
  // model, skills, skill, prompts, prompt, attach, etc.
  let chatResult: CommandResult;
  try {
    chatResult = await handleChatCommand(routedInput, ctx);
  } catch (err) {
    console.error(formatError(getErrorMessage(err)));
    return { handled: true, needsPrompt: true };
  }
  if (chatResult?.handled === true) {
    if (chatResult.sendMessage !== undefined) {
      if (!isNonEmptyString(chatResult.sendMessage)) {
        return { handled: true, needsPrompt: true };
      }
      return { handled: true, sendMessage: chatResult.sendMessage };
    }
    if (chatResult.needsPrompt === true) {
      return { handled: true, needsPrompt: true };
    }
    if (chatResult.needsPrompt !== undefined && chatResult.needsPrompt !== false) {
      return { handled: true, needsPrompt: true };
    }
    return { handled: true };
  }

  // Session commands: session, sessions, new, resume, rename, delete,
  // archive, unarchive, tag, search, session-meta
  try {
    if (await handleSessionCommand(routedInput, ctx)) {
      return { handled: true };
    }
  } catch (err) {
    console.error(formatError(getErrorMessage(err)));
    return { handled: true, needsPrompt: true };
  }

  // Export commands: export, export-list, export-show, export-open,
  // export-delete, export-prune
  try {
    if (await handleExportCommand(routedInput, ctx)) {
      return { handled: true };
    }
  } catch (err) {
    console.error(formatError(getErrorMessage(err)));
    return { handled: true, needsPrompt: true };
  }

  // Engine commands: /engine, /engine setup, /engine brands, etc.
  try {
    const engineResult = await handleEngineCommand(routedInput, ctx);
    if (engineResult.handled) {
      return engineResult;
    }
  } catch (err) {
    console.error(formatError(getErrorMessage(err)));
    return { handled: true, needsPrompt: true };
  }

  // Workflow commands: /workflows list, /workflows status, etc.
  try {
    const workflowResult = await handleWorkflowsCommand(routedInput, ctx);
    if (workflowResult.handled) {
      return workflowResult;
    }
  } catch (err) {
    console.error(formatError(getErrorMessage(err)));
    return { handled: true, needsPrompt: true };
  }

  // Onboard command: /onboard, /onboard init
  try {
    const onboardResult = await handleOnboardCommand(routedInput, ctx);
    if (onboardResult.handled) {
      return onboardResult;
    }
  } catch (err) {
    console.error(formatError(getErrorMessage(err)));
    return { handled: true, needsPrompt: true };
  }

  // Finetune commands: /finetune [list|export|create|deploy]
  try {
    const finetuneResult = await handleFinetuneCommand(routedInput, ctx);
    if (finetuneResult.handled) {
      return finetuneResult;
    }
  } catch (err) {
    console.error(formatError(getErrorMessage(err)));
    return { handled: true, needsPrompt: true };
  }

  // Evals suggest: /evals suggest
  try {
    const evalsSuggestResult = await handleEvalsSuggestCommand(routedInput, ctx);
    if (evalsSuggestResult.handled) {
      return evalsSuggestResult;
    }
  } catch (err) {
    console.error(formatError(getErrorMessage(err)));
    return { handled: true, needsPrompt: true };
  }

  // Rules generate: /rules generate [brand-slug]
  try {
    const rulesGenResult = await handleRulesGenerateCommand(routedInput, ctx);
    if (rulesGenResult.handled) {
      return rulesGenResult;
    }
  } catch (err) {
    console.error(formatError(getErrorMessage(err)));
    return { handled: true, needsPrompt: true };
  }

  // Shortcut commands: /rules, /kb, /agents, /channels, /convos, /status, /test, etc.
  try {
    const shortcutResult = await handleShortcutCommand(routedInput, ctx);
    if (shortcutResult.handled) {
      return shortcutResult;
    }
  } catch (err) {
    console.error(formatError(getErrorMessage(err)));
    return { handled: true, needsPrompt: true };
  }

  const trimmed = routedInput.slice(1).trim();
  if (trimmed) {
    const [rawCommandName, ...restParts] = trimmed.split(/\s+/);
    const commandName = rawCommandName.slice(0, 64);
    let extCommand: (ExtensionCommand & { source: string }) | null = null;
    try {
      extCommand = ctx.extensions?.getCommand ? ctx.extensions.getCommand(commandName) : null;
    } catch (err) {
      console.error(formatError(getErrorMessage(err)));
      return { handled: true, needsPrompt: true };
    }
    if (extCommand) {
      try {
        const EXTENSION_HANDLER_TIMEOUT_MS = 30_000;
        const result = await Promise.race([
          extCommand.handler(restParts.join(' '), ctx.buildExtensionContext()),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `Extension command "${commandName}" timed out after ${EXTENSION_HANDLER_TIMEOUT_MS}ms`,
                  ),
                ),
              EXTENSION_HANDLER_TIMEOUT_MS,
            ),
          ),
        ]);
        if (typeof result === 'string') {
          if (!isNonEmptyString(result)) {
            return { handled: true, needsPrompt: true };
          }
          return { handled: true, sendMessage: result };
        }
        if (result && typeof result === 'object') {
          if ('send' in result && typeof (result as { send?: unknown }).send === 'string') {
            const { send } = result as { send: string };
            if (!isNonEmptyString(send)) {
              return { handled: true, needsPrompt: true };
            }
            return { handled: true, sendMessage: send };
          }
          if ('handled' in result) {
            const { handled } = result as { handled: unknown };
            if (handled === true) {
              return { handled: true };
            }
          }
        }
        return { handled: true, needsPrompt: true };
      } catch (err) {
        console.error(formatError(getErrorMessage(err)));
        return { handled: true, needsPrompt: true };
      }
    }
  }

  return { handled: false };
}
