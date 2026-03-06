import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShortcutLogger } from '../cli/shortcuts/types.js';

const { mockRunTracedAgentChat, mockBuildTopLevelLogger, mockFormatToolResult } = vi.hoisted(
  () => ({
    mockRunTracedAgentChat: vi.fn(),
    mockBuildTopLevelLogger: vi.fn(),
    mockFormatToolResult: vi.fn((text: string) => `formatted:${text}`),
  }),
);

vi.mock('../cli/shortcuts/agent-runtime.js', () => ({
  runTracedAgentChat: mockRunTracedAgentChat,
}));

vi.mock('../cli/shortcuts/utils.js', async () => {
  const actual = await vi.importActual<typeof import('../cli/shortcuts/utils.js')>(
    '../cli/shortcuts/utils.js',
  );
  return {
    ...actual,
    buildTopLevelLogger: mockBuildTopLevelLogger,
    formatToolResult: mockFormatToolResult,
  };
});

import { runTestCommand, runTopLevelTest } from '../cli/shortcuts/test.js';

function createLogger(): ShortcutLogger {
  return {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    output: vi.fn(),
    done: vi.fn(),
  };
}

describe('shortcuts test command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildTopLevelLogger.mockReturnValue(createLogger());
    mockRunTracedAgentChat.mockResolvedValue({
      input: 'hello world',
      finalResponse: 'agent-response',
      toolCalls: [
        {
          step: 1,
          name: 'list_orders',
          args: { limit: 1 },
          decision: 'allow',
          resultText: '[]',
          isError: false,
          durationMs: 10,
        },
      ],
      assistantTurns: [],
      sandboxed: true,
    });
  });

  it('shows usage when no input is provided', async () => {
    const logger = createLogger();

    await runTestCommand([], logger, false);

    expect(logger.warning).toHaveBeenCalledWith(
      'Usage: /test "<message>" [--agent <id>] [--mock <file>] [--context-file <file>] [--allow-writes]',
    );
    expect(mockRunTracedAgentChat).not.toHaveBeenCalled();
  });

  it('runs traced chat with forwarded options', async () => {
    const logger = createLogger();

    await runTestCommand(['"hello world"'], logger, false, {
      agentId: 'agent-1',
      mockFile: 'fixtures/mock.json',
      contextFile: 'fixtures/context.md',
      allowWrites: true,
    });

    expect(mockRunTracedAgentChat).toHaveBeenCalledWith({
      input: 'hello world',
      agentId: 'agent-1',
      mockFile: 'fixtures/mock.json',
      contextFile: 'fixtures/context.md',
      allowWrites: true,
    });
    expect(mockFormatToolResult).toHaveBeenCalledWith(expect.stringContaining('Decision Trace'));
    expect(logger.output).toHaveBeenCalledWith(expect.stringContaining('formatted:'));
  });

  it('prints raw JSON output in json mode', async () => {
    const logger = createLogger();

    await runTestCommand(['hello'], logger, true);

    expect(logger.output).toHaveBeenCalledWith(
      JSON.stringify(
        {
          input: 'hello world',
          finalResponse: 'agent-response',
          toolCalls: [
            {
              step: 1,
              name: 'list_orders',
              args: { limit: 1 },
              decision: 'allow',
              resultText: '[]',
              isError: false,
              durationMs: 10,
            },
          ],
          assistantTurns: [],
          sandboxed: true,
        },
        null,
        2,
      ),
    );
    expect(mockFormatToolResult).not.toHaveBeenCalled();
  });

  it('runTopLevelTest uses top-level logger and delegates to runTestCommand', async () => {
    const topLevelLogger = createLogger();
    mockBuildTopLevelLogger.mockReturnValue(topLevelLogger);

    await runTopLevelTest([], {});

    expect(mockBuildTopLevelLogger).toHaveBeenCalledTimes(1);
    expect(topLevelLogger.warning).toHaveBeenCalledWith(
      'Usage: /test "<message>" [--agent <id>] [--mock <file>] [--context-file <file>] [--allow-writes]',
    );
  });
});
