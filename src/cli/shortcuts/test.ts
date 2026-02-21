import { getRuntimeContext } from '../../config.js';
import { StateSetAgent } from '../../agent.js';
import type { ShortcutLogger, TopLevelOptions } from './types.js';
import { stripQuotes, buildTopLevelLogger, formatToolResult } from './utils.js';

export async function runTestCommand(
  tokens: string[],
  logger: ShortcutLogger,
  json = false,
  agentId?: string,
): Promise<void> {
  const input = stripQuotes(tokens.join(' '));
  if (!input) {
    logger.warning('Usage: /test "<message>" [--agent <id>]');
    return;
  }

  const previousAgentId = process.env.STATESET_ACTIVE_AGENT_ID;
  if (agentId) {
    process.env.STATESET_ACTIVE_AGENT_ID = agentId;
  }

  const { anthropicApiKey } = getRuntimeContext();
  const testAgent = new StateSetAgent(anthropicApiKey);
  await testAgent.connect();
  try {
    const response = await testAgent.chat(input);
    if (json) {
      logger.output(JSON.stringify({ response }, null, 2));
    } else {
      logger.output(formatToolResult(response || ''));
    }
  } finally {
    await testAgent.disconnect();
    if (agentId) {
      if (previousAgentId === undefined) {
        delete process.env.STATESET_ACTIVE_AGENT_ID;
      } else {
        process.env.STATESET_ACTIVE_AGENT_ID = previousAgentId;
      }
    }
  }
}

export async function runTopLevelTest(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await runTestCommand(args, logger, Boolean(options.json), options.agent);
}
