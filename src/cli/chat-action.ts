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
import fs from 'node:fs';
import {
  printWelcome,
  printAuthHelp,
  formatError,
  formatSuccess,
  formatWarning,
  formatRelativeTime,
} from '../utils/display.js';
import { ExtensionManager } from '../extensions.js';
import { logger } from '../lib/logger.js';
import { metrics } from '../lib/metrics.js';
import { getErrorMessage } from '../lib/errors.js';
import { extractInlineFlags, readBooleanEnv } from './utils.js';
import type { ChatContext, CommandResult } from './types.js';
import { smartCompleter } from './completer.js';
import { loadInputHistory, appendHistoryLine, trimHistoryFile } from './history.js';
import { checkForUpdate } from '../utils/update-check.js';
import { readSessionMeta, listSessionSummaries } from './session-meta.js';
import { readPermissionStore } from './permissions.js';
import {
  countConfiguredIntegrations,
  printIntegrationStatus,
  runIntegrationsSetup,
} from './commands-integrations.js';
import { buildToolHookContext, promptForPermissionChoice, runChatTurn } from './chat-turn.js';
import { routeSlashCommand } from './command-router.js';
import { registerAllCommands } from './command-registry.js';
import { getSlashCommandSuggestions, resolveSlashInputAction } from './slash-routing.js';

export {
  getSlashCommandSuggestions,
  resolveSlashInputAction,
  resolveSlashRouteAction,
} from './slash-routing.js';
export type { SlashInputAction, SlashRouteAction } from './slash-routing.js';

const SIGINT_GRACE_MS = 2000;

export interface ChatOptions {
  model?: string;
  session?: string;
  file?: string[];
  apply?: boolean;
  redact?: boolean;
  usage?: boolean;
  verbose?: boolean;
}

export interface OneShotInputOptions {
  promptParts?: string[];
  stdin?: boolean;
  stdinStream?: NodeJS.ReadableStream;
  stdinIsTTY?: boolean;
}

export interface OneShotPromptOptions extends ChatOptions {
  message: string;
}

interface ChatRuntime {
  orgId: string;
  apiKey: string;
  model: ModelId;
  allowApply: boolean;
  redactEmails: boolean;
  sessionId: string;
  sessionStore: SessionStore;
  agent: StateSetAgent;
  cwd: string;
  activeSkills: string[];
  extensions: ExtensionManager;
}

async function readStreamText(stream: NodeJS.ReadableStream): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => {
      if (typeof chunk === 'string') {
        chunks.push(Buffer.from(chunk));
      } else {
        chunks.push(Buffer.from(chunk));
      }
    });
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

export async function resolveOneShotInput(options: OneShotInputOptions): Promise<string> {
  const promptText = (options.promptParts ?? []).join(' ').trim();
  const stdinStream = options.stdinStream ?? process.stdin;
  const stdinIsTTY =
    options.stdinIsTTY ??
    Boolean((stdinStream as NodeJS.ReadableStream & { isTTY?: boolean }).isTTY);

  if (promptText && options.stdin) {
    throw new Error('Pass prompt text as arguments or use --stdin, not both.');
  }

  if (promptText) {
    return promptText;
  }

  const shouldReadStdin = Boolean(options.stdin) || !stdinIsTTY;
  if (!shouldReadStdin) {
    throw new Error('Provide a message or pipe text via stdin.');
  }

  if (options.stdin && stdinIsTTY) {
    throw new Error('--stdin requires piped input.');
  }

  const stdinText = (await readStreamText(stdinStream)).trim();
  if (!stdinText) {
    throw new Error('Prompt text is empty.');
  }

  return stdinText;
}

async function initializeChatRuntime(
  options: ChatOptions,
  connectLabel = 'Connecting to StateSet Response...',
): Promise<ChatRuntime | null> {
  registerAllCommands();

  if (options.verbose) {
    logger.configure({ level: 'debug' });
  }

  if (!configExists()) {
    printAuthHelp();
    process.exitCode = 1;
    return null;
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
    return null;
  }

  allowApply = options.apply ? true : readBooleanEnv('STATESET_ALLOW_APPLY');
  redactEmails = options.redact ? true : readBooleanEnv('STATESET_REDACT');

  let model: ModelId = getConfiguredModel();
  if (options.model) {
    try {
      model = resolveModelOrThrow(options.model);
    } catch (e: unknown) {
      console.error(formatError(getErrorMessage(e)));
      process.exitCode = 1;
      return null;
    }
  }

  const sessionId = sanitizeSessionId(options.session || 'default');
  const sessionStore = new SessionStore(sessionId);
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

  const spinner = ora(connectLabel).start();
  try {
    await agent.connect();
    spinner.succeed('Connected');
  } catch (e: unknown) {
    spinner.fail('Failed to connect');
    console.error(formatError(getErrorMessage(e)));
    process.exitCode = 1;
    return null;
  }

  try {
    await extensions.load(cwd);
  } catch (err) {
    console.error(formatError(getErrorMessage(err)));
  }

  return {
    orgId,
    apiKey,
    model,
    allowApply,
    redactEmails,
    sessionId,
    sessionStore,
    agent,
    cwd,
    activeSkills,
    extensions,
  };
}

function printExtensionStartupWarnings(extensions: ExtensionManager): void {
  const extensionDiagnostics = extensions.listDiagnostics();
  const blockedProjectExtensionWarning = extensionDiagnostics.find((entry) =>
    entry.message.includes('Project extension trust policy is disabled'),
  );
  if (!blockedProjectExtensionWarning) {
    return;
  }

  console.log('');
  console.log(formatWarning(blockedProjectExtensionWarning.message));
  console.log(
    chalk.gray('  Tip: keep project extensions enabled only when running trusted repositories.'),
  );
  console.log('');
}

export function getWelcomeIntegrationCount(cwd: string = process.cwd()): number {
  try {
    return countConfiguredIntegrations(cwd);
  } catch {
    return 0;
  }
}

export async function runOneShotPrompt(options: OneShotPromptOptions): Promise<void> {
  const runtime = await initializeChatRuntime(options);
  if (!runtime) {
    return;
  }

  const {
    agent,
    extensions,
    sessionId,
    sessionStore,
    cwd,
    activeSkills,
    allowApply,
    redactEmails,
  } = runtime;
  const permissionStore = readPermissionStore();
  const showUsage = Boolean(options.usage) || process.env.STATESET_SHOW_USAGE === 'true';
  const auditEnabled = process.env.STATESET_TOOL_AUDIT === 'true';
  const auditIncludeExcerpt = process.env.STATESET_TOOL_AUDIT_DETAIL === 'true';
  const pendingAttachments = Array.isArray(options.file) ? [...options.file] : [];
  const canPromptForPermission = Boolean(process.stdin.isTTY);

  printExtensionStartupWarnings(extensions);

  try {
    const result = await runChatTurn({
      agent,
      extensions,
      sessionId,
      sessionStore,
      cwd,
      activeSkills,
      input: options.message,
      pendingAttachments,
      showUsage,
      auditEnabled,
      auditIncludeExcerpt,
      permissionStore,
      allowApply,
      redactEmails,
      requestPermissionChoice: canPromptForPermission
        ? (details) => promptForPermissionChoice(details)
        : undefined,
    });

    if (!result.success) {
      process.exitCode = 1;
    }
  } finally {
    try {
      await agent.disconnect();
    } catch (error) {
      console.error(formatError(getErrorMessage(error)));
      process.exitCode = 1;
    }
  }
}

export async function startChatSession(
  options: ChatOptions,
  meta: { version?: string },
): Promise<void> {
  const runtime = await initializeChatRuntime(options);
  if (!runtime) {
    return;
  }

  const { orgId, model, agent, cwd, activeSkills, extensions } = runtime;
  let { allowApply, redactEmails, sessionId, sessionStore } = runtime;

  printExtensionStartupWarnings(extensions);

  // Count active integrations for welcome banner
  const integrationCount = getWelcomeIntegrationCount(cwd);

  const sessionMessageCount = sessionStore.getMessageCount();
  printWelcome(orgId, meta.version, model, {
    integrationCount,
    sessionMessageCount,
    allowApply,
  });
  console.log(chalk.gray(`  Session: ${sessionId}`));
  console.log('');

  // Async update check (never blocks startup)
  if (meta.version) {
    checkForUpdate(meta.version)
      .then((msg) => {
        if (msg) console.log(msg);
      })
      .catch(() => {});
  }

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

  const completer = (line: string): [string[], string] => {
    const extensionCommands = extensions.listCommands
      ? extensions.listCommands().map((c) => c.name)
      : [];
    return smartCompleter(line, extensionCommands, cwd);
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('response> '),
    completer,
  });

  // Pre-populate readline history from persistent file
  const savedHistory = loadInputHistory();
  for (const entry of savedHistory) {
    (rl as unknown as { history: string[] }).history?.unshift(entry);
  }
  // Trim history file periodically
  trimHistoryFile();

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
    lastUserMessage: null,
    switchSession: async (nextId: string) => {
      switchSession(nextId);
      ctx.sessionId = sessionId;
      ctx.sessionStore = sessionStore;
      ctx.pendingAttachments = pendingAttachments;
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
    buildToolHookContext: () =>
      buildToolHookContext({
        cwd,
        sessionId,
        sessionStore,
        allowApply,
        redactEmails,
        extensions,
      }),
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

    // Save to persistent history
    appendHistoryLine(input);

    // Track for /retry
    ctx.lastUserMessage = finalInput;

    processing = true;
    const turnResult = await runChatTurn({
      agent,
      extensions,
      sessionId,
      sessionStore,
      cwd,
      activeSkills,
      input: finalInput,
      pendingAttachments,
      showUsage,
      auditEnabled,
      auditIncludeExcerpt,
      permissionStore,
      allowApply,
      redactEmails,
      requestPermissionChoice: (details) =>
        promptForPermissionChoice(details, {
          pause: () => rl.pause(),
          resume: () => rl.resume(),
        }),
    });

    pendingAttachments = turnResult.pendingAttachments;
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
