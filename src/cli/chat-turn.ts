import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { buildUserContent } from '../attachments.js';
import type { StateSetAgent } from '../agent.js';
import type { ExtensionManager, ToolHookContext } from '../extensions.js';
import { getErrorMessage } from '../lib/errors.js';
import { metrics } from '../lib/metrics.js';
import { loadMemory } from '../memory.js';
import { buildSystemPrompt } from '../prompt.js';
import type { SessionStore } from '../session.js';
import {
  formatElapsed,
  formatError,
  formatSuccess,
  formatToolCall,
  formatToolResultInline,
  formatUsage,
  formatWarning,
} from '../utils/display.js';
import { renderMarkdown } from '../utils/markdown.js';
import { MarkdownStreamRenderer } from '../utils/markdown-stream.js';
import {
  appendIntegrationTelemetry,
  appendToolAudit,
  isIntegrationToolName,
  isRateLimitedResult,
  sanitizeToolArgs,
} from './audit.js';
import { makeHookPermissionKey, writePermissionStore } from './permissions.js';
import { readSessionMeta } from './session-meta.js';
import type { PermissionStore, ToolAuditEntry } from './types.js';

export type PermissionChoice = 'allow_once' | 'allow_always' | 'deny_once' | 'deny_always';

export interface ChatTurnOptions {
  agent: StateSetAgent;
  extensions: ExtensionManager;
  sessionId: string;
  sessionStore: SessionStore;
  cwd: string;
  activeSkills: string[];
  input: string;
  pendingAttachments: string[];
  showUsage: boolean;
  auditEnabled: boolean;
  auditIncludeExcerpt: boolean;
  permissionStore: PermissionStore;
  allowApply: boolean;
  redactEmails: boolean;
  requestPermissionChoice?: (details: {
    hookName: string;
    toolName: string;
    reason?: string;
  }) => Promise<PermissionChoice>;
  showSpinner?: boolean;
}

export interface ChatTurnResult {
  pendingAttachments: string[];
  success: boolean;
}

export function buildToolHookContext(options: {
  cwd: string;
  sessionId: string;
  sessionStore: SessionStore;
  allowApply: boolean;
  redactEmails: boolean;
  extensions: ExtensionManager;
}): ToolHookContext {
  const meta = readSessionMeta(options.sessionStore.getSessionDir());
  const tags = Array.isArray(meta.tags)
    ? meta.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];
  return {
    cwd: options.cwd,
    sessionId: options.sessionId,
    sessionTags: tags,
    allowApply: options.allowApply,
    redact: options.redactEmails,
    policy: options.extensions.getPolicyOverrides ? options.extensions.getPolicyOverrides() : {},
    log: (message: string) => console.log(message),
    success: (message: string) => console.log(formatSuccess(message)),
    warn: (message: string) => console.log(formatWarning(message)),
    error: (message: string) => console.error(formatError(message)),
  };
}

export async function promptForPermissionChoice(
  details: {
    hookName: string;
    toolName: string;
    reason?: string;
  },
  controls?: {
    pause?: () => void;
    resume?: () => void;
  },
): Promise<PermissionChoice> {
  controls?.pause?.();
  try {
    const answer = await inquirer.prompt<{ choice: PermissionChoice }>([
      {
        type: 'list',
        name: 'choice',
        message: details.reason
          ? `Extension hook "${details.hookName}" denied tool "${details.toolName}": ${details.reason}`
          : `Extension hook "${details.hookName}" denied tool "${details.toolName}".`,
        choices: [
          { name: 'Allow once', value: 'allow_once' },
          { name: 'Always allow', value: 'allow_always' },
          { name: 'Deny once', value: 'deny_once' },
          { name: 'Always deny', value: 'deny_always' },
        ],
      },
    ]);
    return answer.choice;
  } finally {
    controls?.resume?.();
  }
}

export async function runChatTurn(options: ChatTurnOptions): Promise<ChatTurnResult> {
  let pendingAttachments = [...options.pendingAttachments];
  metrics.increment('chat.userMessages');
  const startTime = Date.now();
  const thinkSpinner =
    options.showSpinner === false
      ? null
      : ora({ text: chalk.gray('Thinking...'), spinner: 'dots' }).start();

  let firstText = true;
  let usageLine = '';
  let toolCallCount = 0;
  const mdStream = new MarkdownStreamRenderer();

  const stopSpinner = () => {
    if (firstText && thinkSpinner) {
      thinkSpinner.stop();
    }
    firstText = false;
  };

  const createToolHookContext = (): ToolHookContext =>
    buildToolHookContext({
      cwd: options.cwd,
      sessionId: options.sessionId,
      sessionStore: options.sessionStore,
      allowApply: options.allowApply,
      redactEmails: options.redactEmails,
      extensions: options.extensions,
    });

  try {
    const memory = loadMemory(options.sessionId);
    options.agent.setSystemPrompt(
      buildSystemPrompt({
        sessionId: options.sessionId,
        memory,
        cwd: options.cwd,
        activeSkills: options.activeSkills,
      }),
    );

    let userContent: string | Parameters<typeof options.agent.chat>[0] = options.input;
    if (pendingAttachments.length > 0) {
      const { content, warnings } = buildUserContent(options.input, pendingAttachments, {
        cwd: options.cwd,
      });
      pendingAttachments = [];
      userContent = content;
      if (warnings.length > 0) {
        for (const warning of warnings) {
          console.log(formatWarning(warning));
        }
      }
    }

    const response = await options.agent.chat(userContent, {
      onText: (delta) => {
        stopSpinner();
        const rendered = mdStream.push(delta);
        if (rendered) {
          process.stdout.write(rendered);
        }
      },
      onToolCall: (name, args) => {
        stopSpinner();
        toolCallCount += 1;
        const prefix = toolCallCount > 1 ? chalk.gray(`[step ${toolCallCount}] `) : '';
        console.log(prefix + formatToolCall(name, args));
      },
      onToolCallStart: async (name, args) => {
        try {
          let decision = await options.extensions.runToolHooks(
            { name, args },
            createToolHookContext(),
          );

          if (decision?.action === 'deny' && decision.hookName) {
            const hookKey = makeHookPermissionKey(decision.hookName, name);
            const stored = options.permissionStore.toolHooks[hookKey];

            if (stored === 'allow') {
              decision = { action: 'allow', args };
            } else if (stored === 'deny') {
              decision = {
                action: 'deny',
                reason: decision.reason,
                hookName: decision.hookName,
              };
            } else if (options.requestPermissionChoice) {
              const choice = await options.requestPermissionChoice({
                hookName: decision.hookName,
                toolName: name,
                reason: decision.reason,
              });

              if (choice === 'allow_once') {
                decision = { action: 'allow', args };
              } else if (choice === 'allow_always') {
                options.permissionStore.toolHooks[hookKey] = 'allow';
                writePermissionStore(options.permissionStore);
                decision = { action: 'allow', args };
              } else if (choice === 'deny_always') {
                options.permissionStore.toolHooks[hookKey] = 'deny';
                writePermissionStore(options.permissionStore);
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

          const callEntry: ToolAuditEntry = {
            ts: new Date().toISOString(),
            type: 'tool_call',
            session: options.sessionId,
            name,
            args: sanitizeToolArgs(
              decision?.action === 'allow' && decision.args ? decision.args : args,
            ),
            decision: decision?.action || 'allow',
            reason: decision && 'reason' in decision ? decision.reason : undefined,
          };

          if (options.auditEnabled) {
            appendToolAudit(options.sessionId, callEntry);
          }
          if (isIntegrationToolName(name)) {
            appendIntegrationTelemetry(callEntry);
          }

          return decision;
        } catch (error: unknown) {
          console.error(formatError(getErrorMessage(error)));
          return undefined;
        }
      },
      onToolCallEnd: (result) => {
        console.log(formatToolResultInline(result.name, result.durationMs, result.isError));
        options.extensions.runToolResultHooks(result, createToolHookContext()).catch((error) => {
          console.error(formatError(getErrorMessage(error)));
        });

        if (options.auditEnabled) {
          const entry: ToolAuditEntry = {
            ts: new Date().toISOString(),
            type: 'tool_result',
            session: options.sessionId,
            name: result.name,
            durationMs: result.durationMs,
            isError: result.isError,
            resultLength: result.resultText.length,
          };
          if (options.auditIncludeExcerpt) {
            entry.resultExcerpt = result.resultText.slice(0, 500);
          }
          appendToolAudit(options.sessionId, entry);
        }

        if (isIntegrationToolName(result.name)) {
          const entry: ToolAuditEntry = {
            ts: new Date().toISOString(),
            type: 'tool_result',
            session: options.sessionId,
            name: result.name,
            durationMs: result.durationMs,
            isError: result.isError,
            resultLength: result.resultText.length,
            reason:
              result.isError && isRateLimitedResult(result.resultText) ? 'rate_limited' : undefined,
          };
          appendIntegrationTelemetry(entry);
        }
      },
      onUsage: (usage) => {
        if (options.showUsage) {
          usageLine = formatUsage(usage);
        }
      },
    });

    const flushed = mdStream.flush();
    if (flushed) {
      process.stdout.write(flushed);
    }

    if (firstText && response) {
      console.log(renderMarkdown(response));
    }

    const elapsed = Date.now() - startTime;
    console.log(formatElapsed(elapsed));
    if (usageLine) {
      console.log(usageLine);
    }

    const trimInfo = options.agent.getLastTrimInfo();
    if (trimInfo?.trimmed) {
      console.log(
        chalk.yellow(
          `  Context trimmed: oldest messages dropped (${trimInfo.messagesBefore} → ${trimInfo.messagesAfter}). Use /context for details.`,
        ),
      );
    }

    return { pendingAttachments, success: true };
  } catch (error: unknown) {
    thinkSpinner?.stop();
    const message = getErrorMessage(error);
    if (message !== 'Request cancelled') {
      console.log('\n' + formatError(message));
    }
    return { pendingAttachments, success: false };
  }
}
