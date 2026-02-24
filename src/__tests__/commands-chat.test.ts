import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { handleChatCommand } from '../cli/commands-chat.js';
import type { ChatContext } from '../cli/types.js';
import { registerAllCommands } from '../cli/command-registry.js';

beforeAll(() => {
  registerAllCommands();
});

vi.mock('../cli/commands-config.js', () => ({
  handleConfigCommand: vi.fn(async () => ({ handled: false })),
}));

vi.mock('../cli/commands-audit.js', () => ({
  handleAuditCommand: vi.fn(async () => ({ handled: false })),
}));

vi.mock('../cli/commands-policy.js', () => ({
  handlePolicyCommand: vi.fn(async () => ({ handled: false })),
}));

vi.mock('../cli/commands-templates.js', () => ({
  handleTemplateCommand: vi.fn(async () => ({ handled: false })),
}));

import { handleConfigCommand } from '../cli/commands-config.js';
import { handleAuditCommand } from '../cli/commands-audit.js';
import { handlePolicyCommand } from '../cli/commands-policy.js';
import { handleTemplateCommand } from '../cli/commands-templates.js';

const mockConfig = vi.mocked(handleConfigCommand);
const mockAudit = vi.mocked(handleAuditCommand);
const mockPolicy = vi.mocked(handlePolicyCommand);
const mockTemplate = vi.mocked(handleTemplateCommand);

function createMockCtx(overrides: Partial<ChatContext> = {}): ChatContext {
  return {
    agent: {
      clearHistory: vi.fn(),
      getHistoryLength: vi.fn(() => 0),
      setSystemPrompt: vi.fn(),
    } as any,
    cwd: '/tmp/test',
    extensions: {
      listExtensions: vi.fn(() => []),
      listDiagnostics: vi.fn(() => []),
    } as any,
    rl: {
      prompt: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
      listeners: vi.fn(() => []),
    } as any,
    activeSkills: [],
    sessionId: 'test-session',
    sessionStore: { clear: vi.fn() } as any,
    processing: false,
    multiLineBuffer: '',
    pendingAttachments: [],
    showUsage: false,
    auditEnabled: false,
    auditIncludeExcerpt: false,
    permissionStore: { toolHooks: {} },
    allowApply: false,
    redactEmails: false,
    model: 'claude',
    switchSession: vi.fn(async () => {}),
    reconnectAgent: vi.fn(async () => {}),
    refreshSystemPrompt: vi.fn(),
    handleLine: vi.fn(async () => {}),
    printIntegrationStatus: vi.fn(),
    runIntegrationsSetup: vi.fn(async () => {}),
    buildExtensionContext: vi.fn(() => ({})),
    buildToolHookContext: vi.fn(() => ({})),
    ...overrides,
  } as unknown as ChatContext;
}

describe('handleChatCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes canonical config commands only', async () => {
    const ctx = createMockCtx();

    expect(await handleChatCommand('/apply on', ctx)).toEqual({ handled: false });
    expect(await handleChatCommand('/redact off', ctx)).toEqual({ handled: false });
    expect(await handleChatCommand('/agentic off', ctx)).toEqual({ handled: false });
    expect(await handleChatCommand('/usage on', ctx)).toEqual({ handled: false });
    expect(await handleChatCommand('/model sonnet', ctx)).toEqual({ handled: false });

    expect(mockConfig).toHaveBeenCalledTimes(5);
    expect(mockConfig).toHaveBeenCalledWith('/agentic off', ctx);
    expect(mockConfig).toHaveBeenCalledWith('/apply on', ctx);
    expect(mockConfig).toHaveBeenCalledWith('/redact off', ctx);
  });

  it('does not match config command prefix collisions', async () => {
    const ctx = createMockCtx();

    expect(await handleChatCommand('/applyx', ctx)).toEqual({ handled: false });
    expect(await handleChatCommand('/redactx', ctx)).toEqual({ handled: false });
    expect(await handleChatCommand('/agenticx', ctx)).toEqual({ handled: false });
    expect(await handleChatCommand('/usagex', ctx)).toEqual({ handled: false });
    expect(await handleChatCommand('/modelx', ctx)).toEqual({ handled: false });

    expect(mockConfig).not.toHaveBeenCalled();
  });

  it('routes canonical audit commands and ignores collisions', async () => {
    const ctx = createMockCtx();

    expect(await handleChatCommand('/audit', ctx)).toEqual({ handled: false });
    expect(await handleChatCommand('/audit-show', ctx)).toEqual({ handled: false });
    expect(await handleChatCommand('/audit-clear', ctx)).toEqual({ handled: false });
    expect(await handleChatCommand('/auditx', ctx)).toEqual({ handled: false });

    expect(mockAudit).toHaveBeenCalledTimes(3);
    expect(mockAudit).toHaveBeenCalledWith('/audit', ctx);
    expect(mockAudit).toHaveBeenCalledWith('/audit-show', ctx);
  });

  it('routes canonical policy commands and ignores collisions', async () => {
    const ctx = createMockCtx();

    expect(await handleChatCommand('/permissions', ctx)).toEqual({ handled: false });
    expect(await handleChatCommand('/policy', ctx)).toEqual({ handled: false });
    expect(await handleChatCommand('/permissionsx', ctx)).toEqual({ handled: false });
    expect(await handleChatCommand('/policyx', ctx)).toEqual({ handled: false });

    expect(mockPolicy).toHaveBeenCalledTimes(2);
    expect(mockPolicy).toHaveBeenCalledWith('/permissions', ctx);
    expect(mockPolicy).toHaveBeenCalledWith('/policy', ctx);
  });

  it('routes prompt-related commands and ignores collisions', async () => {
    const ctx = createMockCtx();

    expect(await handleChatCommand('/prompts', ctx)).toEqual({ handled: false });
    expect(await handleChatCommand('/prompt-history', ctx)).toEqual({ handled: false });
    expect(await handleChatCommand('/prompt-validate', ctx)).toEqual({ handled: false });
    expect(await handleChatCommand('/prompt test', ctx)).toEqual({ handled: false });
    expect(await handleChatCommand('/prompt-validatex', ctx)).toEqual({ handled: false });
    expect(await handleChatCommand('/promptsx', ctx)).toEqual({ handled: false });

    expect(mockTemplate).toHaveBeenCalledTimes(4);
  });

  it('handles /integrations command boundaries', async () => {
    const ctx = createMockCtx();

    expect(await handleChatCommand('/integrations', ctx)).toEqual({ handled: true });
    expect(ctx.printIntegrationStatus).toHaveBeenCalled();
    expect(await handleChatCommand('/integrationsx', ctx)).toEqual({ handled: false });
    expect(await handleChatCommand('/integrations\tsetup', ctx)).toEqual({ handled: true });
    expect(ctx.runIntegrationsSetup).toHaveBeenCalledTimes(1);
    expect(ctx.reconnectAgent).toHaveBeenCalledTimes(1);
    expect(ctx.agent.setSystemPrompt).toHaveBeenCalledTimes(1);
  });

  it('handles /attach and ignores attachment command collisions', async () => {
    const ctx = createMockCtx();

    expect(await handleChatCommand('/attach path/to/file', ctx)).toEqual({ handled: true });
    expect(ctx.pendingAttachments).toEqual(['path/to/file']);

    expect(await handleChatCommand('/attach', ctx)).toEqual({ handled: true });
    expect(await handleChatCommand('/attachx', ctx)).toEqual({ handled: false });
    expect(await handleChatCommand('/attach-clear', ctx)).toEqual({ handled: true });
    expect(await handleChatCommand('/attach-clearx', ctx)).toEqual({ handled: false });
    expect(await handleChatCommand('/attach\tpath/to/file', ctx)).toEqual({ handled: true });
  });

  it('handles zero-arg commands with trailing whitespace', async () => {
    const ctx = createMockCtx();

    expect(await handleChatCommand('/help   ', ctx)).toEqual({ handled: true });
    expect(await handleChatCommand('/clear\t', ctx)).toEqual({ handled: true });
    expect(await handleChatCommand('/history\n', ctx)).toEqual({ handled: true });
    expect(await handleChatCommand('/skills  ', ctx)).toEqual({ handled: true });
  });

  it('handles /skill and ignores command collisions', async () => {
    const ctx = createMockCtx();

    expect(await handleChatCommand('/skill', ctx)).toEqual({ handled: true });
    expect(await handleChatCommand('/skill-clear', ctx)).toEqual({ handled: true });
    expect(await handleChatCommand('/skillx', ctx)).toEqual({ handled: false });
    expect(await handleChatCommand('/skill\tassistant', ctx)).toEqual({ handled: true });
  });

  it('routes /prompt with tab-separated arguments', async () => {
    const ctx = createMockCtx();
    expect(await handleChatCommand('/prompt\ttest', ctx)).toEqual({ handled: false });
  });
});
