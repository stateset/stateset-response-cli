import type { ShortcutLogger, TopLevelOptions } from './types.js';
import { stripQuotes, buildTopLevelLogger, formatToolResult } from './utils.js';
import { runTracedAgentChat, type AgentTraceResult } from './agent-runtime.js';

function summarizeAssistantTurns(trace: AgentTraceResult): string[] {
  return trace.assistantTurns
    .map((turn) => turn.text.trim())
    .filter((turn) => turn.length > 0)
    .slice(0, 5);
}

function formatTraceOutput(trace: AgentTraceResult): string {
  const lines: string[] = [];
  lines.push(`Mode: ${trace.sandboxed ? 'sandboxed' : 'live'}`);
  if (trace.mockSource) {
    lines.push(`Mock data: ${trace.mockSource}`);
  }
  if (trace.contextSource) {
    lines.push(`Context override: ${trace.contextSource}`);
  }

  const reasoning = summarizeAssistantTurns(trace);
  lines.push('');
  lines.push('Decision Trace');
  if (trace.toolCalls.length === 0) {
    lines.push('  No tool calls.');
  } else {
    for (const call of trace.toolCalls) {
      lines.push(`  ${call.step}. ${call.name} [${call.decision}] ${JSON.stringify(call.args)}`);
      if (call.reason) {
        lines.push(`     reason: ${call.reason}`);
      }
      if (call.resultText !== undefined) {
        const result = call.resultText.replace(/\s+/g, ' ').trim();
        lines.push(`     result: ${result.slice(0, 220)}${result.length > 220 ? '...' : ''}`);
      }
      if (call.durationMs !== undefined) {
        lines.push(`     duration: ${call.durationMs}ms`);
      }
    }
  }

  lines.push('');
  lines.push('Reasoning');
  if (reasoning.length === 0) {
    lines.push('  Provider reasoning is not exposed. Showing tool decisions instead.');
  } else {
    for (const entry of reasoning) {
      lines.push(`  ${entry}`);
    }
  }

  lines.push('');
  lines.push('Final Response');
  lines.push(trace.finalResponse || '(empty)');
  return lines.join('\n');
}

export async function runTestCommand(
  tokens: string[],
  logger: ShortcutLogger,
  json = false,
  options: {
    agentId?: string;
    mockFile?: string;
    contextFile?: string;
    allowWrites?: boolean;
  } = {},
): Promise<void> {
  const input = stripQuotes(tokens.join(' '));
  if (!input) {
    logger.warning(
      'Usage: /test "<message>" [--agent <id>] [--mock <file>] [--context-file <file>] [--allow-writes]',
    );
    return;
  }

  const trace = await runTracedAgentChat({
    input,
    agentId: options.agentId,
    mockFile: options.mockFile,
    contextFile: options.contextFile,
    allowWrites: options.allowWrites,
  });

  if (json) {
    logger.output(JSON.stringify(trace, null, 2));
    return;
  }

  logger.output(formatToolResult(formatTraceOutput(trace)));
}

export async function runTopLevelTest(
  args: string[] = [],
  options: TopLevelOptions & {
    mock?: string;
    contextFile?: string;
    allowWrites?: boolean;
  } = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await runTestCommand(args, logger, Boolean(options.json), {
    agentId: options.agent,
    mockFile: options.mock,
    contextFile: options.contextFile,
    allowWrites: options.allowWrites,
  });
}
