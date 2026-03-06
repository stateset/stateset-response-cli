import type Anthropic from '@anthropic-ai/sdk';
import type { ShortcutLogger } from './types.js';
import {
  asRecordArray,
  asStringRecord,
  buildTopLevelLogger,
  formatToolResult,
  toDisplayValue,
  toPositiveInteger,
  withAgentRunner,
} from './utils.js';
import { TracedAgentSession, type AgentTraceResult } from './agent-runtime.js';

interface ReplayStep {
  index: number;
  customerMessage: string;
  expectedResponse: string;
  seedMessages: Anthropic.MessageParam[];
}

interface ReplayResult {
  conversationId: string;
  agentId?: string;
  status?: string;
  createdAt?: string;
  steps: Array<{
    index: number;
    customerMessage: string;
    expectedResponse: string;
    replay: AgentTraceResult;
  }>;
}

function isAgentMessage(message: Record<string, unknown>): boolean {
  if (message.fromAgent === true) {
    return true;
  }
  if (typeof message.agent_id === 'string' && message.agent_id.trim()) {
    return true;
  }
  const from = String(message.from || '').toLowerCase();
  return from === 'agent' || from === 'assistant' || from === 'bot';
}

function buildReplaySteps(messages: Array<Record<string, unknown>>): ReplayStep[] {
  const steps: ReplayStep[] = [];
  const transcript: Anthropic.MessageParam[] = [];
  let pendingCustomerMessage = '';
  let pendingExpectedResponses: string[] = [];

  const flush = () => {
    if (!pendingCustomerMessage) {
      return;
    }
    steps.push({
      index: steps.length + 1,
      customerMessage: pendingCustomerMessage,
      expectedResponse: pendingExpectedResponses.join('\n\n').trim(),
      seedMessages: transcript.map((entry) => ({ ...entry })),
    });
    transcript.push({ role: 'user', content: pendingCustomerMessage });
    if (pendingExpectedResponses.length > 0) {
      transcript.push({ role: 'assistant', content: pendingExpectedResponses.join('\n\n').trim() });
    }
    pendingCustomerMessage = '';
    pendingExpectedResponses = [];
  };

  for (const message of messages) {
    const body = toDisplayValue(message.body).trim();
    if (!body || body === '-') {
      continue;
    }
    if (isAgentMessage(message)) {
      if (pendingCustomerMessage) {
        pendingExpectedResponses.push(body);
      } else if (transcript.length > 0) {
        const previous = transcript[transcript.length - 1];
        if (previous && previous.role === 'assistant' && typeof previous.content === 'string') {
          previous.content = `${previous.content}\n\n${body}`;
        } else {
          transcript.push({ role: 'assistant', content: body });
        }
      }
      continue;
    }
    flush();
    pendingCustomerMessage = body;
  }

  flush();
  return steps;
}

function formatReplayStep(step: ReplayResult['steps'][number]): string {
  const lines: string[] = [];
  lines.push(`Step ${step.index}`);
  lines.push(`Customer: ${step.customerMessage}`);
  lines.push(`Actual: ${step.expectedResponse || '(no recorded agent response)'}`);
  lines.push(`Replay: ${step.replay.finalResponse || '(empty)'}`);
  lines.push('Trace:');
  if (step.replay.toolCalls.length === 0) {
    lines.push('  No tool calls.');
  } else {
    for (const call of step.replay.toolCalls) {
      lines.push(`  ${call.step}. ${call.name} [${call.decision}] ${JSON.stringify(call.args)}`);
      if (call.reason) {
        lines.push(`     reason: ${call.reason}`);
      }
      if (call.resultText) {
        const result = call.resultText.replace(/\s+/g, ' ').trim();
        lines.push(`     result: ${result.slice(0, 180)}${result.length > 180 ? '...' : ''}`);
      }
    }
  }
  return lines.join('\n');
}

function formatReplayResult(result: ReplayResult, stepThrough: boolean): string {
  const lines: string[] = [];
  lines.push(`Conversation: ${result.conversationId}`);
  lines.push(`Status: ${result.status || '-'}`);
  lines.push(`Agent: ${result.agentId || '-'}`);
  lines.push(`Created: ${result.createdAt || '-'}`);
  lines.push(`Turns replayed: ${result.steps.length}`);

  const mismatches = result.steps.filter(
    (step) =>
      step.expectedResponse.trim() &&
      step.expectedResponse.trim() !== step.replay.finalResponse.trim(),
  );
  lines.push(`Mismatched turns: ${mismatches.length}`);

  if (!stepThrough) {
    const finalStep = result.steps[result.steps.length - 1];
    if (finalStep) {
      lines.push('');
      lines.push(formatReplayStep(finalStep));
    }
    return lines.join('\n');
  }

  for (const step of result.steps) {
    lines.push('');
    lines.push(formatReplayStep(step));
  }
  return lines.join('\n');
}

export async function runReplayCommand(
  conversationId: string,
  logger: ShortcutLogger,
  options: {
    json?: boolean;
    stepThrough?: boolean;
    limit?: string;
    agentId?: string;
    mockFile?: string;
    contextFile?: string;
    allowWrites?: boolean;
  } = {},
): Promise<void> {
  if (!conversationId) {
    logger.warning(
      'Usage: replay <conversation-id> [--step-through] [--limit <n>] [--agent <id>] [--mock <file>] [--context-file <file>]',
    );
    return;
  }

  const messageLimit = toPositiveInteger(options.limit, 200, 2000);
  const conversation = await withAgentRunner(async (runner) => {
    const result = await runner.callTool('get_channel_with_messages', {
      uuid: conversationId,
      message_limit: messageLimit,
    });
    return asStringRecord(result.payload);
  });

  const messages = asRecordArray(conversation.messages);
  const steps = buildReplaySteps(messages);
  if (steps.length === 0) {
    logger.warning(`No customer turns found for conversation "${conversationId}".`);
    return;
  }

  const replaySteps: ReplayResult['steps'] = [];
  const conversationAgentId =
    typeof conversation.agent_id === 'string' && conversation.agent_id.trim()
      ? conversation.agent_id
      : typeof asStringRecord(conversation.agent).id === 'string' &&
          String(asStringRecord(conversation.agent).id).trim()
        ? String(asStringRecord(conversation.agent).id)
        : undefined;
  for (const step of steps) {
    const session = new TracedAgentSession({
      agentId: options.agentId || conversationAgentId,
      mockFile: options.mockFile,
      contextFile: options.contextFile,
      allowWrites: options.allowWrites,
      seedMessages: step.seedMessages,
    });
    try {
      const replay = await session.run(step.customerMessage);
      replaySteps.push({
        index: step.index,
        customerMessage: step.customerMessage,
        expectedResponse: step.expectedResponse,
        replay,
      });
    } finally {
      await session.disconnect();
    }
  }

  const result: ReplayResult = {
    conversationId,
    agentId: conversationAgentId,
    status: typeof conversation.status === 'string' ? conversation.status : undefined,
    createdAt: typeof conversation.created_at === 'string' ? conversation.created_at : undefined,
    steps: replaySteps,
  };

  if (options.json) {
    logger.output(JSON.stringify(result, null, 2));
    return;
  }
  logger.output(formatToolResult(formatReplayResult(result, options.stepThrough === true)));
}

export async function runTopLevelReplay(
  conversationId: string,
  options: {
    json?: boolean;
    stepThrough?: boolean;
    limit?: string;
    agentId?: string;
    mock?: string;
    contextFile?: string;
    allowWrites?: boolean;
  } = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await runReplayCommand(conversationId, logger, {
    json: options.json,
    stepThrough: options.stepThrough,
    limit: options.limit,
    agentId: options.agentId,
    mockFile: options.mock,
    contextFile: options.contextFile,
    allowWrites: options.allowWrites,
  });
}
