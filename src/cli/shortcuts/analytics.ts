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

function isPositiveRating(value: unknown): boolean {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return ['good', 'positive', 'great', 'excellent', 'thumbs_up', 'upvote', '5', '4'].includes(
    normalized,
  );
}

function isNegativeRating(value: unknown): boolean {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return ['bad', 'negative', 'poor', 'thumbs_down', 'downvote', '1', '2'].includes(normalized);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

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
    'quality',
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

  // Treat bare shorthand values (for example: 7d) as lookback windows for --from/--since.
  if (fromInput) {
    fromInput = parsePeriodRangeAsIso(fromInput) ?? fromInput;
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

  if (action === 'quality') {
    const [channelsData, responsesData, settingsData] = await Promise.all([
      fetchPaginatedAnalytics(runner, 'list_channels'),
      fetchPaginatedAnalytics(runner, 'list_responses'),
      runner.callTool<unknown[]>('list_agent_settings', {}),
    ]);

    const filteredChannels = channelsData.filter((item) =>
      isInDateRange(asStringRecord(item).created_at, dateRange.from, dateRange.to),
    );
    const filteredResponses = responsesData.filter((item) =>
      isInDateRange(asStringRecord(item).created_date, dateRange.from, dateRange.to),
    );

    const ratedResponses = filteredResponses.filter((item) => {
      const rating = asStringRecord(item).rating;
      return typeof rating === 'string' && rating.trim().length > 0;
    });
    const positiveRatings = ratedResponses.filter((item) =>
      isPositiveRating(asStringRecord(item).rating),
    ).length;
    const negativeRatings = ratedResponses.filter((item) =>
      isNegativeRating(asStringRecord(item).rating),
    ).length;
    const escalatedChannels = filteredChannels.filter((item) => {
      const channel = asStringRecord(item);
      return channel.escalated === true || channel.status === 'needs_attention';
    }).length;
    const resolvedChannels = filteredChannels.filter(
      (item) => asStringRecord(item).status === 'closed',
    ).length;
    const settingsRows = Array.isArray(settingsData.payload) ? settingsData.payload : [];
    const configuredHandleTimes = settingsRows
      .map((entry) => Number(asStringRecord(entry).handle_time))
      .filter((value) => Number.isFinite(value) && value > 0);
    const averageHandleTime =
      configuredHandleTimes.length > 0
        ? configuredHandleTimes.reduce((sum, value) => sum + value, 0) /
          configuredHandleTimes.length
        : null;

    const overall = [
      {
        metric: 'Conversations',
        value: String(filteredChannels.length),
      },
      {
        metric: 'Resolution rate',
        value:
          filteredChannels.length > 0
            ? formatPercent((resolvedChannels / filteredChannels.length) * 100)
            : '0.0%',
      },
      {
        metric: 'Escalation rate',
        value:
          filteredChannels.length > 0
            ? formatPercent((escalatedChannels / filteredChannels.length) * 100)
            : '0.0%',
      },
      {
        metric: 'CSAT signal',
        value:
          ratedResponses.length > 0
            ? formatPercent((positiveRatings / ratedResponses.length) * 100)
            : 'n/a',
      },
      {
        metric: 'Negative feedback',
        value:
          ratedResponses.length > 0
            ? formatPercent((negativeRatings / ratedResponses.length) * 100)
            : 'n/a',
      },
      {
        metric: 'Avg handle time',
        value: averageHandleTime === null ? 'n/a' : `${Math.round(averageHandleTime)}ms`,
      },
    ];

    const byAgent = new Map<
      string,
      {
        responses: number;
        rated: number;
        positive: number;
        negative: number;
        takeovers: number;
      }
    >();
    for (const entry of filteredResponses) {
      const response = asStringRecord(entry);
      const agentName = String(response.served_by_agent || 'unassigned').trim() || 'unassigned';
      const row = byAgent.get(agentName) || {
        responses: 0,
        rated: 0,
        positive: 0,
        negative: 0,
        takeovers: 0,
      };
      row.responses += 1;
      if (response.agent_take_over === true) {
        row.takeovers += 1;
      }
      if (typeof response.rating === 'string' && response.rating.trim()) {
        row.rated += 1;
        if (isPositiveRating(response.rating)) row.positive += 1;
        if (isNegativeRating(response.rating)) row.negative += 1;
      }
      byAgent.set(agentName, row);
    }

    const agentRows = Array.from(byAgent.entries())
      .map(([agentName, row]) => ({
        agent: agentName,
        responses: String(row.responses),
        csat: row.rated > 0 ? formatPercent((row.positive / row.rated) * 100) : 'n/a',
        escalations: formatPercent((row.takeovers / Math.max(row.responses, 1)) * 100),
        negative: row.rated > 0 ? formatPercent((row.negative / row.rated) * 100) : 'n/a',
      }))
      .sort((a, b) => Number.parseInt(b.responses, 10) - Number.parseInt(a.responses, 10))
      .slice(0, 10);

    if (json) {
      logger.output(
        JSON.stringify(
          {
            overall,
            agents: agentRows,
            filters: {
              from: dateRange.from ? new Date(dateRange.from).toISOString() : undefined,
              to: dateRange.to ? new Date(dateRange.to).toISOString() : undefined,
            },
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.success('Response quality dashboard');
    logger.output(formatTable(overall, ['metric', 'value']));
    if (agentRows.length > 0) {
      logger.output('');
      logger.output('By agent');
      logger.output(
        formatTable(agentRows, ['agent', 'responses', 'csat', 'escalations', 'negative']),
      );
    }
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
