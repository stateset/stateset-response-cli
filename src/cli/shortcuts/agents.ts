import fs from 'node:fs';
import path from 'node:path';
import type { ShortcutLogger, ShortcutRunner, TopLevelOptions } from './types.js';
import {
  toLines,
  parseCommandArgs,
  parseListArgs,
  stripQuotes,
  asStringRecord,
  printPayload,
  buildTopLevelLogger,
  withAgentRunner,
  resolveSafeOutputPath,
  parseToggleValue,
} from './utils.js';

export async function runAgentsCommand(
  tokens: string[],
  runner: ShortcutRunner,
  logger: ShortcutLogger,
  json = false,
): Promise<void> {
  const raw = toLines(tokens);
  const { options, positionals } = parseCommandArgs(raw);
  const { limit, offset } = parseListArgs(raw);
  const action = positionals[0]?.toLowerCase() || null;

  if (!action || action === 'list') {
    const result = await runner.callTool('list_agents', { limit, offset });
    printPayload(logger, 'Agents', result.payload, json);
    return;
  }

  if (action === 'create') {
    const name = stripQuotes(options.name || positionals[1] || '');
    const type = stripQuotes(options.type || positionals[2] || '');
    if (!name || !type) {
      logger.warning('Usage: /agents create --name <name> --type <type>');
      return;
    }
    const result = await runner.callTool('create_agent', {
      agent_name: name,
      agent_type: type,
      description: options.description,
      role: options.role,
      goal: options.goal,
      instructions: options.instructions,
      activated: parseToggleValue(options.active || '') ?? true,
      voice_model: options.voice_model,
      voice_model_id: options.voice_model_id,
      voice_model_provider: options.voice_model_provider,
    });
    printPayload(logger, 'Agent created', result.payload, json);
    return;
  }

  if (action === 'switch') {
    const agentId = positionals[1];
    if (!agentId) {
      logger.warning('Usage: /agents switch <agent-id>');
      return;
    }
    process.env.STATESET_ACTIVE_AGENT_ID = agentId;
    logger.warning(
      'Agent context is stored only for this process. Use /agents create with default channel binding for persistence.',
    );
    logger.success(`Active agent for this session set to ${agentId}`);
    return;
  }

  if (action === 'get') {
    const agentId = positionals[1];
    if (!agentId) {
      logger.warning('Usage: /agents get <agent-id>');
      return;
    }
    const result = await runner.callTool('get_agent', { agent_id: agentId });
    printPayload(logger, `Agent ${agentId}`, result.payload, json);
    return;
  }

  if (action === 'export') {
    const agentId = positionals[1];
    if (!agentId) {
      logger.warning('Usage: /agents export <agent-id> [file]');
      return;
    }
    const outputFile = positionals[2];
    const result = await runner.callTool('export_agent', { agent_id: agentId });
    if (outputFile) {
      try {
        const outputPath = resolveSafeOutputPath(outputFile, { label: 'Agent export path' });
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(result.payload, null, 2), 'utf-8');
        logger.success(`Agent exported to ${outputPath}`);
      } catch (error) {
        logger.error(
          `Failed to write export file: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else {
      printPayload(logger, `Agent ${agentId}`, result.payload, json);
    }
    return;
  }

  if (action === 'import') {
    const sourceFile = positionals[1];
    if (!sourceFile) {
      logger.warning('Usage: /agents import <file>');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(path.resolve(sourceFile), 'utf-8'));
    } catch (error) {
      logger.error(
        `Unable to read import file: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    const payload = asStringRecord(parsed);
    const agent = asStringRecord(payload.agent || payload) as Record<string, unknown>;
    if (!agent.agent_name || !agent.agent_type) {
      logger.warning('Import file must contain agent_name and agent_type.');
      return;
    }
    const result = await runner.callTool('create_agent', {
      agent_name: String(agent.agent_name),
      agent_type: String(agent.agent_type),
      description: agent.description ? String(agent.description) : undefined,
      role: agent.role ? String(agent.role) : undefined,
      goal: agent.goal ? String(agent.goal) : undefined,
      instructions: agent.instructions ? String(agent.instructions) : undefined,
      voice_model: agent.voice_model ? String(agent.voice_model) : undefined,
      voice_model_id: agent.voice_model_id ? String(agent.voice_model_id) : undefined,
      voice_model_provider: agent.voice_model_provider
        ? String(agent.voice_model_provider)
        : undefined,
      activated: typeof agent.activated === 'boolean' ? (agent.activated as boolean) : true,
    });
    printPayload(logger, 'Agent imported', result.payload, json);
    return;
  }

  if (action === 'bootstrap') {
    const agentId = positionals[1];
    if (!agentId) {
      logger.warning('Usage: /agents bootstrap <agent-id>');
      return;
    }
    const result = await runner.callTool('bootstrap_agent', { agent_id: agentId });
    printPayload(logger, `Agent bootstrap ${agentId}`, result.payload, json);
    return;
  }

  const agentId = action;
  if (!agentId) {
    const result = await runner.callTool('list_agents', { limit, offset });
    printPayload(logger, 'Agents', result.payload, json);
    return;
  }
  const result = await runner.callTool('get_agent', { agent_id: agentId });
  printPayload(logger, `Agent ${agentId}`, result.payload, json);
}

export async function runTopLevelAgents(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await withAgentRunner(async (runner) => {
    await runAgentsCommand(args, runner, logger, Boolean(options.json));
  });
}
