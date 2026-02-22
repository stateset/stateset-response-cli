import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import type { ShortcutLogger, ShortcutRunner, TopLevelOptions } from './types.js';
import { DEFAULT_LIST_LIMIT, DEFAULT_LIST_OFFSET } from './types.js';
import { getErrorMessage } from '../../lib/errors.js';
import {
  toLines,
  parseCommandArgs,
  parseListArgs,
  stripQuotes,
  asStringRecord,
  asRecordArray,
  toDisplayValue,
  toPositiveInteger,
  printPayload,
  resolveSafeOutputJsonPath,
  buildTopLevelLogger,
  withAgentRunner,
  formatToolResult,
  parseToggleValue,
} from './utils.js';

export async function runChannelsCommand(
  tokens: string[],
  runner: ShortcutRunner,
  logger: ShortcutLogger,
  json = false,
): Promise<void> {
  const raw = toLines(tokens);
  const { options, positionals } = parseCommandArgs(raw);
  const action = positionals[0]?.toLowerCase() || null;

  if (!action || action === 'list') {
    const limit = toPositiveInteger(options.limit, DEFAULT_LIST_LIMIT, 1000);
    const offset = toPositiveInteger(options.offset, DEFAULT_LIST_OFFSET, 100000);
    const result = await runner.callTool('list_channels', {
      limit,
      offset,
      status: options.status,
      agent_id: options.agent_id || options.agent,
      escalated: parseToggleValue(options.escalated || '') ?? undefined,
    });
    printPayload(logger, 'Channels', result.payload, json);
    return;
  }

  if (action === 'create') {
    const name = stripQuotes(options.name || positionals[1] || '');
    if (!name) {
      logger.warning('Usage: /channels create --name <name> [--agent <agent-id>]');
      return;
    }
    const result = await runner.callTool('create_channel', {
      name,
      agent_id: options.agent || options.agent_id,
      model: options.model,
      user_id: options.user || options.user_id,
      channel: options.channel || options.type,
      response_system_prompt: options.prompt,
    });
    printPayload(logger, 'Channel created', result.payload, json);
    return;
  }

  if (action === 'messages') {
    const channelId = positionals[1];
    if (!channelId) {
      logger.warning('Usage: /channels messages <uuid> [limit=50]');
      return;
    }
    const result = await runner.callTool('get_channel_with_messages', {
      uuid: channelId,
      message_limit: toPositiveInteger(options.limit, 100, 500),
    });
    printPayload(logger, `Channel ${channelId}`, result.payload, json);
    return;
  }

  const channelId = action;
  const result = await runner.callTool('get_channel', { uuid: channelId });
  printPayload(logger, `Channel ${channelId}`, result.payload, json);
}

export async function runConvosCommand(
  tokens: string[],
  runner: ShortcutRunner,
  logger: ShortcutLogger,
  json = false,
): Promise<void> {
  const raw = toLines(tokens);
  const { options, positionals } = parseCommandArgs(raw);
  const action = positionals[0]?.toLowerCase() || 'recent';

  if (action === 'recent' || action === 'list') {
    const limit = toPositiveInteger(options.limit, DEFAULT_LIST_LIMIT, 200);
    const offset = toPositiveInteger(options.offset, DEFAULT_LIST_OFFSET, 100000);
    const result = await runner.callTool('list_channels', { limit, offset });
    printPayload(logger, 'Recent conversations', result.payload, json);
    return;
  }

  if (action === 'search') {
    const query = stripQuotes(positionals.slice(1).join(' '));
    if (!query) {
      logger.warning('Usage: /convos search <query>');
      return;
    }
    const result = await runner.callTool('search_messages', {
      query,
      limit: toPositiveInteger(options.limit, 20, 200),
    });
    printPayload(logger, `Conversations matching: ${query}`, result.payload, json);
    return;
  }

  if (action === 'get') {
    const conversationId = positionals[1];
    if (!conversationId) {
      logger.warning('Usage: /convos get <conversation-id>');
      return;
    }
    const limit = toPositiveInteger(options.limit, 100, 1000);
    const result = await runner.callTool('get_channel_with_messages', {
      uuid: conversationId,
      message_limit: limit,
    });
    if (json) {
      logger.output(JSON.stringify(result.payload, null, 2));
      return;
    }
    printPayload(logger, `Conversation ${conversationId}`, result.payload, json);
    return;
  }

  if (action === 'count') {
    const channelId = options.channel_id || options.channel;
    const result = await runner.callTool('get_message_count', {
      chat_id: channelId || undefined,
    });
    printPayload(logger, 'Conversation message count', result.payload, json);
    return;
  }

  if (action === 'export') {
    const conversationId = positionals[1];
    if (!conversationId) {
      logger.warning('Usage: /convos export <conversation-id> [out]');
      return;
    }
    const outputFile = positionals[2];
    const limit = toPositiveInteger(options.limit, 1000, 2000);
    const result = await runner.callTool('get_channel_with_messages', {
      uuid: conversationId,
      message_limit: limit,
    });
    if (outputFile) {
      try {
        const outputPath = resolveSafeOutputJsonPath(
          outputFile,
          `conversation-${conversationId}.json`,
        );
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(result.payload, null, 2), 'utf-8');
        logger.success(`Conversation exported to ${outputPath}`);
      } catch (error) {
        logger.error(`Failed to export conversation: ${getErrorMessage(error)}`);
      }
      return;
    }
    printPayload(logger, `Conversation ${conversationId}`, result.payload, json);
    return;
  }

  if (action === 'replay') {
    const conversationId = positionals[1];
    if (!conversationId) {
      logger.warning('Usage: /convos replay <conversation-id> [--limit N]');
      return;
    }
    const limit = toPositiveInteger(options.limit, 500, 2000);
    const result = await runner.callTool('get_channel_with_messages', {
      uuid: conversationId,
      message_limit: limit,
    });
    if (json) {
      logger.output(JSON.stringify(result.payload, null, 2));
      return;
    }
    const payload = asStringRecord(result.payload);
    const channelId = toDisplayValue(payload.uuid || payload.id || conversationId);
    const createdAt = toDisplayValue(payload.created_at || payload.createdAt);
    const status = toDisplayValue(payload.status);
    const agentInfo = asStringRecord(payload.agent);
    const agent = toDisplayValue(
      agentInfo.agent_name || agentInfo.id || agentInfo.name || payload.agent_id || '-',
    );
    const messages = asRecordArray(payload.messages);
    logger.output(chalk.bold(`Conversation ${channelId}`));
    logger.output(formatToolResult(`Status: ${status} | Agent: ${agent} | Created: ${createdAt}`));
    if (messages.length === 0) {
      logger.output(chalk.gray('  (no messages)'));
      return;
    }
    for (const message of messages.slice(0, limit)) {
      const sender = toDisplayValue(
        message.username ||
          (typeof message.fromAgent === 'boolean' && message.fromAgent
            ? 'agent'
            : message.from || message.from_id || 'unknown'),
      );
      const stamp = toDisplayValue(message.timestamp || message.created_at);
      const body = toDisplayValue(message.body);
      const fromAgent = message.fromAgent === true;
      const speaker = fromAgent ? 'agent' : sender;
      logger.output(
        formatToolResult(`${chalk.gray(stamp)} ${chalk.green(`[${speaker}]`)} ${body}`),
      );
    }
    return;
  }

  if (action === 'tag') {
    const conversationId = positionals[1];
    const mode = positionals[2]?.toLowerCase();
    const tags = positionals
      .slice(3)
      .filter(Boolean)
      .map((tag) => tag.trim());
    if (!conversationId || !mode || tags.length === 0) {
      logger.warning('Usage: /convos tag <conversation-id> <add|remove|set> <tag> [tag...]');
      return;
    }
    const channelResult = await runner.callTool('get_channel', { uuid: conversationId });
    const channel = asStringRecord(channelResult.payload);
    const existingTags = Array.isArray(channel.tags)
      ? channel.tags.filter((entry): entry is string => typeof entry === 'string')
      : [];
    const existingNormalized = new Set(
      existingTags.map((tag) => tag.toLowerCase().trim()).filter(Boolean),
    );
    const normalizedTags = tags.map((tag) => tag.toLowerCase().trim()).filter(Boolean);

    let nextTags: string[] = [];
    if (mode === 'add') {
      const merged = new Set(existingNormalized);
      for (const tag of normalizedTags) merged.add(tag);
      nextTags = Array.from(merged);
    } else if (mode === 'remove') {
      nextTags = existingTags.filter((tag) => !normalizedTags.includes(tag.toLowerCase().trim()));
    } else if (mode === 'set') {
      nextTags = Array.from(new Set(normalizedTags));
    } else {
      logger.warning('Tag action must be add, remove, or set.');
      return;
    }

    const result = await runner.callTool('update_channel', {
      uuid: conversationId,
      tags: nextTags,
    });
    printPayload(logger, `Conversation ${conversationId} tags`, result.payload, json);
    return;
  }

  const conversationId = action;
  const result = await runner.callTool('get_channel_with_messages', {
    uuid: conversationId,
    message_limit: toPositiveInteger(options.limit, 100, 1000),
  });
  printPayload(logger, `Conversation ${conversationId}`, result.payload, json);
}

export async function runMessagesCommand(
  tokens: string[],
  runner: ShortcutRunner,
  logger: ShortcutLogger,
  json = false,
): Promise<void> {
  const raw = toLines(tokens);
  const { options, positionals } = parseCommandArgs(raw);
  const { limit, offset } = parseListArgs(raw);
  const action = positionals[0]?.toLowerCase() || 'list';

  if (action === 'list') {
    const chatId = options.chat_id || options.chat || options.channel || options.channel_id;
    if (!chatId) {
      logger.warning('Usage: /messages list --chat <chat-id> [--limit N] [--offset N]');
      return;
    }
    const result = await runner.callTool('list_messages', {
      chat_id: chatId,
      limit,
      offset,
    });
    printPayload(logger, `Messages for ${chatId}`, result.payload, json);
    return;
  }

  if (action === 'get') {
    const messageId = positionals[1];
    if (!messageId) {
      logger.warning('Usage: /messages get <message-id>');
      return;
    }
    const result = await runner.callTool('get_message', { id: messageId });
    printPayload(logger, `Message ${messageId}`, result.payload, json);
    return;
  }

  if (action === 'search') {
    const query = stripQuotes(positionals.slice(1).join(' '));
    if (!query) {
      logger.warning('Usage: /messages search <query> [--chat <chat-id>]');
      return;
    }
    const result = await runner.callTool('search_messages', {
      query,
      chat_id: options.chat_id || options.chat || options.channel || options.channel_id,
      from_agent: parseToggleValue(options.from_agent || options.fromAgent),
      limit: toPositiveInteger(options.limit, 20, 200),
    });
    printPayload(logger, `Messages matching: ${query}`, result.payload, json);
    return;
  }

  if (action === 'count') {
    const chatId = options.chat_id || options.chat || options.channel || options.channel_id;
    const result = await runner.callTool('get_message_count', {
      chat_id: chatId,
    });
    printPayload(logger, 'Message count', result.payload, json);
    return;
  }

  if (action === 'create') {
    const hasChatOption =
      options.chat_id !== undefined ||
      options.chat !== undefined ||
      options.channel !== undefined ||
      options.channel_id !== undefined;
    const chatId = hasChatOption
      ? options.chat_id || options.chat || options.channel || options.channel_id
      : positionals[1];
    const body = hasChatOption
      ? stripQuotes(positionals.slice(1).join(' '))
      : stripQuotes(positionals.slice(2).join(' '));

    if (!chatId || !body) {
      logger.warning('Usage: /messages create <chat-id> <body> [--username <name>] [--from <id>]');
      return;
    }

    const result = await runner.callTool('create_message', {
      chat_id: chatId,
      body,
      username: options.username || options.user,
      from:
        options.from ||
        options.sender ||
        options.fromAgent ||
        options.from_agent ||
        options.user ||
        undefined,
      user_id: options.user_id,
      fromAgent: parseToggleValue(options.from_agent || options.fromAgent),
      agent_id: options.agent_id || options.agent,
      command_used: options.command || options.command_used,
    });
    printPayload(logger, 'Message created', result.payload, json);
    return;
  }

  if (action === 'delete') {
    const messageId = positionals[1];
    if (!messageId) {
      logger.warning('Usage: /messages delete <message-id>');
      return;
    }
    const result = await runner.callTool('delete_message', { id: messageId });
    printPayload(logger, `Message ${messageId} deleted`, result.payload, json);
    return;
  }

  if (action === 'annotate') {
    const messageId = positionals[1];
    const args = positionals.slice(2);
    if (!messageId || args.length === 0) {
      logger.warning('Usage: /messages annotate <message-id> <key>=<value> [key2=value2 ...]');
      return;
    }
    const existingResult = await runner.callTool('get_message', { id: messageId });
    const existing = asStringRecord(existingResult.payload);
    const existingMetadata = asStringRecord(existing.metadata);
    const nextMetadata: Record<string, unknown> = { ...existingMetadata };
    let added = 0;
    for (const raw of args) {
      const eq = raw.indexOf('=');
      if (eq <= 0) {
        logger.warning(`Invalid annotation "${raw}". Use key=value format.`);
        return;
      }
      const key = raw.slice(0, eq).trim();
      const value = raw.slice(eq + 1);
      if (!key) {
        logger.warning(`Invalid annotation "${raw}". Use key=value format.`);
        return;
      }
      nextMetadata[key] = value;
      added += 1;
    }
    const result = await runner.callTool('update_message', {
      id: messageId,
      metadata: nextMetadata,
    });
    logger.success(`Added ${added} annotation(s) to ${messageId}`);
    printPayload(logger, `Message ${messageId}`, result.payload, json);
    return;
  }

  const messageId = action;
  const result = await runner.callTool('get_message', { id: messageId });
  printPayload(logger, `Message ${messageId}`, result.payload, json);
}

export async function runResponsesCommand(
  tokens: string[],
  runner: ShortcutRunner,
  logger: ShortcutLogger,
  json = false,
): Promise<void> {
  const raw = toLines(tokens);
  const { options, positionals } = parseCommandArgs(raw);
  const { limit, offset } = parseListArgs(raw);
  const action = positionals[0]?.toLowerCase() || 'list';

  if (action === 'list' || action === 'recent') {
    const result = await runner.callTool('list_responses', {
      limit,
      offset,
      channel: options.channel,
      rating: options.rating,
    });
    printPayload(logger, 'Responses', result.payload, json);
    return;
  }

  if (action === 'search') {
    const query = stripQuotes(positionals.slice(1).join(' '));
    if (!query) {
      logger.warning('Usage: /responses search <query> [--limit N]');
      return;
    }
    const result = await runner.callTool('search_responses', {
      query,
      limit: toPositiveInteger(options.limit, 20, 200),
    });
    printPayload(logger, `Responses matching: ${query}`, result.payload, json);
    return;
  }

  if (action === 'count') {
    const result = await runner.callTool('get_response_count', {});
    printPayload(logger, 'Response count', result.payload, json);
    return;
  }

  if (action === 'get') {
    const responseId = positionals[1];
    if (!responseId) {
      logger.warning('Usage: /responses get <response-id>');
      return;
    }
    const result = await runner.callTool('get_response', { id: responseId });
    printPayload(logger, `Response ${responseId}`, result.payload, json);
    return;
  }

  if (action === 'rate') {
    const responseId = positionals[1];
    const rating = positionals[2] || options.rating;
    if (!responseId || !rating) {
      logger.warning('Usage: /responses rate <response-id> <rating>');
      return;
    }
    const result = await runner.callTool('bulk_update_response_ratings', {
      response_ids: [responseId],
      rating,
    });
    printPayload(logger, `Response ${responseId} rating`, result.payload, json);
    return;
  }

  const responseId = action;
  const result = await runner.callTool('get_response', { id: responseId });
  printPayload(logger, `Response ${responseId}`, result.payload, json);
}

export async function runTopLevelChannels(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await withAgentRunner(async (runner) => {
    await runChannelsCommand(args, runner, logger, Boolean(options.json));
  });
}

export async function runTopLevelConvos(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await withAgentRunner(async (runner) => {
    await runConvosCommand(args, runner, logger, Boolean(options.json));
  });
}

export async function runTopLevelMessages(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await withAgentRunner(async (runner) => {
    await runMessagesCommand(args, runner, logger, Boolean(options.json));
  });
}

export async function runTopLevelResponses(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await withAgentRunner(async (runner) => {
    await runResponsesCommand(args, runner, logger, Boolean(options.json));
  });
}
