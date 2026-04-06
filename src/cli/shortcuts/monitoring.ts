import chalk from 'chalk';
import { getErrorMessage } from '../../lib/errors.js';
import type { ShortcutLogger, ShortcutRunner, TopLevelOptions, MonitorSnapshot } from './types.js';
import { FETCH_ALL_LIMIT } from './types.js';
import {
  toLines,
  parseCommandArgs,
  toPositiveInteger,
  parsePositiveIntegerOption,
  extractAggregateCount,
  asStringRecord,
  asRecordArray,
  toDisplayValue,
  sleep,
  buildTopLevelLogger,
  withAgentRunner,
  formatToolResult,
  formatTable,
  parseToggleValue,
  printPayload,
} from './utils.js';
import { createAlert, deleteAlert, listAlerts, loadOperationsStore } from '../operations-store.js';

function readFirstOption(options: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    const value = options[name];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function parseWebhookEventList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

export async function runWebhooksCommand(
  tokens: string[],
  logger: ShortcutLogger,
  json = false,
  runner?: ShortcutRunner,
): Promise<void> {
  if (!runner) {
    logger.warning('Webhooks requires authentication and an active tool runner.');
    return;
  }

  const raw = toLines(tokens);
  const { options, positionals } = parseCommandArgs(raw);
  const action = positionals[0]?.toLowerCase() || 'list';
  const firstArg = positionals[1]?.trim();
  const webhookRef = readFirstOption(options, ['id']) || firstArg;
  const limit = toPositiveInteger(options.limit, 20, 200);
  const events = parseWebhookEventList(readFirstOption(options, ['events', 'event']));
  const enabledValue = parseToggleValue(readFirstOption(options, ['enabled']));

  if (action === 'list') {
    const result = await runner.callTool('list_webhooks', { limit, offset: 0 });
    printPayload(logger, 'Webhooks', result.payload, json);
    return;
  }

  if (action === 'get') {
    if (!webhookRef) {
      logger.warning('Usage: /webhooks get <webhook-id>');
      return;
    }
    const result = await runner.callTool('get_webhook', { id: webhookRef });
    printPayload(logger, `Webhook ${webhookRef}`, result.payload, json);
    return;
  }

  if (action === 'create') {
    const url = firstArg || readFirstOption(options, ['url', 'endpoint', 'webhook']);
    if (!url) {
      logger.warning('Usage: /webhooks create <url> --events event1,event2 [--enabled true|false]');
      return;
    }
    if (events.length === 0) {
      logger.warning('Provide at least one webhook event via --events event1,event2.');
      return;
    }
    const result = await runner.callTool('create_webhook', {
      url,
      events,
      ...(enabledValue !== undefined ? { is_active: enabledValue } : {}),
    });
    printPayload(logger, 'Created webhook', result.payload, json);
    return;
  }

  if (action === 'update') {
    if (!webhookRef) {
      logger.warning(
        'Usage: /webhooks update <webhook-id> [--url <url>] [--events event1,event2] [--enabled true|false]',
      );
      return;
    }
    const url = readFirstOption(options, ['url', 'endpoint', 'webhook']);
    const payload: Record<string, unknown> = { id: webhookRef };
    if (url !== undefined) {
      payload.url = url;
    }
    if (events.length > 0) {
      payload.events = events;
    }
    if (enabledValue !== undefined) {
      payload.is_active = enabledValue;
    }
    if (Object.keys(payload).length === 1) {
      logger.warning('Provide at least one webhook field to update.');
      return;
    }
    const result = await runner.callTool('update_webhook', payload);
    printPayload(logger, `Updated webhook ${webhookRef}`, result.payload, json);
    return;
  }

  if (action === 'deliveries' || action === 'logs') {
    const result = await runner.callTool('list_webhook_deliveries', {
      ...(webhookRef ? { webhook_id: webhookRef } : {}),
      limit,
      offset: 0,
    });
    printPayload(
      logger,
      webhookRef ? `Webhook deliveries for ${webhookRef}` : 'Webhook deliveries',
      result.payload,
      json,
    );
    return;
  }

  if (action === 'test') {
    logger.warning(
      'Synthetic webhook tests are not supported by the platform API. Use /webhooks deliveries to inspect real webhook delivery history.',
    );
    return;
  }

  if (action === 'delete') {
    if (!webhookRef) {
      logger.warning('Usage: /webhooks delete <webhook-id>');
      return;
    }
    const result = await runner.callTool('delete_webhook', { id: webhookRef });
    printPayload(logger, `Deleted webhook ${webhookRef}`, result.payload, json);
    return;
  }

  logger.warning(`Unknown webhooks command "${action}".`);
  logger.output(formatToolResult('Available: list, get, create, update, deliveries, logs, delete'));
}

export async function runAlertsCommand(
  tokens: string[],
  logger: ShortcutLogger,
  json = false,
): Promise<void> {
  const raw = toLines(tokens);
  const { options, positionals } = parseCommandArgs(raw);
  const action = positionals[0]?.toLowerCase() || 'list';
  const alertId = positionals[1] || options.id;
  const metric = options.metric || positionals[1];
  const thresholdValue = options.threshold || options['threshold-value'];
  const channel = options.channel || options.notification_channel;

  if (action === 'list') {
    const alerts = listAlerts(alertId);
    if (alerts.length === 0) {
      logger.warning('No alerts configured.');
      return;
    }
    if (json) {
      logger.output(JSON.stringify({ alerts }, null, 2));
      return;
    }
    const rows = alerts.map((entry) => ({
      id: entry.id,
      metric: entry.metric,
      threshold: String(entry.threshold),
      channel: entry.channel || '-',
      enabled: String(entry.enabled),
      updated: entry.updatedAt,
    }));
    logger.output(
      formatTable(rows, ['id', 'metric', 'threshold', 'channel', 'enabled', 'updated']),
    );
    return;
  }

  if (action === 'get') {
    if (!alertId) {
      logger.warning('Usage: /alerts get <alert-id>');
      return;
    }
    const matches = listAlerts(alertId);
    if (matches.length === 0) {
      logger.warning(`No alert found for "${alertId}".`);
      return;
    }
    if (json) {
      logger.output(JSON.stringify({ alerts: matches }, null, 2));
      return;
    }
    const rows = matches.map((entry) => ({
      id: entry.id,
      metric: entry.metric,
      threshold: String(entry.threshold),
      channel: entry.channel || '-',
      enabled: String(entry.enabled),
      updated: entry.updatedAt,
    }));
    logger.output(
      formatTable(rows, ['id', 'metric', 'threshold', 'channel', 'enabled', 'updated']),
    );
    return;
  }

  if (action === 'create') {
    const rawThreshold = thresholdValue || positionals[2];
    const threshold = rawThreshold ? Number.parseFloat(String(rawThreshold)) : Number.NaN;
    if (!metric || !Number.isFinite(threshold)) {
      logger.warning(
        'Usage: /alerts create --metric <metric> --threshold <value> [--channel <name>]',
      );
      return;
    }
    try {
      const created = createAlert({
        metric,
        threshold,
        channel,
        enabled: parseToggleValue(options.enabled) !== false,
      });
      logger.output(
        json
          ? JSON.stringify({ alert: created }, null, 2)
          : formatToolResult(JSON.stringify({ alert: created }, null, 2)),
      );
    } catch (error) {
      logger.warning(getErrorMessage(error));
    }
    return;
  }

  if (action === 'delete') {
    if (!alertId) {
      logger.warning('Usage: /alerts delete <alert-id>');
      return;
    }
    try {
      const removed = deleteAlert(alertId);
      logger.output(
        json
          ? JSON.stringify({ removed }, null, 2)
          : formatToolResult(JSON.stringify({ removed }, null, 2)),
      );
    } catch (error) {
      logger.warning(getErrorMessage(error));
    }
    return;
  }

  logger.warning(`Unknown alerts command "${action}".`);
  logger.output(formatToolResult('Available: list, get, create, delete'));
}

async function collectMonitorSnapshot(
  runner: ShortcutRunner,
  options?: {
    agentId?: string;
    recentChannelsLimit?: number;
    recentWebhookLogLimit?: number;
  },
): Promise<MonitorSnapshot> {
  const agentId = options?.agentId?.trim();
  const recentChannelsLimit = options?.recentChannelsLimit ?? 5;
  const recentWebhookLogLimit = options?.recentWebhookLogLimit ?? 5;
  const isAgentScope = Boolean(agentId);
  const scopedFilter = agentId ? { agent_id: agentId } : {};
  const listLimit = 10000;

  const [
    agentsResult,
    rulesResult,
    responseCountResult,
    messageCountResult,
    kbInfoResult,
    channelScopeResult,
    openChannelsResult,
    needsAttentionChannelsResult,
    inProgressChannelsResult,
    recentChannelsResult,
    webhooksResult,
    webhookDeliveriesResult,
  ] = await Promise.all([
    runner.callTool('list_agents', { limit: FETCH_ALL_LIMIT }),
    runner.callTool('list_rules', { limit: FETCH_ALL_LIMIT }),
    runner.callTool('get_response_count', {}),
    runner.callTool('get_message_count', {}),
    runner.callTool('kb_get_collection_info', {}),
    isAgentScope
      ? runner.callTool('list_channels', { ...scopedFilter, limit: listLimit })
      : runner.callTool('get_channel_count', {}),
    runner.callTool('list_channels', { ...scopedFilter, status: 'open', limit: FETCH_ALL_LIMIT }),
    runner.callTool('list_channels', {
      ...scopedFilter,
      status: 'needs_attention',
      limit: FETCH_ALL_LIMIT,
    }),
    runner.callTool('list_channels', {
      ...scopedFilter,
      status: 'in_progress',
      limit: FETCH_ALL_LIMIT,
    }),
    runner.callTool('list_channels', { ...scopedFilter, limit: recentChannelsLimit }),
    runner
      .callTool('list_webhooks', { limit: FETCH_ALL_LIMIT, offset: 0 })
      .catch(() => ({ payload: [] })),
    runner
      .callTool('list_webhook_deliveries', { limit: recentWebhookLogLimit, offset: 0 })
      .catch(() => ({ payload: [] })),
  ]);

  const agents = asRecordArray(agentsResult.payload);
  const rules = asRecordArray(rulesResult.payload);
  const responseCount = extractAggregateCount(responseCountResult.payload, 'responses_aggregate');
  const messageCount = extractAggregateCount(messageCountResult.payload, 'message_aggregate');
  const channelRows = isAgentScope ? asRecordArray(channelScopeResult.payload) : [];
  const channelCount = isAgentScope
    ? channelRows.length
    : extractAggregateCount(channelScopeResult.payload, 'channel_thread_aggregate');
  const openChannels = asRecordArray(openChannelsResult.payload);
  const needsAttentionChannels = asRecordArray(needsAttentionChannelsResult.payload);
  const inProgressChannels = asRecordArray(inProgressChannelsResult.payload);
  const recentChannels = asRecordArray(recentChannelsResult.payload).slice(0, recentChannelsLimit);

  const kbInfo = asStringRecord(kbInfoResult.payload);
  const kbCollectionRaw = toDisplayValue(kbInfo.collection);
  const kbPointsRaw = asStringRecord(kbInfo.info).points_count;
  const kbPoints = toDisplayValue(kbPointsRaw);

  const remoteWebhooks = asRecordArray(webhooksResult.payload);
  const remoteDeliveries = asRecordArray(webhookDeliveriesResult.payload);
  const operationsStore = loadOperationsStore();
  const enabledWebhookCount =
    remoteWebhooks.length > 0
      ? remoteWebhooks.filter((webhook) => webhook.is_active === true).length
      : operationsStore.webhooks.filter((webhook) => webhook.enabled).length;
  const totalWebhookCount =
    remoteWebhooks.length > 0 ? remoteWebhooks.length : operationsStore.webhooks.length;
  const recentWebhookLogs =
    remoteDeliveries.length > 0
      ? remoteDeliveries.slice(0, recentWebhookLogLimit).map((entry) => ({
          time: toDisplayValue(entry.delivered_at),
          webhook: toDisplayValue(entry.webhook_id),
          event: toDisplayValue(entry.event_type),
          status: entry.success === true ? 'ok' : 'error',
          message: toDisplayValue(entry.error_message || entry.status_code),
        }))
      : operationsStore.webhookLogs.slice(0, recentWebhookLogLimit).map((entry) => ({
          time: entry.createdAt,
          webhook: entry.webhookId,
          event: entry.event,
          status: entry.status,
          message: entry.statusMessage || '-',
        }));

  const metrics: Array<{ metric: string; value: string }> = [
    { metric: 'Scope', value: isAgentScope ? `agent:${agentId}` : 'organization' },
    { metric: 'Agents', value: String(agents.length) },
    { metric: 'Rules', value: String(rules.length) },
    { metric: 'Channels', value: String(channelCount) },
    { metric: 'Open channels', value: String(openChannels.length) },
    { metric: 'Needs attention', value: String(needsAttentionChannels.length) },
    { metric: 'In progress', value: String(inProgressChannels.length) },
    { metric: 'Messages', value: String(messageCount) },
    { metric: 'Responses', value: String(responseCount) },
    {
      metric: 'Webhook subscriptions',
      value: `${totalWebhookCount} (${enabledWebhookCount} enabled)`,
    },
    { metric: 'Alert rules', value: String(operationsStore.alerts.length) },
    { metric: 'KB', value: `${kbCollectionRaw} (${kbPoints} points)` },
  ];

  const recentChannelRows = recentChannels.map((channel) => {
    const recordAgent = asStringRecord(channel.agent);
    const agentName = toDisplayValue(
      recordAgent.agent_name || recordAgent.id || recordAgent.name || '-',
    );
    const channelId = toDisplayValue(channel.uuid || channel.id);
    const name = toDisplayValue(channel.name);
    return {
      id: channelId,
      name,
      status: toDisplayValue(channel.status),
      agent: agentName,
      created: toDisplayValue(channel.created_at),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    scope: isAgentScope ? `agent:${agentId}` : 'organization',
    metrics,
    recentChannels: recentChannelRows,
    recentWebhookLogs,
  };
}

function printMonitorSnapshot(
  logger: ShortcutLogger,
  snapshot: MonitorSnapshot,
  jsonMode: boolean,
  iteration = 1,
): void {
  if (jsonMode) {
    logger.output(JSON.stringify({ iteration, ...snapshot }));
    return;
  }

  logger.success(`Monitor snapshot ${iteration} (${snapshot.scope}) @ ${snapshot.generatedAt}`);
  logger.output(formatTable(snapshot.metrics, ['metric', 'value']));

  if (snapshot.recentChannels.length > 0) {
    logger.output(formatToolResult('Recent conversations'));
    logger.output(
      formatTable(snapshot.recentChannels, ['id', 'name', 'status', 'agent', 'created']),
    );
  } else {
    logger.output(chalk.gray('  Recent conversations: none'));
  }

  if (snapshot.recentWebhookLogs.length > 0) {
    logger.output(formatToolResult('Recent webhook events'));
    logger.output(
      formatTable(snapshot.recentWebhookLogs, ['time', 'webhook', 'event', 'status', 'message']),
    );
  } else {
    logger.output(chalk.gray('  Recent webhook events: none'));
  }
}

export async function runMonitorCommand(
  tokens: string[],
  logger: ShortcutLogger,
  json = false,
  runner?: ShortcutRunner,
): Promise<void> {
  if (!runner) {
    logger.warning('Monitor requires authentication and an active tool runner.');
    return;
  }

  const raw = toLines(tokens);
  const { options, positionals } = parseCommandArgs(raw);
  const action = positionals[0]?.toLowerCase() || 'status';
  const agentId = options.agent || options.agent_id;
  const jsonMode = parseToggleValue(options.json) || json;
  const intervalSeconds = options.interval
    ? parsePositiveIntegerOption(String(options.interval))
    : undefined;
  const refreshSeconds = intervalSeconds === undefined ? 5 : intervalSeconds;
  if (options.interval && intervalSeconds === undefined) {
    logger.warning('Invalid --interval value. Expected a positive integer in seconds.');
    return;
  }

  const maxIterations = options.count
    ? parsePositiveIntegerOption(String(options.count))
    : undefined;
  if (options.count && maxIterations === undefined) {
    logger.warning('Invalid --count value. Expected a positive integer.');
    return;
  }

  const recentChannelLimit = toPositiveInteger(options.limit, 5, 50);
  const recentWebhookLogLimit = toPositiveInteger(
    options['webhook-logs'] ||
      options['webhook_logs'] ||
      options['webhook-log-limit'] ||
      options.webhookLogs ||
      options.webhook_log_limit ||
      options.webhookLogLimit,
    5,
    50,
  );

  if (action === 'status') {
    const snapshot = await collectMonitorSnapshot(runner, {
      agentId,
      recentChannelsLimit: recentChannelLimit,
      recentWebhookLogLimit,
    });
    printMonitorSnapshot(logger, snapshot, jsonMode);
    return;
  }

  if (action === 'live') {
    let iteration = 0;
    const loopLimit = maxIterations ?? Number.MAX_SAFE_INTEGER;
    while (iteration < loopLimit) {
      iteration += 1;
      const snapshot = await collectMonitorSnapshot(runner, {
        agentId,
        recentChannelsLimit: recentChannelLimit,
        recentWebhookLogLimit,
      });
      printMonitorSnapshot(logger, snapshot, jsonMode, iteration);
      if (iteration >= loopLimit) {
        return;
      }
      await sleep(refreshSeconds * 1000);
    }
    return;
  }

  logger.warning(`Unknown monitor action "${action}".`);
  logger.output(formatToolResult('Available: status|live'));
}

export async function runTopLevelWebhooks(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await withAgentRunner(async (runner) => {
    await runWebhooksCommand(args, logger, Boolean(options.json), runner);
  });
}

export async function runTopLevelAlerts(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await runAlertsCommand(args, logger, Boolean(options.json));
}

export async function runTopLevelMonitor(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await withAgentRunner(async (runner) => {
    await runMonitorCommand(args, logger, Boolean(options.json), runner);
  });
}
