import type { ShortcutLogger } from './types.js';
import { buildTopLevelLogger, formatTable } from './utils.js';
import { getIntegrationSnapshots, getIntegrationReadiness } from '../commands-integrations.js';
import { readIntegrationTelemetry } from '../audit.js';

function toTimestamp(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatTimestamp(value: string | undefined): string {
  if (!value) {
    return '-';
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
}

export async function runSyncCommand(
  args: string[],
  logger: ShortcutLogger,
  options: { json?: boolean } = {},
): Promise<void> {
  const action = (args[0] || 'status').toLowerCase();
  const target = args[1];
  if (action !== 'status') {
    logger.warning(`Unknown sync command "${action}".`);
    logger.warning('Available: status');
    return;
  }

  const snapshots = getIntegrationSnapshots(process.cwd(), target);
  const telemetry = readIntegrationTelemetry();
  const rows = snapshots.map((snapshot) => {
    const events = telemetry
      .filter((entry) => entry.name.toLowerCase().startsWith(`${snapshot.id.toLowerCase()}_`))
      .sort((a, b) => toTimestamp(b.ts) - toTimestamp(a.ts));
    const lastEvent = events[0];
    const lastSuccess = events.find(
      (entry) => entry.type === 'tool_result' && entry.isError !== true,
    );
    const lastFailure = events.find(
      (entry) => entry.type === 'tool_result' && entry.isError === true,
    );
    const readiness = getIntegrationReadiness(snapshot);
    const latestTs = lastEvent?.ts || snapshot.updatedAt;
    const status =
      readiness === 'disabled'
        ? 'disabled'
        : readiness === 'invalid-config'
          ? 'invalid-config'
          : lastFailure && toTimestamp(lastFailure.ts) >= toTimestamp(lastSuccess?.ts)
            ? 'failing'
            : lastSuccess
              ? 'ok'
              : readiness === 'not-configured'
                ? 'not-configured'
                : 'idle';
    return {
      integration: snapshot.id,
      readiness,
      status,
      lastSync: formatTimestamp(lastSuccess?.ts || snapshot.updatedAt),
      lastFailure: formatTimestamp(lastFailure?.ts),
      lastActivity: formatTimestamp(latestTs),
      source: snapshot.source,
    };
  });

  if (options.json) {
    logger.output(JSON.stringify({ integrations: rows }, null, 2));
    return;
  }
  logger.output(
    formatTable(rows, [
      'integration',
      'readiness',
      'status',
      'lastSync',
      'lastFailure',
      'lastActivity',
      'source',
    ]),
  );
}

export async function runTopLevelSync(
  args: string[] = [],
  options: { json?: boolean } = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await runSyncCommand(args, logger, options);
}
