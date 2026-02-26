import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShortcutLogger } from '../cli/shortcuts/types.js';

const {
  state,
  mockGetRuntimeContext,
  MockStateSetAgent,
  mockBuildTopLevelLogger,
  mockFormatToolResult,
  instances,
} = vi.hoisted(() => {
  const state = {
    chatResult: 'agent-response',
    chatError: null as Error | null,
  };
  const instances: Array<{
    connect: ReturnType<typeof vi.fn>;
    chat: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  const mockGetRuntimeContext = vi.fn();
  const mockBuildTopLevelLogger = vi.fn();
  const mockFormatToolResult = vi.fn((text: string) => `formatted:${text}`);
  const MockStateSetAgent = vi.fn(function MockStateSetAgent(this: Record<string, unknown>) {
    this.connect = vi.fn(async () => undefined);
    this.chat = vi.fn(async () => {
      if (state.chatError) throw state.chatError;
      return state.chatResult;
    });
    this.disconnect = vi.fn(async () => undefined);
    instances.push({
      connect: this.connect as ReturnType<typeof vi.fn>,
      chat: this.chat as ReturnType<typeof vi.fn>,
      disconnect: this.disconnect as ReturnType<typeof vi.fn>,
    });
  });

  return {
    state,
    mockGetRuntimeContext,
    MockStateSetAgent,
    mockBuildTopLevelLogger,
    mockFormatToolResult,
    instances,
  };
});

vi.mock('../config.js', () => ({
  getRuntimeContext: mockGetRuntimeContext,
}));

vi.mock('../agent.js', () => ({
  StateSetAgent: MockStateSetAgent,
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
    instances.length = 0;
    state.chatResult = 'agent-response';
    state.chatError = null;
    mockGetRuntimeContext.mockReturnValue({ anthropicApiKey: 'test-api-key' });
    mockBuildTopLevelLogger.mockReturnValue(createLogger());
    delete process.env.STATESET_ACTIVE_AGENT_ID;
  });

  it('shows usage when no input is provided', async () => {
    const logger = createLogger();

    await runTestCommand([], logger, false);

    expect(logger.warning).toHaveBeenCalledWith('Usage: /test "<message>" [--agent <id>]');
    expect(MockStateSetAgent).not.toHaveBeenCalled();
  });

  it('runs a chat call and restores a previous active agent id', async () => {
    const logger = createLogger();
    process.env.STATESET_ACTIVE_AGENT_ID = 'existing-agent';

    await runTestCommand(['"hello world"'], logger, false, 'temp-agent');

    expect(mockGetRuntimeContext).toHaveBeenCalledTimes(1);
    expect(MockStateSetAgent).toHaveBeenCalledWith('test-api-key');
    expect(instances[0].connect).toHaveBeenCalledTimes(1);
    expect(instances[0].chat).toHaveBeenCalledWith('hello world');
    expect(mockFormatToolResult).toHaveBeenCalledWith('agent-response');
    expect(logger.output).toHaveBeenCalledWith('formatted:agent-response');
    expect(instances[0].disconnect).toHaveBeenCalledTimes(1);
    expect(process.env.STATESET_ACTIVE_AGENT_ID).toBe('existing-agent');
  });

  it('removes temporary active agent id when there was no previous value', async () => {
    const logger = createLogger();

    await runTestCommand(['hello'], logger, false, 'temp-agent');

    expect(process.env.STATESET_ACTIVE_AGENT_ID).toBeUndefined();
  });

  it('prints raw JSON output in json mode', async () => {
    const logger = createLogger();

    await runTestCommand(['hello'], logger, true);

    expect(logger.output).toHaveBeenCalledWith(
      JSON.stringify({ response: 'agent-response' }, null, 2),
    );
    expect(mockFormatToolResult).not.toHaveBeenCalled();
  });

  it('always disconnects and restores env when chat fails', async () => {
    const logger = createLogger();
    state.chatError = new Error('network down');

    await expect(runTestCommand(['hello'], logger, false, 'temp-agent')).rejects.toThrow(
      'network down',
    );

    expect(instances[0].disconnect).toHaveBeenCalledTimes(1);
    expect(process.env.STATESET_ACTIVE_AGENT_ID).toBeUndefined();
  });

  it('runTopLevelTest uses top-level logger and delegates to runTestCommand', async () => {
    const topLevelLogger = createLogger();
    mockBuildTopLevelLogger.mockReturnValue(topLevelLogger);

    await runTopLevelTest([], {});

    expect(mockBuildTopLevelLogger).toHaveBeenCalledTimes(1);
    expect(topLevelLogger.warning).toHaveBeenCalledWith('Usage: /test "<message>" [--agent <id>]');
  });
});
