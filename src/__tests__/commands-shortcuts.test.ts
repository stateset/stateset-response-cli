import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatContext } from '../cli/types.js';

const { mockLogger, mockRunAnalyticsCommand, mockRunConvosCommand, mockRunDeploymentsCommand } =
  vi.hoisted(() => ({
    mockLogger: {
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      output: vi.fn(),
      done: vi.fn(),
    },
    mockRunAnalyticsCommand: vi.fn(async (..._args: unknown[]) => undefined),
    mockRunConvosCommand: vi.fn(async (..._args: unknown[]) => undefined),
    mockRunDeploymentsCommand: vi.fn(async (..._args: unknown[]) => undefined),
  }));

vi.mock('../cli/shortcuts/utils.js', async () => {
  const actual = await vi.importActual<typeof import('../cli/shortcuts/utils.js')>(
    '../cli/shortcuts/utils.js',
  );
  return {
    ...actual,
    buildSlashLogger: vi.fn(() => mockLogger),
  };
});

vi.mock('../cli/shortcuts/rules.js', () => ({
  runRulesCommand: vi.fn(async () => undefined),
  runTopLevelRules: vi.fn(async () => undefined),
}));

vi.mock('../cli/shortcuts/knowledge-base.js', () => ({
  runKnowledgeBaseCommand: vi.fn(async () => undefined),
  runTopLevelKb: vi.fn(async () => undefined),
}));

vi.mock('../cli/shortcuts/agents.js', () => ({
  runAgentsCommand: vi.fn(async () => undefined),
  runTopLevelAgents: vi.fn(async () => undefined),
}));

vi.mock('../cli/shortcuts/resources.js', () => ({
  runChannelsCommand: vi.fn(async () => undefined),
  runConvosCommand: mockRunConvosCommand,
  runMessagesCommand: vi.fn(async () => undefined),
  runResponsesCommand: vi.fn(async () => undefined),
  runTopLevelChannels: vi.fn(async () => undefined),
  runTopLevelConvos: vi.fn(async () => undefined),
  runTopLevelMessages: vi.fn(async () => undefined),
  runTopLevelResponses: vi.fn(async () => undefined),
}));

vi.mock('../cli/shortcuts/analytics.js', () => ({
  runStatusCommand: vi.fn(async () => undefined),
  runAnalyticsCommand: mockRunAnalyticsCommand,
  runTopLevelStatus: vi.fn(async () => undefined),
  runTopLevelStats: vi.fn(async () => undefined),
  runTopLevelAnalytics: vi.fn(async () => undefined),
}));

vi.mock('../cli/shortcuts/deployments.js', () => ({
  runSnapshotCommand: vi.fn(async () => undefined),
  runDiffCommand: vi.fn(async () => undefined),
  runDeploymentsCommand: mockRunDeploymentsCommand,
  runBulkCommand: vi.fn(async () => undefined),
  runTopLevelDeploy: vi.fn(async () => undefined),
  runTopLevelRollback: vi.fn(async () => undefined),
  runTopLevelDeployments: vi.fn(async () => undefined),
  runTopLevelDiff: vi.fn(async () => undefined),
  runTopLevelPull: vi.fn(async () => undefined),
  runTopLevelPush: vi.fn(async () => undefined),
  runTopLevelValidate: vi.fn(async () => undefined),
  runTopLevelBulk: vi.fn(async () => undefined),
  runTopLevelWatch: vi.fn(async () => undefined),
}));

vi.mock('../cli/shortcuts/monitoring.js', () => ({
  runWebhooksCommand: vi.fn(async () => undefined),
  runAlertsCommand: vi.fn(async () => undefined),
  runMonitorCommand: vi.fn(async () => undefined),
  runTopLevelWebhooks: vi.fn(async () => undefined),
  runTopLevelAlerts: vi.fn(async () => undefined),
  runTopLevelMonitor: vi.fn(async () => undefined),
}));

vi.mock('../cli/shortcuts/test.js', () => ({
  runTestCommand: vi.fn(async () => undefined),
  runTopLevelTest: vi.fn(async () => undefined),
}));

import { handleShortcutCommand } from '../cli/commands-shortcuts.js';

function createCtx(): ChatContext {
  return {
    agent: {
      callTool: vi.fn(async () => ({ payload: {} })),
    },
  } as unknown as ChatContext;
}

describe('handleShortcutCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunAnalyticsCommand.mockResolvedValue(undefined);
    mockRunConvosCommand.mockResolvedValue(undefined);
    mockRunDeploymentsCommand.mockResolvedValue(undefined);
  });

  it('blocks /stats when --period and --from are combined', async () => {
    const result = await handleShortcutCommand(
      '/stats summary --period 7d --from 2026-01-01',
      createCtx(),
    );

    expect(result).toEqual({ handled: true });
    expect(mockLogger.warning).toHaveBeenCalledWith(
      'Use either --from/--since or --period, not both.',
    );
    expect(mockRunAnalyticsCommand).not.toHaveBeenCalled();
    expect(mockLogger.done).toHaveBeenCalledTimes(1);
  });

  it('blocks /analytics when --period is invalid', async () => {
    const result = await handleShortcutCommand(
      '/analytics summary --period not-a-range',
      createCtx(),
    );

    expect(result).toEqual({ handled: true });
    expect(mockLogger.warning).toHaveBeenCalledWith('Invalid --period value: not-a-range');
    expect(mockRunAnalyticsCommand).not.toHaveBeenCalled();
    expect(mockLogger.done).toHaveBeenCalledTimes(1);
  });

  it('forwards period-derived --from to analytics', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-02-26T00:00:00.000Z'));
      const result = await handleShortcutCommand('/stats summary --period 7d', createCtx());

      expect(result).toEqual({ handled: true });
      expect(mockRunAnalyticsCommand).toHaveBeenCalledTimes(1);
      const firstCall = mockRunAnalyticsCommand.mock.calls[0] as unknown[];
      const forwardedTokens = firstCall[0] as string[];
      const fromIndex = forwardedTokens.indexOf('--from');
      expect(fromIndex).toBeGreaterThan(-1);
      expect(forwardedTokens[fromIndex + 1]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(mockLogger.done).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes /conversations to convos command', async () => {
    const result = await handleShortcutCommand('/conversations recent --json', createCtx());

    expect(result).toEqual({ handled: true });
    expect(mockRunConvosCommand).toHaveBeenCalledWith(
      ['recent', '--json'],
      expect.objectContaining({ callTool: expect.any(Function) }),
      mockLogger,
      true,
    );
    expect(mockLogger.done).toHaveBeenCalledTimes(1);
  });

  it('passes parsed deployment filters to runDeploymentsCommand', async () => {
    const result = await handleShortcutCommand(
      '/deployments list --mode deploy --status applied --limit 10 --offset 5',
      createCtx(),
    );

    expect(result).toEqual({ handled: true });
    expect(mockRunDeploymentsCommand).toHaveBeenCalledWith(
      ['list', '--mode', 'deploy', '--status', 'applied', '--limit', '10', '--offset', '5'],
      mockLogger,
      false,
      {
        mode: 'deploy',
        status: 'applied',
        limit: '10',
        offset: '5',
      },
    );
    expect(mockLogger.done).toHaveBeenCalledTimes(1);
  });

  it('forwards deployment approve options from slash args', async () => {
    const result = await handleShortcutCommand(
      '/deployments approve dep-1 --from snapshot-b --dry-run=true --strict=true --include-secrets=true --yes',
      createCtx(),
    );

    expect(result).toEqual({ handled: true });
    expect(mockRunDeploymentsCommand).toHaveBeenCalledWith(
      [
        'approve',
        'dep-1',
        '--from',
        'snapshot-b',
        '--dry-run=true',
        '--strict=true',
        '--include-secrets=true',
        '--yes',
      ],
      mockLogger,
      false,
      {
        mode: undefined,
        status: undefined,
        limit: undefined,
        from: 'snapshot-b',
        dryRun: true,
        yes: true,
        strict: true,
        includeSecrets: true,
      },
    );
    expect(mockLogger.done).toHaveBeenCalledTimes(1);
  });

  it('forwards deployment retry boolean flags without explicit values', async () => {
    const result = await handleShortcutCommand(
      '/deployments retry dep-2 --dry-run --strict --include-secrets --yes',
      createCtx(),
    );

    expect(result).toEqual({ handled: true });
    expect(mockRunDeploymentsCommand).toHaveBeenCalledWith(
      ['retry', 'dep-2', '--dry-run', '--strict', '--include-secrets', '--yes'],
      mockLogger,
      false,
      {
        mode: undefined,
        status: undefined,
        limit: undefined,
        dryRun: true,
        yes: true,
        strict: true,
        includeSecrets: true,
      },
    );
    expect(mockLogger.done).toHaveBeenCalledTimes(1);
  });

  it('logs command errors and returns handled', async () => {
    mockRunConvosCommand.mockRejectedValueOnce(new Error('shortcut failed'));
    const result = await handleShortcutCommand('/convos list', createCtx());

    expect(result).toEqual({ handled: true });
    expect(mockLogger.error).toHaveBeenCalledWith('shortcut failed');
    expect(mockLogger.done).toHaveBeenCalledTimes(1);
  });

  it('returns unhandled for unknown shortcut commands', async () => {
    const result = await handleShortcutCommand('/unknown-shortcut', createCtx());

    expect(result).toEqual({ handled: false });
    expect(mockLogger.done).not.toHaveBeenCalled();
  });
});
