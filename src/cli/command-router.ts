import { handleChatCommand } from './commands-chat.js';
import { handleSessionCommand } from './commands-session.js';
import { handleExportCommand } from './commands-export.js';
import type { ChatContext } from './types.js';

/**
 * Route a slash command to the appropriate handler module.
 *
 * Returns `{ handled: true }` if the command was processed.
 * Returns `{ handled: true, sendMessage }` if the command produced
 * a message that should be sent to the agent.
 * Returns `{ handled: false }` if no handler matched.
 */
export async function routeSlashCommand(
  input: string,
  ctx: ChatContext,
): Promise<{ handled: boolean; sendMessage?: string }> {
  // Chat meta-commands: help, clear, history, extensions, reload,
  // apply, redact, usage, audit, permissions, policy, integrations,
  // model, skills, skill, prompts, prompt, attach, etc.
  const chatResult = await handleChatCommand(input, ctx);
  if (chatResult.handled) return chatResult;

  // Session commands: session, sessions, new, resume, rename, delete,
  // archive, unarchive, tag, search, session-meta
  if (await handleSessionCommand(input, ctx)) return { handled: true };

  // Export commands: export, export-list, export-show, export-open,
  // export-delete, export-prune
  if (await handleExportCommand(input, ctx)) return { handled: true };

  return { handled: false };
}
