import chalk from 'chalk';
import ora from 'ora';
import * as readline from 'node:readline';
import {
  configExists,
  getCurrentOrg,
  getAnthropicApiKey,
  getConfiguredModel,
  resolveModel,
  type ModelId,
} from '../config.js';
import { StateSetAgent } from '../agent.js';
import { SessionStore, sanitizeSessionId } from '../session.js';
import { buildSystemPrompt } from '../prompt.js';
import { loadMemory } from '../memory.js';
import { buildUserContent } from '../attachments.js';
import {
  printWelcome,
  printAuthHelp,
  formatAssistantMessage,
  formatError,
  formatSuccess,
  formatWarning,
  formatElapsed,
  formatToolCall,
  formatUsage,
} from '../utils/display.js';
import { ExtensionManager } from '../extensions.js';
import { logger } from '../lib/logger.js';
import { extractInlineFlags, readBooleanEnv } from './utils.js';
import type { ChatContext, ToolAuditEntry, CommandResult } from './types.js';

const SIGINT_GRACE_MS = 2000;
import { readSessionMeta, listSessionSummaries } from './session-meta.js';
import { sanitizeToolArgs, appendToolAudit } from './audit.js';
import { readPermissionStore, writePermissionStore, makeHookPermissionKey } from './permissions.js';
import { printIntegrationStatus, runIntegrationsSetup } from './commands-integrations.js';
import { routeSlashCommand } from './command-router.js';
import inquirer from 'inquirer';

export type SlashRouteAction = 'send' | 'prompt' | 'handled' | 'ignore';

export function resolveSlashRouteAction(routeResult: CommandResult): SlashRouteAction {
  if (routeResult.handled !== true) return 'ignore';

  if (typeof routeResult.sendMessage === 'string' && routeResult.sendMessage.trim().length > 0) {
    return 'send';
  }

  if (routeResult.needsPrompt === true) {
    return 'prompt';
  }

  if (routeResult.needsPrompt !== undefined && routeResult.needsPrompt !== false) {
    return 'prompt';
  }

  return 'handled';
}

export interface ChatOptions {
  model?: string;
  session?: string;
  file?: string[];
  apply?: boolean;
  redact?: boolean;
  usage?: boolean;
  verbose?: boolean;
}

export async function startChatSession(
  options: ChatOptions,
  meta: { version?: string },
): Promise<void> {
  // Configure logger
  if (options.verbose) {
    logger.configure({ level: 'debug' });
  }

  // Check config
  if (!configExists()) {
    printAuthHelp();
    process.exit(1);
  }

  let orgId: string;
  try {
    const org = getCurrentOrg();
    orgId = org.orgId;
  } catch (e: unknown) {
    console.error(formatError(e instanceof Error ? e.message : String(e)));
    process.exit(1);
  }

  let apiKey: string;
  try {
    apiKey = getAnthropicApiKey();
  } catch (e: unknown) {
    console.error(formatError(e instanceof Error ? e.message : String(e)));
    process.exit(1);
  }

  // Integration flags (propagate to MCP server via env)
  if (options.apply) {
    process.env.STATESET_ALLOW_APPLY = 'true';
  }
  if (options.redact) {
    process.env.STATESET_REDACT = 'true';
  }

  // Resolve model
  let model: ModelId = getConfiguredModel();
  if (options.model) {
    const resolved = resolveModel(options.model);
    if (!resolved) {
      console.error(formatError(`Unknown model "${options.model}". Use sonnet, haiku, or opus.`));
      process.exit(1);
    }
    model = resolved;
  }

  let sessionId = sanitizeSessionId(options.session || 'default');
  let sessionStore = new SessionStore(sessionId);
  const agent = new StateSetAgent(apiKey, model);
  const cwd = process.cwd();
  const activeSkills: string[] = [];
  const extensions = new ExtensionManager();
  agent.useSessionStore(sessionStore);
  agent.setSystemPrompt(
    buildSystemPrompt({ sessionId, memory: loadMemory(sessionId), cwd, activeSkills }),
  );

  const spinner = ora('Connecting to StateSet Response...').start();
  try {
    await agent.connect();
    spinner.succeed('Connected');
  } catch (e: unknown) {
    spinner.fail('Failed to connect');
    console.error(formatError(e instanceof Error ? e.message : String(e)));
    process.exit(1);
  }

  try {
    await extensions.load(cwd);
  } catch (err) {
    console.error(formatError(err instanceof Error ? err.message : String(err)));
  }

  printWelcome(orgId, meta.version, model);
  console.log(chalk.gray(`  Session: ${sessionId}`));
  console.log('');

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('');
    const exitSpinner = ora('Disconnecting...').start();
    await agent.disconnect();
    exitSpinner.succeed('Disconnected');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('response> '),
  });

  let processing = false;
  let multiLineBuffer = '';
  let pendingAttachments = Array.isArray(options.file) ? [...options.file] : [];
  let showUsage = Boolean(options.usage) || process.env.STATESET_SHOW_USAGE === 'true';
  let auditEnabled = process.env.STATESET_TOOL_AUDIT === 'true';
  let auditIncludeExcerpt = process.env.STATESET_TOOL_AUDIT_DETAIL === 'true';
  let permissionStore = readPermissionStore();

  const switchSession = (nextSessionId: string) => {
    sessionId = sanitizeSessionId(nextSessionId || 'default');
    sessionStore = new SessionStore(sessionId);
    agent.useSessionStore(sessionStore);
    pendingAttachments = [];
    const memory = loadMemory(sessionId);
    agent.setSystemPrompt(buildSystemPrompt({ sessionId, memory, cwd, activeSkills }));
    console.log(formatSuccess(`Switched to session: ${sessionId}`));
    console.log(chalk.gray(`  Path: ${sessionStore.getSessionDir()}`));
  };

  const buildExtensionContext = () => ({
    cwd,
    sessionId,
    setSession: switchSession,
    listSessions: () => listSessionSummaries({ includeArchived: true }),
    log: (message: string) => console.log(message),
    success: (message: string) => console.log(formatSuccess(message)),
    warn: (message: string) => console.log(formatWarning(message)),
    error: (message: string) => console.error(formatError(message)),
  });

  const buildToolHookContext = () => ({
    cwd,
    sessionId,
    sessionTags: Array.isArray(readSessionMeta(sessionStore.getSessionDir()).tags)
      ? (readSessionMeta(sessionStore.getSessionDir()).tags as string[])
      : [],
    allowApply: readBooleanEnv('STATESET_ALLOW_APPLY'),
    redact: readBooleanEnv('STATESET_REDACT'),
    policy: extensions.getPolicyOverrides ? extensions.getPolicyOverrides() : {},
    log: (message: string) => console.log(message),
    success: (message: string) => console.log(formatSuccess(message)),
    warn: (message: string) => console.log(formatWarning(message)),
    error: (message: string) => console.error(formatError(message)),
  });

  const reconnectAgent = async () => {
    const reconnectSpinner = ora('Reconnecting to StateSet Response...').start();
    try {
      await agent.disconnect();
      await agent.connect();
      reconnectSpinner.succeed('Reconnected');
    } catch (err) {
      reconnectSpinner.fail('Reconnect failed');
      throw err;
    }
  };

  // Build the ChatContext for extracted command handlers
  const ctx: ChatContext = {
    agent,
    cwd,
    extensions,
    rl,
    activeSkills,
    sessionId,
    sessionStore,
    processing,
    multiLineBuffer,
    pendingAttachments,
    showUsage,
    auditEnabled,
    auditIncludeExcerpt,
    permissionStore,
    allowApply: process.env.STATESET_ALLOW_APPLY === 'true',
    redactEmails: process.env.STATESET_REDACT === 'true',
    model: model as string,
    switchSession: async (nextId: string) => {
      switchSession(nextId);
    },
    reconnectAgent,
    refreshSystemPrompt: () => {
      const memory = loadMemory(sessionId);
      agent.setSystemPrompt(buildSystemPrompt({ sessionId, memory, cwd, activeSkills }));
    },
    handleLine: async () => {},
    printIntegrationStatus: () => printIntegrationStatus(cwd),
    runIntegrationsSetup: () => runIntegrationsSetup(cwd),
    buildExtensionContext,
    buildToolHookContext,
  };

  // Handle Ctrl+C: cancel current request or show prompt
  process.on('SIGINT', () => {
    if (processing) {
      agent.abort();
      processing = false;
      console.log(chalk.yellow('\n  Request cancelled.'));
      console.log('');
      rl.prompt();
    } else {
      // Double Ctrl+C to exit
      console.log(chalk.gray('\n  Press Ctrl+C again or type "exit" to quit.'));
      rl.prompt();
      const onSecondSigint = () => {
        shutdown();
      };
      process.once('SIGINT', onSecondSigint);
      setTimeout(() => {
        process.removeListener('SIGINT', onSecondSigint);
      }, SIGINT_GRACE_MS);
    }
  });

  rl.prompt();

  const handleLine = async (line: string) => {
    // Multi-line support: trailing backslash continues input
    if (line.endsWith('\\')) {
      multiLineBuffer += line.slice(0, -1) + '\n';
      process.stdout.write(chalk.gray('... '));
      return;
    }

    const input = (multiLineBuffer + line).trim();
    multiLineBuffer = '';

    if (!input) {
      rl.prompt();
      return;
    }

    let finalInput = input;

    if (!input.startsWith('/')) {
      const inline = extractInlineFlags(input);
      finalInput = inline.text;

      const currentApply = process.env.STATESET_ALLOW_APPLY === 'true';
      const currentRedact = process.env.STATESET_REDACT === 'true';
      const nextApply = inline.flags.apply ? true : currentApply;
      const nextRedact = inline.flags.redact ? true : currentRedact;

      if (nextApply !== currentApply || nextRedact !== currentRedact) {
        process.env.STATESET_ALLOW_APPLY = nextApply ? 'true' : 'false';
        process.env.STATESET_REDACT = nextRedact ? 'true' : 'false';
        try {
          await reconnectAgent();
        } catch (err) {
          process.env.STATESET_ALLOW_APPLY = currentApply ? 'true' : 'false';
          process.env.STATESET_REDACT = currentRedact ? 'true' : 'false';
          console.error(formatError(err instanceof Error ? err.message : String(err)));
          console.log('');
          rl.prompt();
          return;
        }
        const memory = loadMemory(sessionId);
        agent.setSystemPrompt(buildSystemPrompt({ sessionId, memory, cwd, activeSkills }));
        if (nextApply !== currentApply) {
          console.log(
            formatSuccess(`Writes ${nextApply ? 'enabled' : 'disabled'} (inline --apply).`),
          );
        }
        if (nextRedact !== currentRedact) {
          console.log(
            formatSuccess(`Redaction ${nextRedact ? 'enabled' : 'disabled'} (inline --redact).`),
          );
        }
        console.log('');
      }

      if (!finalInput) {
        rl.prompt();
        return;
      }

      if (finalInput === 'exit' || finalInput === 'quit') {
        await shutdown();
        return;
      }
    }

    // Sync mutable state into context for handlers
    ctx.sessionId = sessionId;
    ctx.sessionStore = sessionStore;
    ctx.processing = processing;
    ctx.multiLineBuffer = multiLineBuffer;
    ctx.pendingAttachments = pendingAttachments;
    ctx.showUsage = showUsage;
    ctx.auditEnabled = auditEnabled;
    ctx.auditIncludeExcerpt = auditIncludeExcerpt;
    ctx.permissionStore = permissionStore;
    ctx.allowApply = process.env.STATESET_ALLOW_APPLY === 'true';
    ctx.redactEmails = process.env.STATESET_REDACT === 'true';

    // Route slash commands to extracted handlers
    if (input.startsWith('/')) {
      let routeResult: CommandResult;
      try {
        routeResult = await routeSlashCommand(input, ctx);
      } catch (err) {
        console.error(formatError(err instanceof Error ? err.message : String(err)));
        rl.prompt();
        return;
      }

      // Sync state back from context (handlers may mutate)
      sessionId = ctx.sessionId;
      sessionStore = ctx.sessionStore;
      pendingAttachments = ctx.pendingAttachments;
      showUsage = ctx.showUsage;
      auditEnabled = ctx.auditEnabled;
      auditIncludeExcerpt = ctx.auditIncludeExcerpt;
      permissionStore = ctx.permissionStore;

      const routeAction = resolveSlashRouteAction(routeResult);
      if (routeAction === 'send') {
        finalInput = routeResult.sendMessage as string;
      } else if (routeAction === 'prompt') {
        console.log('');
        rl.prompt();
        return;
      } else if (routeAction === 'handled') {
        return;
      }
    }

    if (input === 'exit' || input === 'quit') {
      await shutdown();
      return;
    }

    processing = true;
    const startTime = Date.now();

    // Stream response: print text token-by-token
    let firstText = true;
    let usageLine = '';
    try {
      const memory = loadMemory(sessionId);
      agent.setSystemPrompt(buildSystemPrompt({ sessionId, memory, cwd, activeSkills }));

      let userContent: string | Parameters<typeof agent.chat>[0] = finalInput;
      if (pendingAttachments.length > 0) {
        const { content, warnings } = buildUserContent(finalInput, pendingAttachments, { cwd });
        pendingAttachments = [];
        userContent = content;
        if (warnings.length > 0) {
          for (const warning of warnings) {
            console.log(formatWarning(warning));
          }
        }
      }

      const response = await agent.chat(userContent, {
        onText: (delta) => {
          if (firstText) {
            firstText = false;
          }
          process.stdout.write(chalk.white(delta));
        },
        onToolCall: (name, args) => {
          console.log(formatToolCall(name, args));
        },
        onToolCallStart: async (name, args) => {
          try {
            let decision = await extensions.runToolHooks({ name, args }, buildToolHookContext());

            if (decision?.action === 'deny' && decision.hookName) {
              const hookKey = makeHookPermissionKey(decision.hookName, name);
              const stored = permissionStore.toolHooks[hookKey];

              if (stored === 'allow') {
                decision = { action: 'allow', args };
              } else if (stored === 'deny') {
                decision = {
                  action: 'deny',
                  reason: decision.reason,
                  hookName: decision.hookName,
                };
              } else {
                rl.pause();
                const { choice } = await inquirer.prompt([
                  {
                    type: 'list',
                    name: 'choice',
                    message: `Extension hook "${decision.hookName}" denied tool "${name}".`,
                    choices: [
                      { name: 'Allow once', value: 'allow_once' },
                      { name: 'Always allow', value: 'allow_always' },
                      { name: 'Deny once', value: 'deny_once' },
                      { name: 'Always deny', value: 'deny_always' },
                    ],
                  },
                ]);
                rl.resume();

                if (choice === 'allow_once') {
                  decision = { action: 'allow', args };
                } else if (choice === 'allow_always') {
                  permissionStore.toolHooks[hookKey] = 'allow';
                  writePermissionStore(permissionStore);
                  decision = { action: 'allow', args };
                } else if (choice === 'deny_always') {
                  permissionStore.toolHooks[hookKey] = 'deny';
                  writePermissionStore(permissionStore);
                  decision = {
                    action: 'deny',
                    reason: decision.reason,
                    hookName: decision.hookName,
                  };
                } else {
                  decision = {
                    action: 'deny',
                    reason: decision.reason,
                    hookName: decision.hookName,
                  };
                }
              }
            }

            if (auditEnabled) {
              appendToolAudit(sessionId, {
                ts: new Date().toISOString(),
                type: 'tool_call',
                session: sessionId,
                name,
                args: sanitizeToolArgs(
                  decision?.action === 'allow' && decision.args ? decision.args : args,
                ),
                decision: decision?.action || 'allow',
                reason: decision && 'reason' in decision ? decision.reason : undefined,
              });
            }

            return decision;
          } catch (err) {
            console.error(formatError(err instanceof Error ? err.message : String(err)));
            return undefined;
          }
        },
        onToolCallEnd: (result) => {
          extensions.runToolResultHooks(result, buildToolHookContext()).catch((err) => {
            console.error(formatError(err instanceof Error ? err.message : String(err)));
          });
          if (auditEnabled) {
            const entry: ToolAuditEntry = {
              ts: new Date().toISOString(),
              type: 'tool_result',
              session: sessionId,
              name: result.name,
              durationMs: result.durationMs,
              isError: result.isError,
              resultLength: result.resultText.length,
            };
            if (auditIncludeExcerpt) {
              entry.resultExcerpt = result.resultText.slice(0, 500);
            }
            appendToolAudit(sessionId, entry);
          }
        },
        onUsage: (usage) => {
          if (showUsage) {
            usageLine = formatUsage(usage);
          }
        },
      });

      // If no streaming text was emitted (shouldn't happen, but safety)
      if (firstText && response) {
        console.log(formatAssistantMessage(response));
      }

      const elapsed = Date.now() - startTime;
      console.log(formatElapsed(elapsed));
      if (usageLine) {
        console.log(usageLine);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== 'Request cancelled') {
        console.log('\n' + formatError(msg));
      }
    }
    processing = false;
    console.log('');
    rl.prompt();
  };

  // Wire handleLine into the context for recursive use by handlers
  ctx.handleLine = handleLine;

  rl.on('line', handleLine);

  rl.on('close', async () => {
    await shutdown();
  });
}
