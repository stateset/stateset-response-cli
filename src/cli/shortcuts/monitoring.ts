import chalk from 'chalk';
import type { ShortcutLogger, ShortcutRunner, TopLevelOptions, MonitorSnapshot } from './types.js';
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
} from './utils.js';
import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  listWebhooks,
  listWebhookLogs,
  pushWebhookLog,
  createAlert,
  deleteAlert,
  listAlerts,
  loadOperationsStore,
} from '../operations-store.js';

export async function runWebhooksCommand(
  tokens: string[],
  logger: ShortcutLogger,
  json = false,
  runner?: ShortcutRunner,
): Promise<void> {
  const raw = toLines(tokens);
  const { options, positionals } = parseCommandArgs(raw);
  const action = positionals[0]?.toLowerCase() || 'list';
  const firstArg = positionals[1];
  const hasPositionalId = firstArg && !firstArg.startsWith('--');
  const webhookRef = options.id || (action !== 'create' && hasPositionalId ? firstArg : undefined);
  const limit = toPositiveInteger(options.limit, 20, 200);
  const rows = action === 'list' ? listWebhooks(webhookRef) : [];

  if (action === 'list') {
    if (rows.length === 0) {
      logger.warning('No webhooks configured.');
      return;
    }
    if (json) {
      logger.output(JSON.stringify({ webhooks: rows }, null, 2));
      return;
    }
    const tableRows = rows.map((entry) => ({
      id: entry.id,
      url: entry.url,
      events: entry.events.join(','),
      enabled: String(entry.enabled),
      updated: entry.updatedAt,
    }));
    logger.output(formatTable(tableRows, ['id', 'url', 'events', 'enabled', 'updated']));
    return;
  }

  if (action === 'get') {
    if (!webhookRef) {
      logger.warning('Usage: /webhooks get <webhook-id-or-url>');
      return;
    }
    try {
      const result = getWebhook(webhookRef);
      logger.output(JSON.stringify(result, null, 2));
    } catch (error) {
      logger.warning(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (action === 'create') {
    const eventSource = options.url || options.endpoint || options.webhook;
    const eventList = options.events || options.event;
    const url = hasPositionalId ? firstArg : eventSource;
    if (!url) {
      logger.warning(
        'Usage: /webhooks create <url> [--events event1,event2] [--enabled true|false]',
      );
      return;
    }
    try {
      const created = createWebhook({
        url,
        events: eventList,
        enabled: parseToggleValue(options.enabled) !== false,
      });
      if (runner) {
        await pushWebhookLog({
          webhookId: created.id,
          event: 'created',
          status: 'ok',
          statusMessage: 'created via CLI',
        });
      }
      logger.output(
        json
          ? JSON.stringify({ webhook: created }, null, 2)
          : formatToolResult(JSON.stringify({ webhook: created }, null, 2)),
      );
    } catch (error) {
      logger.warning(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (action === 'test') {
    if (!webhookRef) {
      logger.warning('Usage: /webhooks test <webhook-id>');
      return;
    }
    try {
      const target = getWebhook(webhookRef);
      if (runner) {
        // no remote dispatch yet; record an invocation for operational visibility
        await pushWebhookLog({
          webhookId: target.id,
          event: 'test',
          status: 'ok',
          statusMessage: 'synthetic test event',
          payload: { url: target.url, events: target.events },
        });
      }
      logger.output(
        json
          ? JSON.stringify({ webhook: target.id, status: 'ok', test: true }, null, 2)
          : formatToolResult(
              JSON.stringify({ webhook: target.id, status: 'ok', test: true }, null, 2),
            ),
      );
    } catch (error) {
      logger.warning(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (action === 'logs') {
    if (!webhookRef) {
      logger.warning('Usage: /webhooks logs <webhook-id>');
      return;
    }
    try {
      const target = getWebhook(webhookRef);
      const logs = listWebhookLogs(target.id, limit);
      if (json) {
        logger.output(JSON.stringify({ webhook: target.id, logs }, null, 2));
      } else {
        if (logs.length === 0) {
          logger.warning(`No logs for webhook "${target.id}".`);
          return;
        }
        logger.output(
          formatTable(
            logs.map((entry) => ({
              time: entry.createdAt,
              event: entry.event,
              status: entry.status,
              id: entry.id,
              message: entry.statusMessage ?? '',
            })),
            ['time', 'event', 'status', 'id', 'message'],
          ),
        );
      }
    } catch (error) {
      logger.warning(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (action === 'delete') {
    if (!webhookRef) {
      logger.warning('Usage: /webhooks delete <webhook-id>');
      return;
    }
    try {
      const removed = deleteWebhook(webhookRef);
      logger.output(
        json
          ? JSON.stringify({ removed }, null, 2)
          : formatToolResult(JSON.stringify({ removed }, null, 2)),
      );
    } catch (error) {
      logger.warning(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  logger.warning(`Unknown webhooks command "${action}".`);
  logger.output(formatToolResult('Available: list, create, test, logs, delete'));
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
      logger.warning(error instanceof Error ? error.message : String(error));
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
      logger.warning(error instanceof Error ? error.message : String(error));
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
  ] = await Promise.all([
    runner.callTool('list_agents', { limit: 1000 }),
    runner.callTool('list_rules', { limit: 1000 }),
    runner.callTool('get_response_count', {}),
    runner.callTool('get_message_count', {}),
    runner.callTool('kb_get_collection_info', {}),
    isAgentScope
      ? runner.callTool('list_channels', { ...scopedFilter, limit: listLimit })
      : runner.callTool('get_channel_count', {}),
    runner.callTool('list_channels', { ...scopedFilter, status: 'open', limit: 1000 }),
    runner.callTool('list_channels', {
      ...scopedFilter,
      status: 'needs_attention',
      limit: 1000,
    }),
    runner.callTool('list_channels', { ...scopedFilter, status: 'in_progress', limit: 1000 }),
    runner.callTool('list_channels', { ...scopedFilter, limit: recentChannelsLimit }),
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

  const operationsStore = loadOperationsStore();
  const enabledWebhookCount = operationsStore.webhooks.filter((webhook) => webhook.enabled).length;
  const recentWebhookLogs = operationsStore.webhookLogs
    .slice(0, recentWebhookLogLimit)
    .map((entry) => ({
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
      value: `${operationsStore.webhooks.length} (${enabledWebhookCount} enabled)`,
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
  await runWebhooksCommand(args, logger, Boolean(options.json));
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
