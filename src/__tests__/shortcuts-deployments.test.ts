import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShortcutLogger } from '../cli/shortcuts/types.js';

const {
  mockListDeployments,
  mockGetDeployment,
  mockUpdateDeployment,
  mockDeleteDeployment,
  mockCreateDeployment,
  mockPrintPayload,
  mockRunImportCommandWithPreview,
  mockParseDateInput,
  mockFormatTable,
  mockFormatToolResult,
} = vi.hoisted(() => ({
  mockListDeployments: vi.fn(),
  mockGetDeployment: vi.fn(),
  mockUpdateDeployment: vi.fn(),
  mockDeleteDeployment: vi.fn(),
  mockCreateDeployment: vi.fn(),
  mockPrintPayload: vi.fn(),
  mockRunImportCommandWithPreview: vi.fn(async () => undefined),
  mockParseDateInput: vi.fn((raw: string) => Date.parse(raw)),
  mockFormatTable: vi.fn(() => 'TABLE'),
  mockFormatToolResult: vi.fn((text: string) => `FMT:${text}`),
}));

vi.mock('../cli/operations-store.js', () => ({
  listDeployments: mockListDeployments,
  getDeployment: mockGetDeployment,
  updateDeployment: mockUpdateDeployment,
  deleteDeployment: mockDeleteDeployment,
  createDeployment: mockCreateDeployment,
}));

vi.mock('../cli/shortcuts/utils.js', async () => {
  const actual = await vi.importActual<typeof import('../cli/shortcuts/utils.js')>(
    '../cli/shortcuts/utils.js',
  );
  return {
    ...actual,
    printPayload: mockPrintPayload,
    runImportCommandWithPreview: mockRunImportCommandWithPreview,
    parseDateInput: mockParseDateInput,
    formatTable: mockFormatTable,
    formatToolResult: mockFormatToolResult,
  };
});

import { runDeploymentsCommand, runTopLevelDeployment } from '../cli/shortcuts/deployments.js';

function createLogger(): ShortcutLogger & {
  success: ReturnType<typeof vi.fn>;
  warning: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  output: ReturnType<typeof vi.fn>;
  done: ReturnType<typeof vi.fn>;
} {
  return {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    output: vi.fn(),
    done: vi.fn(),
  };
}

function deployment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'dep-1',
    mode: 'deploy',
    source: 'snapshot-a',
    status: 'scheduled',
    createdAt: '2026-02-26T00:00:00.000Z',
    updatedAt: '2026-02-26T00:00:00.000Z',
    ...overrides,
  };
}

describe('runDeploymentsCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListDeployments.mockReturnValue([]);
    mockFormatTable.mockReturnValue('TABLE');
    mockFormatToolResult.mockImplementation((text: string) => `FMT:${text}`);
  });

  it('warns when mode filter from forwarded options is invalid', async () => {
    const logger = createLogger();

    await runDeploymentsCommand(['list'], logger, false, { mode: 'bad-mode' });

    expect(logger.warning).toHaveBeenCalledWith(
      'Unknown deployment mode: bad-mode. Use deploy|rollback.',
    );
    expect(mockListDeployments).not.toHaveBeenCalled();
  });

  it('warns when status filter from forwarded options is invalid', async () => {
    const logger = createLogger();

    await runDeploymentsCommand(['list'], logger, false, { status: 'unknown' });

    expect(logger.warning).toHaveBeenCalledWith(
      'Unknown deployment status. Use scheduled|approved|applied|failed|cancelled.',
    );
    expect(mockListDeployments).not.toHaveBeenCalled();
  });

  it('lists deployments with filters and limit in json mode', async () => {
    const logger = createLogger();
    mockListDeployments.mockReturnValue([
      deployment({ id: 'dep-a', mode: 'deploy', status: 'applied' }),
      deployment({ id: 'dep-b', mode: 'rollback', status: 'applied' }),
      deployment({ id: 'dep-c', mode: 'deploy', status: 'applied' }),
    ]);

    await runDeploymentsCommand(['list'], logger, true, {
      mode: 'deploy',
      status: 'applied',
      limit: 1,
    });

    const payload = JSON.parse((logger.output.mock.calls[0] || [])[0] as string) as {
      count: number;
      total: number;
      deployments: Array<{ id: string }>;
    };
    expect(payload.total).toBe(2);
    expect(payload.count).toBe(1);
    expect(payload.deployments[0]?.id).toBe('dep-a');
  });

  it('supports offset pagination in list json output', async () => {
    const logger = createLogger();
    mockListDeployments.mockReturnValue([
      deployment({ id: 'dep-a', mode: 'deploy', status: 'applied' }),
      deployment({ id: 'dep-b', mode: 'deploy', status: 'applied' }),
      deployment({ id: 'dep-c', mode: 'deploy', status: 'applied' }),
    ]);

    await runDeploymentsCommand(['list', '--offset', '1', '--limit', '1'], logger, true);

    const payload = JSON.parse((logger.output.mock.calls[0] || [])[0] as string) as {
      count: number;
      total: number;
      offset: number;
      limit: number;
      deployments: Array<{ id: string }>;
    };
    expect(payload.total).toBe(3);
    expect(payload.count).toBe(1);
    expect(payload.offset).toBe(1);
    expect(payload.limit).toBe(1);
    expect(payload.deployments[0]?.id).toBe('dep-b');
  });

  it('warns on invalid list limit values', async () => {
    const logger = createLogger();

    await runDeploymentsCommand(['list', '--limit', 'bad'], logger);

    expect(logger.warning).toHaveBeenCalledWith(
      'Invalid --limit value. Expected a positive integer.',
    );
    expect(mockListDeployments).not.toHaveBeenCalled();
  });

  it('warns on invalid list offset values', async () => {
    const logger = createLogger();

    await runDeploymentsCommand(['list', '--offset', '-1'], logger);

    expect(logger.warning).toHaveBeenCalledWith(
      'Invalid --offset value. Expected a non-negative integer.',
    );
    expect(mockListDeployments).not.toHaveBeenCalled();
  });

  it('warns when offset is beyond filtered deployment rows', async () => {
    const logger = createLogger();
    mockListDeployments.mockReturnValue([
      deployment({ id: 'dep-a', mode: 'deploy', status: 'applied' }),
      deployment({ id: 'dep-b', mode: 'deploy', status: 'applied' }),
    ]);

    await runDeploymentsCommand(['list', '--offset', '5'], logger);

    expect(logger.warning).toHaveBeenCalledWith(
      'No deployments found for --offset 5. Total matches: 2.',
    );
  });

  it('does not cancel already applied deployments', async () => {
    const logger = createLogger();
    mockGetDeployment.mockReturnValue(deployment({ status: 'applied' }));

    await runDeploymentsCommand(['cancel', 'dep-1'], logger);

    expect(logger.warning).toHaveBeenCalledWith(
      'Deployment dep-1 has already been applied and cannot be cancelled.',
    );
    expect(mockUpdateDeployment).not.toHaveBeenCalled();
  });

  it('cancels scheduled deployments', async () => {
    const logger = createLogger();
    mockGetDeployment.mockReturnValue(deployment({ status: 'scheduled' }));
    mockUpdateDeployment.mockReturnValue(deployment({ status: 'cancelled' }));

    await runDeploymentsCommand(['cancel', 'dep-1'], logger);

    expect(mockUpdateDeployment).toHaveBeenCalledWith('dep-1', { status: 'cancelled' });
    expect(logger.success).toHaveBeenCalledWith('Deployment dep-1 cancelled.');
  });

  it('deletes deployment and emits json payload', async () => {
    const logger = createLogger();
    mockDeleteDeployment.mockReturnValue(deployment({ id: 'dep-z' }));

    await runDeploymentsCommand(['delete', 'dep-z'], logger, true);

    const payload = JSON.parse((logger.output.mock.calls[0] || [])[0] as string) as {
      removed: { id: string };
    };
    expect(payload.removed.id).toBe('dep-z');
  });

  it('prints status summary', async () => {
    const logger = createLogger();
    mockListDeployments.mockReturnValue([
      deployment({ id: 'dep-1', mode: 'deploy', status: 'scheduled' }),
      deployment({ id: 'dep-2', mode: 'deploy', status: 'applied' }),
      deployment({ id: 'dep-3', mode: 'rollback', status: 'failed' }),
    ]);

    await runDeploymentsCommand(['status'], logger, false);

    expect(mockFormatToolResult).toHaveBeenCalledWith(expect.stringContaining('"total": 3'));
    expect(logger.output).toHaveBeenCalledWith(expect.stringContaining('FMT:'));
  });

  it('warns with available commands when action is unknown', async () => {
    const logger = createLogger();
    mockGetDeployment.mockImplementation(() => {
      throw new Error('not found');
    });

    await runDeploymentsCommand(['unknown-action'], logger);

    expect(logger.warning).toHaveBeenCalledWith('Unknown deployments command "unknown-action".');
    expect(logger.warning).toHaveBeenCalledWith(
      'Available: list, get, status, approve, retry, reschedule, cancel, delete',
    );
  });

  it('approves from deployment command using deployment mode and override source', async () => {
    const logger = createLogger();
    mockGetDeployment.mockReturnValue(
      deployment({
        id: 'dep-approve',
        mode: 'rollback',
        source: 'snapshot-a',
        status: 'scheduled',
      }),
    );
    mockUpdateDeployment.mockImplementation((reference: string, patch: Record<string, unknown>) =>
      deployment({ id: reference, ...patch }),
    );

    await runDeploymentsCommand(['approve', 'dep-approve', 'snapshot-b'], logger, false, {
      dryRun: true,
      strict: true,
      includeSecrets: true,
    });

    expect(mockUpdateDeployment).toHaveBeenCalledWith(
      'dep-approve',
      expect.objectContaining({ status: 'approved', source: 'snapshot-b' }),
    );
    expect(mockRunImportCommandWithPreview).toHaveBeenCalledWith(
      'snapshot-b',
      logger,
      'Rollback',
      expect.objectContaining({
        dryRun: true,
        strict: true,
        includeSecrets: true,
        yes: true,
      }),
    );
    expect(mockUpdateDeployment).toHaveBeenCalledWith(
      'dep-approve',
      expect.objectContaining({ status: 'applied' }),
    );
  });

  it('retries failed deployment using deployment mode and override source', async () => {
    const logger = createLogger();
    mockGetDeployment.mockReturnValue(
      deployment({
        id: 'dep-retry',
        mode: 'deploy',
        source: 'snapshot-a',
        status: 'failed',
      }),
    );
    mockUpdateDeployment.mockImplementation((reference: string, patch: Record<string, unknown>) =>
      deployment({ id: reference, ...patch }),
    );

    await runDeploymentsCommand(['retry', 'dep-retry', 'snapshot-c'], logger, false, {
      dryRun: true,
      strict: true,
      includeSecrets: true,
      yes: true,
    });

    expect(mockUpdateDeployment).toHaveBeenCalledWith(
      'dep-retry',
      expect.objectContaining({ status: 'approved', source: 'snapshot-c' }),
    );
    expect(mockRunImportCommandWithPreview).toHaveBeenCalledWith(
      'snapshot-c',
      logger,
      'Deploy',
      expect.objectContaining({
        dryRun: true,
        strict: true,
        includeSecrets: true,
        yes: true,
      }),
    );
    expect(mockUpdateDeployment).toHaveBeenCalledWith(
      'dep-retry',
      expect.objectContaining({ status: 'applied' }),
    );
  });

  it('rejects retry when deployment is not failed', async () => {
    const logger = createLogger();
    mockGetDeployment.mockReturnValue(
      deployment({
        id: 'dep-scheduled',
        status: 'scheduled',
      }),
    );

    await runDeploymentsCommand(['retry', 'dep-scheduled'], logger);

    expect(logger.warning).toHaveBeenCalledWith(
      'Deployment dep-scheduled is scheduled; only failed deployments can be retried.',
    );
    expect(mockRunImportCommandWithPreview).not.toHaveBeenCalled();
  });

  it('rejects retry when deployment is cancelled', async () => {
    const logger = createLogger();
    mockGetDeployment.mockReturnValue(
      deployment({
        id: 'dep-cancelled',
        status: 'cancelled',
      }),
    );

    await runDeploymentsCommand(['retry', 'dep-cancelled'], logger);

    expect(logger.warning).toHaveBeenCalledWith(
      'Deployment dep-cancelled is cancelled and cannot be retried.',
    );
    expect(mockRunImportCommandWithPreview).not.toHaveBeenCalled();
  });

  it('rejects retry when deployment is already applied', async () => {
    const logger = createLogger();
    mockGetDeployment.mockReturnValue(
      deployment({
        id: 'dep-applied',
        status: 'applied',
      }),
    );

    await runDeploymentsCommand(['retry', 'dep-applied'], logger);

    expect(logger.warning).toHaveBeenCalledWith(
      'Deployment dep-applied has already been applied and cannot be retried.',
    );
    expect(mockRunImportCommandWithPreview).not.toHaveBeenCalled();
  });

  it('reschedules deployment with explicit datetime argument', async () => {
    const logger = createLogger();
    mockGetDeployment.mockReturnValue(
      deployment({
        id: 'dep-reschedule',
        mode: 'deploy',
        status: 'scheduled',
      }),
    );
    mockUpdateDeployment.mockImplementation((reference: string, patch: Record<string, unknown>) =>
      deployment({ id: reference, ...patch }),
    );
    mockParseDateInput.mockReturnValue(Date.parse('2026-03-20T12:00:00.000Z'));

    await runDeploymentsCommand(['reschedule', 'dep-reschedule', '2026-03-20T12:00:00Z'], logger);

    expect(mockUpdateDeployment).toHaveBeenCalledWith(
      'dep-reschedule',
      expect.objectContaining({
        status: 'scheduled',
        scheduledFor: '2026-03-20T12:00:00.000Z',
        approvedAt: '',
        appliedAt: '',
        error: '',
      }),
    );
    expect(logger.success).toHaveBeenCalledWith(
      'Deployment dep-reschedule rescheduled for 2026-03-20T12:00:00.000Z.',
    );
  });

  it('reschedules deployment with --schedule option from forwarded options', async () => {
    const logger = createLogger();
    mockGetDeployment.mockReturnValue(
      deployment({
        id: 'dep-reschedule-opt',
        mode: 'rollback',
        status: 'scheduled',
      }),
    );
    mockUpdateDeployment.mockImplementation((reference: string, patch: Record<string, unknown>) =>
      deployment({ id: reference, ...patch }),
    );
    mockParseDateInput.mockReturnValue(Date.parse('2026-03-22T08:30:00.000Z'));

    await runDeploymentsCommand(['reschedule', 'dep-reschedule-opt'], logger, false, {
      schedule: '2026-03-22T08:30:00Z',
    });

    expect(mockUpdateDeployment).toHaveBeenCalledWith(
      'dep-reschedule-opt',
      expect.objectContaining({
        status: 'scheduled',
        scheduledFor: '2026-03-22T08:30:00.000Z',
      }),
    );
  });

  it('blocks rescheduling when deployment is already applied', async () => {
    const logger = createLogger();
    mockGetDeployment.mockReturnValue(
      deployment({
        id: 'dep-applied',
        status: 'applied',
      }),
    );
    mockParseDateInput.mockReturnValue(Date.parse('2026-03-20T12:00:00.000Z'));

    await runDeploymentsCommand(['reschedule', 'dep-applied', '2026-03-20T12:00:00Z'], logger);

    expect(logger.warning).toHaveBeenCalledWith(
      'Deployment dep-applied has already been applied and cannot be rescheduled.',
    );
    expect(mockUpdateDeployment).not.toHaveBeenCalled();
  });

  it('blocks rescheduling when deployment is cancelled', async () => {
    const logger = createLogger();
    mockGetDeployment.mockReturnValue(
      deployment({
        id: 'dep-cancelled',
        status: 'cancelled',
      }),
    );
    mockParseDateInput.mockReturnValue(Date.parse('2026-03-20T12:00:00.000Z'));

    await runDeploymentsCommand(['reschedule', 'dep-cancelled', '2026-03-20T12:00:00Z'], logger);

    expect(logger.warning).toHaveBeenCalledWith(
      'Deployment dep-cancelled is cancelled and cannot be rescheduled.',
    );
    expect(mockUpdateDeployment).not.toHaveBeenCalled();
  });
});

describe('runTopLevelDeployment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParseDateInput.mockImplementation((raw: string) => Date.parse(raw));
  });

  it('rejects schedule+approve combinations', async () => {
    const logger = createLogger();

    await runTopLevelDeployment(
      'deploy',
      ['snapshot-a'],
      { schedule: 'now', approve: 'dep-1' },
      logger,
    );

    expect(logger.warning).toHaveBeenCalledWith(
      'Deploy cannot use both --schedule and --approve at once.',
    );
  });

  it('schedules deployment when valid', async () => {
    const logger = createLogger();
    const scheduled = deployment({ id: 'deploy-99', mode: 'deploy', source: 'snapshot-a' });
    mockParseDateInput.mockReturnValue(Date.parse('2026-03-01T10:00:00.000Z'));
    mockCreateDeployment.mockReturnValue(scheduled);

    await runTopLevelDeployment(
      'deploy',
      [],
      { from: 'snapshot-a', schedule: '2026-03-01T10:00:00Z', dryRun: true },
      logger,
    );

    expect(mockCreateDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'deploy',
        source: 'snapshot-a',
        dryRun: true,
        scheduledFor: '2026-03-01T10:00:00.000Z',
      }),
    );
    expect(logger.success).toHaveBeenCalledWith(
      'Deploy scheduled with id deploy-99 for 2026-03-01T10:00:00.000Z from snapshot-a',
    );
  });

  it('approves and applies deployment using stored source when successful', async () => {
    const logger = createLogger();
    mockGetDeployment.mockReturnValue(
      deployment({
        id: 'dep-approve',
        mode: 'deploy',
        source: 'snapshot-a',
        status: 'scheduled',
        dryRun: false,
        strict: true,
        includeSecrets: false,
        yes: false,
      }),
    );
    mockUpdateDeployment.mockImplementation((reference: string, patch: Record<string, unknown>) =>
      deployment({ id: reference, ...patch }),
    );

    await runTopLevelDeployment('deploy', [], { approve: 'dep-approve' }, logger);

    expect(mockUpdateDeployment).toHaveBeenCalledWith(
      'dep-approve',
      expect.objectContaining({ status: 'approved', source: 'snapshot-a' }),
    );
    expect(mockRunImportCommandWithPreview).toHaveBeenCalledWith(
      'snapshot-a',
      logger,
      'Deploy',
      expect.objectContaining({ yes: true, strict: true }),
    );
    expect(mockUpdateDeployment).toHaveBeenCalledWith(
      'dep-approve',
      expect.objectContaining({ status: 'applied' }),
    );
  });

  it('does not approve cancelled deployments', async () => {
    const logger = createLogger();
    mockGetDeployment.mockReturnValue(
      deployment({
        id: 'dep-cancelled',
        mode: 'deploy',
        source: 'snapshot-a',
        status: 'cancelled',
      }),
    );

    await runTopLevelDeployment('deploy', [], { approve: 'dep-cancelled' }, logger);

    expect(logger.warning).toHaveBeenCalledWith(
      'Deployment dep-cancelled is cancelled and cannot be approved.',
    );
    expect(mockRunImportCommandWithPreview).not.toHaveBeenCalled();
  });

  it('marks deployment failed when approval import step throws', async () => {
    const logger = createLogger();
    mockGetDeployment.mockReturnValue(
      deployment({
        id: 'dep-fail',
        mode: 'deploy',
        source: 'snapshot-a',
        status: 'scheduled',
      }),
    );
    mockRunImportCommandWithPreview.mockRejectedValueOnce(new Error('import failed'));

    await expect(
      runTopLevelDeployment('deploy', [], { approve: 'dep-fail' }, logger),
    ).rejects.toThrow('import failed');
    expect(mockUpdateDeployment).toHaveBeenCalledWith(
      'dep-fail',
      expect.objectContaining({ status: 'failed', error: 'import failed' }),
    );
  });
});
