import type { ShortcutLogger, ShortcutRunner, TopLevelOptions, AnalyticsRows } from './types.js';
import { DEFAULT_LIST_OFFSET } from './types.js';
import {
  toLines,
  parseCommandArgs,
  toPositiveInteger,
  toNonNegativeInteger,
  extractAggregateCount,
  asStringRecord,
  isInDateRange,
  parseDateRange,
  parsePeriodRangeAsIso,
  printPayload,
  buildTopLevelLogger,
  withAgentRunner,
  formatTable,
} from './utils.js';

const ANALYTICS_PAGE_LIMIT = 500;

async function fetchPaginatedAnalytics(
  runner: ShortcutRunner,
  toolName: 'list_channels' | 'list_responses',
): Promise<unknown[]> {
  const rows: unknown[] = [];
  let offset = 0;
  while (true) {
    const result = await runner.callTool<unknown[]>(toolName, {
      limit: ANALYTICS_PAGE_LIMIT,
      offset,
    });
    const batch = Array.isArray(result.payload) ? result.payload : [];
    rows.push(...batch);
    if (batch.length < ANALYTICS_PAGE_LIMIT || batch.length === 0) {
      break;
    }
    offset += ANALYTICS_PAGE_LIMIT;
  }
  return rows;
}

export async function runStatusCommand(
  runner: ShortcutRunner,
  logger: ShortcutLogger,
  json = false,
): Promise<void> {
  const [
    agentsResult,
    rulesResult,
    channelCountResult,
    responseCountResult,
    messageCountResult,
    kbInfoResult,
  ] = await Promise.all([
    runner.callTool('list_agents', { limit: 1000 }),
    runner.callTool('list_rules', { limit: 1000 }),
    runner.callTool('get_channel_count', {}),
    runner.callTool('get_response_count', {}),
    runner.callTool('get_message_count', {}),
    runner.callTool('kb_get_collection_info', {}),
  ]);

  const agentCount = Array.isArray(agentsResult.payload) ? agentsResult.payload.length : 0;
  const ruleCount = Array.isArray(rulesResult.payload) ? rulesResult.payload.length : 0;
  const channelCount = extractAggregateCount(
    channelCountResult.payload,
    'channel_thread_aggregate',
  );
  const responseCount = extractAggregateCount(responseCountResult.payload, 'responses_aggregate');
  const messageCount = extractAggregateCount(messageCountResult.payload, 'message_aggregate');
  const kbCollection = asStringRecord(kbInfoResult.payload).collection;
  const kbPoints = asStringRecord(asStringRecord(kbInfoResult.payload).info).points_count;
  const rows = [
    { metric: 'Agents', value: String(agentCount) },
    { metric: 'Rules', value: String(ruleCount) },
    { metric: 'Channels', value: String(channelCount) },
    { metric: 'Messages', value: String(messageCount) },
    { metric: 'Responses', value: String(responseCount) },
    {
      metric: 'KB Collection',
      value: `${kbCollection ?? 'unknown'} (${kbPoints ?? 0} points)`,
    },
  ];
  logger.success('Current platform status');
  if (json) {
    logger.output(
      JSON.stringify({ metrics: rows }, (k, v) => (typeof v === 'bigint' ? String(v) : v), 2),
    );
  } else {
    logger.output(formatTable(rows, ['metric', 'value']));
  }
}

export async function runAnalyticsCommand(
  tokens: string[],
  runner: ShortcutRunner,
  logger: ShortcutLogger,
  json = false,
): Promise<void> {
  const raw = toLines(tokens);
  const { options, positionals: initialPositionals } = parseCommandArgs(raw);
  const knownActions = new Set([
    'summary',
    'stats',
    'agents',
    'conversations',
    'conversation',
    'responses',
  ]);
  let positionals = [...initialPositionals];
  let fromInput = options.from || options.since;
  const toInput = options.to;
  let action = positionals[0]?.toLowerCase() || 'summary';

  if (!fromInput && !toInput && !knownActions.has(action)) {
    const durationFrom = parsePeriodRangeAsIso(action);
    if (durationFrom) {
      fromInput = durationFrom;
      action = 'summary';
      positionals = positionals.slice(1);
    }
  } else if (!fromInput && !toInput && knownActions.has(action) && positionals[1]) {
    const durationFrom = parsePeriodRangeAsIso(positionals[1]);
    if (durationFrom) {
      fromInput = durationFrom;
      positionals = positionals.slice(1);
    }
  }

  const dateRange = parseDateRange(fromInput, toInput);
  if (dateRange.warnings.length > 0) {
    for (const warning of dateRange.warnings) {
      logger.warning(warning);
    }
  }
  const dateSupported = dateRange.from !== undefined || dateRange.to !== undefined;

  if (action === 'summary' || action === 'stats') {
    const [agentsResult, rulesResult, messageCountResult] = await Promise.all([
      runner.callTool('list_agents', { limit: 1000 }),
      runner.callTool('list_rules', { limit: 1000 }),
      runner.callTool('get_message_count', {}),
    ]);
    const agentCount = Array.isArray(agentsResult.payload) ? agentsResult.payload.length : 0;
    const ruleCount = Array.isArray(rulesResult.payload) ? rulesResult.payload.length : 0;
    const messageCount = extractAggregateCount(messageCountResult.payload, 'message_aggregate');
    let channelCount = 0;
    let responseCount = 0;

    if (!dateSupported) {
      const [channelCountResult, responseCountResult] = await Promise.all([
        runner.callTool('get_channel_count', {}),
        runner.callTool('get_response_count', {}),
      ]);
      channelCount = extractAggregateCount(channelCountResult.payload, 'channel_thread_aggregate');
      responseCount = extractAggregateCount(responseCountResult.payload, 'responses_aggregate');
    } else {
      const [channelsData, responsesData] = await Promise.all([
        fetchPaginatedAnalytics(runner, 'list_channels'),
        fetchPaginatedAnalytics(runner, 'list_responses'),
      ]);
      channelCount = channelsData.filter((item) =>
        isInDateRange(asStringRecord(item).created_at, dateRange.from, dateRange.to),
      ).length;
      responseCount = responsesData.filter((item) =>
        isInDateRange(asStringRecord(item).created_date, dateRange.from, dateRange.to),
      ).length;
    }

    const rows: AnalyticsRows[] = [
      { metric: 'Agents', value: String(agentCount) },
      { metric: 'Rules', value: String(ruleCount) },
      { metric: 'Channels', value: String(channelCount) },
      { metric: 'Responses', value: String(responseCount) },
      {
        metric: 'Messages',
        value: dateSupported ? `${messageCount} (all-time)` : String(messageCount),
      },
    ];
    if (dateSupported) {
      rows.push({
        metric: 'Date range filtering',
        value: 'applied',
      });
    }
    if (json) {
      logger.output(JSON.stringify({ analytics: rows }, null, 2));
    } else {
      logger.success('Analytics summary');
      logger.output(formatTable(rows, ['metric', 'value']));
    }
    return;
  }

  if (action === 'agents') {
    const agentData = await runner.callTool<unknown[]>('list_agents', {
      limit: toPositiveInteger(options.limit, 25, 200),
    });
    const agents = Array.isArray(agentData.payload) ? agentData.payload : [];
    if (agents.length === 0) {
      logger.warning('No agents found.');
      return;
    }
    const rows = await Promise.all(
      agents.map(async (entry) => {
        const agent = asStringRecord(entry);
        const agentId = String(agent.id ?? '');
        const [rulesResult, channelsResult] = await Promise.all([
          runner.callTool<unknown[]>('get_agent_rules', {
            agent_id: agentId,
            limit: 10000,
            offset: 0,
          }),
          runner.callTool<unknown[]>('list_channels', {
            agent_id: agentId,
            limit: 5000,
            offset: 0,
          }),
        ]);
        const channels = Array.isArray(channelsResult.payload) ? channelsResult.payload : [];
        const filteredChannels =
          dateRange.from !== undefined || dateRange.to !== undefined
            ? channels.filter((channel) =>
                isInDateRange(asStringRecord(channel).created_at, dateRange.from, dateRange.to),
              )
            : channels;
        return {
          agent: String(agent.agent_name || agent.name || agent.id || ''),
          id: agentId,
          rules: String(Array.isArray(rulesResult.payload) ? rulesResult.payload.length : 0),
          conversations: String(filteredChannels.length),
        };
      }),
    );
    if (json) {
      logger.output(JSON.stringify({ agents: rows }, null, 2));
      return;
    }
    logger.output(formatTable(rows, ['agent', 'id', 'rules', 'conversations']));
    return;
  }

  if (action === 'conversations' || action === 'conversation' || action === 'channels') {
    const limit = toPositiveInteger(options.limit, 20, 500);
    const offset = toNonNegativeInteger(options.offset, DEFAULT_LIST_OFFSET, 100000);
    const result = await runner.callTool<unknown[]>('list_channels', { limit, offset });
    const items = Array.isArray(result.payload) ? result.payload : [];
    const filteredItems =
      dateRange.from !== undefined || dateRange.to !== undefined
        ? items.filter((item) =>
            isInDateRange(asStringRecord(item).created_at, dateRange.from, dateRange.to),
          )
        : items;
    if (json) {
      logger.output(JSON.stringify({ conversations: filteredItems }, null, 2));
      return;
    }
    printPayload(
      logger,
      `Recent conversations${dateSupported ? ' (filtered by date)' : ''}`,
      filteredItems,
      false,
    );
    return;
  }

  if (action === 'responses') {
    const limit = toPositiveInteger(options.limit, 20, 500);
    const offset = toNonNegativeInteger(options.offset, DEFAULT_LIST_OFFSET, 100000);
    const result = await runner.callTool<unknown[]>('list_responses', { limit, offset });
    const items = Array.isArray(result.payload) ? result.payload : [];
    const filteredItems =
      dateRange.from !== undefined || dateRange.to !== undefined
        ? items.filter((item) =>
            isInDateRange(asStringRecord(item).created_date, dateRange.from, dateRange.to),
          )
        : items;
    if (json) {
      logger.output(JSON.stringify({ responses: filteredItems }, null, 2));
      return;
    }
    printPayload(
      logger,
      `Recent responses${dateSupported ? ' (filtered by date)' : ''}`,
      filteredItems,
      false,
    );
    return;
  }

  logger.warning(`Unknown analytics command "${action}".`);
}

export async function runTopLevelStatus(options: TopLevelOptions = {}): Promise<void> {
  const logger = buildTopLevelLogger();
  await withAgentRunner(async (runner) => {
    await runStatusCommand(runner, logger, Boolean(options.json));
  });
}

export async function runTopLevelStats(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const from = options.from || options.since;
  await runTopLevelAnalytics(args, {
    json: options.json,
    from,
    to: options.to,
  });
}

export async function runTopLevelAnalytics(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  const forwarded = [...args];
  if (options.from) {
    forwarded.push('--from', options.from);
  }
  if (options.to) {
    forwarded.push('--to', options.to);
  }
  await withAgentRunner(async (runner) => {
    await runAnalyticsCommand(forwarded, runner, logger, Boolean(options.json));
  });
}
