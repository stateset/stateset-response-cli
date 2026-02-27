import chalk from 'chalk';
import ora from 'ora';
import * as readline from 'node:readline';
import {
  configExists,
  validateRuntimeConfig,
  getConfiguredModel,
  resolveModelOrThrow,
  type ModelId,
} from '../config.js';
import { StateSetAgent } from '../agent.js';
import { SessionStore, sanitizeSessionId } from '../session.js';
import { buildSystemPrompt } from '../prompt.js';
import { loadMemory } from '../memory.js';
import { buildUserContent } from '../attachments.js';
import fs from 'node:fs';
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
  formatRelativeTime,
} from '../utils/display.js';
import { ExtensionManager } from '../extensions.js';
import { logger } from '../lib/logger.js';
import { metrics } from '../lib/metrics.js';
import { getErrorMessage } from '../lib/errors.js';
import { extractInlineFlags, readBooleanEnv } from './utils.js';
import type { ChatContext, ToolAuditEntry, CommandResult } from './types.js';

const SIGINT_GRACE_MS = 2000;
import { readSessionMeta, listSessionSummaries } from './session-meta.js';
import { sanitizeToolArgs, appendToolAudit } from './audit.js';
import { readPermissionStore, writePermissionStore, makeHookPermissionKey } from './permissions.js';
import { printIntegrationStatus, runIntegrationsSetup } from './commands-integrations.js';
import { routeSlashCommand } from './command-router.js';
import { getCommandNames, registerAllCommands } from './command-registry.js';
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

export type SlashInputAction = 'send' | 'prompt' | 'handled' | 'exit' | 'unhandled';

/** Lazily computed from the command registry. */
let _knownSlashCommands: string[] | null = null;
function getKnownSlashCommands(): string[] {
  if (_knownSlashCommands === null) {
    _knownSlashCommands = getCommandNames();
  }
  return _knownSlashCommands;
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  );
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = 1 + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1]);
      }
    }
  }
  return matrix[a.length][b.length];
}

export function getSlashCommandSuggestions(
  input: string,
  extensionCommands: string[] = [],
): string[] {
  const command = input.split(/\s+/)[0] ?? '';
  if (!command.startsWith('/')) return [];
  if (command.length <= 1) return [];

  const normalizedExtensions = extensionCommands.map((name) =>
    name.startsWith('/') ? name : `/${name}`,
  );
  const knownCommands = Array.from(new Set([...getKnownSlashCommands(), ...normalizedExtensions]));

  const exactPrefix = knownCommands.filter((value) => value.startsWith(command));
  if (exactPrefix.length > 0) {
    return exactPrefix.slice(0, 6);
  }

  return knownCommands
    .map((candidate) => ({
      candidate,
      distance: levenshteinDistance(command, candidate),
    }))
    .filter((entry) => entry.distance <= 3)
    .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate))
    .slice(0, 3)
    .map((entry) => entry.candidate);
}

export function resolveSlashInputAction(
  input: string,
  routeResult: CommandResult,
): SlashInputAction {
  const routeAction = resolveSlashRouteAction(routeResult);
  if (routeAction === 'send') return 'send';
  if (routeAction === 'prompt') return 'prompt';
  if (routeAction === 'handled') return 'handled';
  if (input === '/exit' || input === '/quit') return 'exit';
  return 'unhandled';
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
  // Populate the command registry (idempotent)
  registerAllCommands();

  // Configure logger
  if (options.verbose) {
    logger.configure({ level: 'debug' });
  }

  // Check config
  if (!configExists()) {
    printAuthHelp();
    process.exitCode = 1;
    return;
  }

  let orgId: string;
  let apiKey: string;
  let allowApply = false;
  let redactEmails = false;
  try {
    const runtime = validateRuntimeConfig();
    orgId = runtime.orgId;
    apiKey = runtime.anthropicApiKey;
  } catch (e: unknown) {
    console.error(formatError(getErrorMessage(e)));
    process.exitCode = 1;
    return;
  }

  allowApply = options.apply ? true : readBooleanEnv('STATESET_ALLOW_APPLY');
  redactEmails = options.redact ? true : readBooleanEnv('STATESET_REDACT');

  // Resolve model
  let model: ModelId = getConfiguredModel();
  if (options.model) {
    try {
      model = resolveModelOrThrow(options.model);
    } catch (e: unknown) {
      console.error(formatError(getErrorMessage(e)));
      process.exitCode = 1;
      return;
    }
  }

  let sessionId = sanitizeSessionId(options.session || 'default');
  let sessionStore = new SessionStore(sessionId);
  metrics.increment('sessions.started');
  logger.setDefaultContext({ sessionId });
  const agent = new StateSetAgent(apiKey, model);
  agent.setMcpEnvOverrides({
    STATESET_ALLOW_APPLY: allowApply ? 'true' : 'false',
    STATESET_REDACT: redactEmails ? 'true' : 'false',
  });
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
    console.error(formatError(getErrorMessage(e)));
    process.exitCode = 1;
    return;
  }

  try {
    await extensions.load(cwd);
  } catch (err) {
    console.error(formatError(getErrorMessage(err)));
  }
  const extensionDiagnostics = extensions.listDiagnostics();
  const blockedProjectExtensionWarning = extensionDiagnostics.find((entry) =>
    entry.message.includes('Project extension trust policy is disabled'),
  );
  if (blockedProjectExtensionWarning) {
    console.log('');
    console.log(formatWarning(blockedProjectExtensionWarning.message));
    console.log(
      chalk.gray('  Tip: keep project extensions enabled only when running trusted repositories.'),
    );
    console.log('');
  }

  printWelcome(orgId, meta.version, model);
  console.log(chalk.gray(`  Session: ${sessionId}`));
  console.log('');

  // Graceful shutdown
  const SHUTDOWN_FORCE_EXIT_MS = 10_000;
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('');

    const forceExitTimer = setTimeout(() => {
      console.error('\nForce exit after timeout.');
      process.exitCode = 1;
    }, SHUTDOWN_FORCE_EXIT_MS);
    forceExitTimer.unref();

    const exitSpinner = ora('Disconnecting...').start();
    try {
      await agent.disconnect();
      exitSpinner.succeed('Disconnected');
      process.exitCode = 0;
    } catch (error) {
      process.exitCode = 1;
      exitSpinner.fail(formatError(getErrorMessage(error)));
    } finally {
      clearTimeout(forceExitTimer);
      process.off('SIGTERM', shutdown);
      process.off('SIGINT', onSigint);
      rl.close();
    }
  };

  process.on('SIGTERM', shutdown);

  const slashCompleter = (line: string): [string[], string] => {
    if (!line.startsWith('/')) return [[], line];
    const hits = getKnownSlashCommands().filter((cmd) => cmd.startsWith(line));
    return [hits.length > 0 ? hits : getKnownSlashCommands(), line];
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('response> '),
    completer: slashCompleter,
  });

  let processing = false;
  let multiLineBuffer = '';
  let pendingAttachments = Array.isArray(options.file) ? [...options.file] : [];
  let showUsage = Boolean(options.usage) || process.env.STATESET_SHOW_USAGE === 'true';
  let auditEnabled = process.env.STATESET_TOOL_AUDIT === 'true';
  let auditIncludeExcerpt = process.env.STATESET_TOOL_AUDIT_DETAIL === 'true';
  let permissionStore = readPermissionStore();

  const switchSession = (nextSessionId: string) => {
    if (processing) {
      console.log(formatWarning('Cannot switch sessions while a request is in progress.'));
      return;
    }
    sessionId = sanitizeSessionId(nextSessionId || 'default');
    sessionStore = new SessionStore(sessionId);
    metrics.increment('sessions.switched');
    logger.setDefaultContext({ sessionId });
    agent.useSessionStore(sessionStore);
    pendingAttachments = [];
    const memory = loadMemory(sessionId);
    agent.setSystemPrompt(buildSystemPrompt({ sessionId, memory, cwd, activeSkills }));
    console.log(formatSuccess(`Switched to session: ${sessionId}`));
    const infoParts: string[] = [];
    const msgCount = sessionStore.getMessageCount();
    if (msgCount > 0) infoParts.push(`Messages: ${msgCount}`);
    try {
      const stat = fs.statSync(sessionStore.getContextPath());
      infoParts.push(`Last activity: ${formatRelativeTime(stat.mtimeMs)}`);
    } catch {
      /* no context file yet */
    }
    const meta = readSessionMeta(sessionStore.getSessionDir());
    if (Array.isArray(meta.tags) && meta.tags.length > 0) {
      infoParts.push(`Tags: ${meta.tags.join(', ')}`);
    }
    if (infoParts.length > 0) {
      console.log(chalk.gray(`    ${infoParts.join(' | ')}`));
    }
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

  const buildToolHookContext = () => {
    const meta = readSessionMeta(sessionStore.getSessionDir());
    const tags = Array.isArray(meta.tags)
      ? meta.tags.filter((tag): tag is string => typeof tag === 'string')
      : [];
    return {
      cwd,
      sessionId,
      sessionTags: tags,
      allowApply,
      redact: redactEmails,
      policy: extensions.getPolicyOverrides ? extensions.getPolicyOverrides() : {},
      log: (message: string) => console.log(message),
      success: (message: string) => console.log(formatSuccess(message)),
      warn: (message: string) => console.log(formatWarning(message)),
      error: (message: string) => console.error(formatError(message)),
    };
  };

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
    allowApply,
    redactEmails,
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
  const onSigint = () => {
    if (processing) {
      agent.abort();
      processing = false;
      console.log(chalk.yellow('\n  Request cancelled.'));
      console.log('');
      rl.prompt();
    } else {
      // Double Ctrl+C to exit
      console.log(chalk.gray('\n  Press Ctrl+C again or type "/exit" (or "/quit") to quit.'));
      rl.prompt();
      const onSecondSigint = () => {
        shutdown();
      };
      process.once('SIGINT', onSecondSigint);
      setTimeout(() => {
        process.removeListener('SIGINT', onSecondSigint);
      }, SIGINT_GRACE_MS);
    }
  };
  process.on('SIGINT', onSigint);

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

      const currentApply = allowApply;
      const currentRedact = redactEmails;
      const nextApply = inline.flags.apply ? true : currentApply;
      const nextRedact = inline.flags.redact ? true : currentRedact;

      if (nextApply !== currentApply || nextRedact !== currentRedact) {
        allowApply = nextApply;
        redactEmails = nextRedact;
        agent.setMcpEnvOverrides({
          STATESET_ALLOW_APPLY: allowApply ? 'true' : 'false',
          STATESET_REDACT: redactEmails ? 'true' : 'false',
        });
        try {
          await reconnectAgent();
        } catch (err) {
          allowApply = currentApply;
          redactEmails = currentRedact;
          agent.setMcpEnvOverrides({
            STATESET_ALLOW_APPLY: allowApply ? 'true' : 'false',
            STATESET_REDACT: redactEmails ? 'true' : 'false',
          });
          console.error(formatError(getErrorMessage(err)));
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
    ctx.allowApply = allowApply;
    ctx.redactEmails = redactEmails;

    // Route slash commands to extracted handlers
    if (input.startsWith('/')) {
      if (input === '/exit' || input === '/quit') {
        await shutdown();
        return;
      }

      let routeResult: CommandResult;
      try {
        routeResult = await routeSlashCommand(input, ctx);
      } catch (err) {
        console.error(formatError(getErrorMessage(err)));
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
      allowApply = ctx.allowApply;
      redactEmails = ctx.redactEmails;
      permissionStore = ctx.permissionStore;

      const routeAction = resolveSlashInputAction(input, routeResult);
      if (routeAction === 'send') {
        finalInput = routeResult.sendMessage as string;
      } else if (routeAction === 'prompt') {
        console.log('');
        rl.prompt();
        return;
      } else if (routeAction === 'handled') {
        return;
      } else {
        console.log(
          formatWarning(`Unknown command "${input}". Type /help for available commands.`),
        );
        const extensionCommands = ctx.extensions?.listCommands
          ? ctx.extensions.listCommands().map((command) => command.name)
          : [];
        const suggestions = getSlashCommandSuggestions(input, extensionCommands);
        if (suggestions.length > 0) {
          console.log(formatWarning(`Did you mean: ${suggestions.join(', ')}?`));
        }
        console.log('');
        rl.prompt();
        return;
      }
    }

    if (input === 'exit' || input === 'quit') {
      await shutdown();
      return;
    }

    processing = true;
    metrics.increment('chat.userMessages');
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
                let choice: string;
                try {
                  const answer = await inquirer.prompt([
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
                  choice = answer.choice;
                } finally {
                  rl.resume();
                }

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
            console.error(formatError(getErrorMessage(err)));
            return undefined;
          }
        },
        onToolCallEnd: (result) => {
          extensions.runToolResultHooks(result, buildToolHookContext()).catch((err) => {
            console.error(formatError(getErrorMessage(err)));
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
      const msg = getErrorMessage(e);
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
