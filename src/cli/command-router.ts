import { handleChatCommand } from './commands-chat.js';
import { handleSessionCommand } from './commands-session.js';
import { handleExportCommand } from './commands-export.js';
import type { ChatContext, CommandResult } from './types.js';
import { formatError } from '../utils/display.js';
import type { ExtensionCommand } from '../extensions.js';

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && value.trim().length > 0;
};

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
  // Chat meta-commands: help, clear, history, extensions, reload,
  // apply, redact, usage, audit, permissions, policy, integrations,
  // model, skills, skill, prompts, prompt, attach, etc.
  let chatResult: CommandResult;
  try {
    chatResult = await handleChatCommand(input, ctx);
  } catch (err) {
    console.error(formatError(err instanceof Error ? err.message : String(err)));
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
    if (await handleSessionCommand(input, ctx)) {
      return { handled: true };
    }
  } catch (err) {
    console.error(formatError(err instanceof Error ? err.message : String(err)));
    return { handled: true, needsPrompt: true };
  }

  // Export commands: export, export-list, export-show, export-open,
  // export-delete, export-prune
  try {
    if (await handleExportCommand(input, ctx)) {
      return { handled: true };
    }
  } catch (err) {
    console.error(formatError(err instanceof Error ? err.message : String(err)));
    return { handled: true, needsPrompt: true };
  }

  const trimmed = input.slice(1).trim();
  if (trimmed) {
    const [commandName, ...restParts] = trimmed.split(/\s+/);
    let extCommand: (ExtensionCommand & { source: string }) | null = null;
    try {
      extCommand = ctx.extensions?.getCommand ? ctx.extensions.getCommand(commandName) : null;
    } catch (err) {
      console.error(formatError(err instanceof Error ? err.message : String(err)));
      return { handled: true, needsPrompt: true };
    }
    if (extCommand) {
      try {
        const result = await extCommand.handler(restParts.join(' '), ctx.buildExtensionContext());
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
        console.error(formatError(err instanceof Error ? err.message : String(err)));
        return { handled: true, needsPrompt: true };
      }
    }
  }

  return { handled: false };
}
