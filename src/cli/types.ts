import type * as readline from 'node:readline';
import type { StateSetAgent } from '../agent.js';
import type { SessionStore, StoredMessage } from '../session.js';
import type { ExtensionManager, ExtensionCommandContext, ToolHookContext } from '../extensions.js';

export type InlineFlags = {
  apply?: boolean;
  redact?: boolean;
};

export type SessionMeta = {
  tags?: string[];
  archived?: boolean;
};

export type SessionSummary = {
  id: string;
  dir: string;
  updatedAtMs: number;
  messageCount: number;
  tags: string[];
  archived: boolean;
};

export type SessionExportEntry = StoredMessage & { ts?: string };

export type PromptHistoryEntry = {
  ts: string;
  template: string;
  variables: Record<string, string>;
};

export type ToolAuditEntry = {
  ts: string;
  type: 'tool_call' | 'tool_result';
  session: string;
  name: string;
  args?: Record<string, unknown>;
  decision?: string;
  reason?: string;
  durationMs?: number;
  isError?: boolean;
  resultLength?: number;
  resultExcerpt?: string;
};

export type CommandResult = { handled: boolean; sendMessage?: string };
export type CommandHandler = (input: string, ctx: ChatContext) => Promise<CommandResult | null>;

export type PermissionDecision = 'allow' | 'deny';

export type PermissionStore = {
  toolHooks: Record<string, PermissionDecision>;
};

export interface ChatContext {
  agent: StateSetAgent;
  cwd: string;
  extensions: ExtensionManager;
  rl: readline.Interface;
  activeSkills: string[];

  sessionId: string;
  sessionStore: SessionStore;
  processing: boolean;
  multiLineBuffer: string;
  pendingAttachments: string[];
  showUsage: boolean;
  auditEnabled: boolean;
  auditIncludeExcerpt: boolean;
  permissionStore: PermissionStore;

  allowApply: boolean;
  redactEmails: boolean;
  model: string;

  switchSession: (nextSessionId: string) => Promise<void>;
  reconnectAgent: () => Promise<void>;
  refreshSystemPrompt: () => void;
  handleLine: (line: string) => Promise<void>;

  printIntegrationStatus: () => void;
  runIntegrationsSetup: () => Promise<void>;
  buildExtensionContext: () => ExtensionCommandContext;
  buildToolHookContext: () => ToolHookContext;
}
