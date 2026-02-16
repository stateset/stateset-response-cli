/**
 * Tests for StateSetAgent — the core agent class in src/agent.ts
 *
 * Covers: constructor/accessors, session store integration, abort,
 * connect/disconnect, and the agentic chat loop (streaming, tool calls,
 * callbacks, extractText logging).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks – declared before the import so vi.mock hoisting works correctly
// ---------------------------------------------------------------------------

// Track the mock instances so tests can inspect / configure them
let mockAnthropicInstance: {
  messages: { stream: ReturnType<typeof vi.fn> };
};

let mockMcpClientInstance: {
  connect: ReturnType<typeof vi.fn>;
  listTools: ReturnType<typeof vi.fn>;
  callTool: ReturnType<typeof vi.fn>;
};

let mockTransportOptions: {
  command: string;
  args: string[];
  stderr: 'inherit';
  cwd: string;
  env: Record<string, string>;
} | null = null;

let mockTransportInstance: {
  close: ReturnType<typeof vi.fn>;
};
let mockTransportInstances: Array<{ close: ReturnType<typeof vi.fn> }> = [];

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => {
    mockAnthropicInstance = {
      messages: {
        stream: vi.fn(),
      },
    };
    return mockAnthropicInstance;
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => {
    mockMcpClientInstance = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'tool-result' }],
      }),
    };
    return mockMcpClientInstance;
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation((options: any) => {
    mockTransportOptions = options;
    mockTransportInstance = {
      close: vi.fn().mockResolvedValue(undefined),
    };
    mockTransportInstances.push(mockTransportInstance);
    return mockTransportInstance;
  }),
}));

vi.mock('../integrations/registry.js', () => ({
  INTEGRATION_DEFINITIONS: [],
}));

// ---------------------------------------------------------------------------
// Helper: build a mock Anthropic stream
// ---------------------------------------------------------------------------

function createMockStream(
  text: string,
  stopReason: string = 'end_turn',
  opts?: {
    usage?: { input_tokens: number; output_tokens: number };
    contentBlocks?: unknown[];
  },
) {
  const textHandler: Array<(delta: string) => void> = [];

  const chainable = {
    on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'text') {
        textHandler.push(handler as (d: string) => void);
      }
      return chainable;
    }),
    finalMessage: vi.fn().mockImplementation(async () => {
      // Fire accumulated text handlers before resolving
      for (const h of textHandler) {
        h(text);
      }
      return {
        content: opts?.contentBlocks ?? [{ type: 'text', text }],
        stop_reason: stopReason,
        usage: opts?.usage ?? { input_tokens: 10, output_tokens: 5 },
      };
    }),
  };
  return chainable;
}

// ---------------------------------------------------------------------------
// Import the module under test (after mocks are declared)
// ---------------------------------------------------------------------------

import { StateSetAgent, BASE_SYSTEM_PROMPT } from '../agent.js';
import { DEFAULT_MODEL } from '../config.js';

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('StateSetAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransportOptions = null;
    mockTransportInstances = [];
    mockTransportInstance = null as unknown as { close: ReturnType<typeof vi.fn> };
  });

  // =========================================================================
  // Constructor & accessors
  // =========================================================================

  describe('constructor & accessors', () => {
    it('sets model to DEFAULT_MODEL when no model argument is provided', () => {
      const agent = new StateSetAgent('test-key');
      expect(agent.getModel()).toBe(DEFAULT_MODEL);
    });

    it('accepts a custom model via the constructor', () => {
      const agent = new StateSetAgent('test-key', 'claude-haiku-35-20241022');
      expect(agent.getModel()).toBe('claude-haiku-35-20241022');
    });

    it('setModel updates the model returned by getModel', () => {
      const agent = new StateSetAgent('test-key');
      agent.setModel('claude-opus-4-20250514');
      expect(agent.getModel()).toBe('claude-opus-4-20250514');
    });

    it('setSystemPrompt stores the prompt (observable via chat)', () => {
      // We verify indirectly: the system prompt is passed to the stream call
      const agent = new StateSetAgent('test-key');
      agent.setSystemPrompt('Custom prompt');

      const stream = createMockStream('ok');
      mockAnthropicInstance.messages.stream.mockReturnValue(stream);

      // Trigger chat to observe the system prompt in the call
      agent.chat('hi').then(() => {
        const callArgs = mockAnthropicInstance.messages.stream.mock.calls[0][0];
        expect(callArgs.system).toBe('Custom prompt');
      });
    });

    it('getHistoryLength returns 0 for a fresh agent', () => {
      const agent = new StateSetAgent('test-key');
      expect(agent.getHistoryLength()).toBe(0);
    });
  });

  // =========================================================================
  // useSessionStore
  // =========================================================================

  describe('useSessionStore', () => {
    function createMockSessionStore(messages: unknown[] = []) {
      return {
        loadMessages: vi.fn().mockReturnValue(messages),
        appendMessage: vi.fn(),
        appendLog: vi.fn(),
        getSessionId: vi.fn().mockReturnValue('test-session'),
      } as unknown as import('../session.js').SessionStore;
    }

    it('loads messages from the store into history', () => {
      const agent = new StateSetAgent('test-key');
      const msgs = Array.from({ length: 5 }, (_, i) => ({
        role: 'user' as const,
        content: `message-${i}`,
      }));
      const store = createMockSessionStore(msgs);

      agent.useSessionStore(store);

      expect(store.loadMessages).toHaveBeenCalled();
      expect(agent.getHistoryLength()).toBe(5);
    });

    it('trims loaded messages to MAX_HISTORY_MESSAGES (40)', () => {
      const agent = new StateSetAgent('test-key');
      const msgs = Array.from({ length: 50 }, (_, i) => ({
        role: 'user' as const,
        content: `message-${i}`,
      }));
      const store = createMockSessionStore(msgs);

      agent.useSessionStore(store);

      expect(agent.getHistoryLength()).toBe(40);
    });

    it('clearHistory resets history length to 0 after loading', () => {
      const agent = new StateSetAgent('test-key');
      const msgs = Array.from({ length: 5 }, (_, i) => ({
        role: 'user' as const,
        content: `message-${i}`,
      }));
      const store = createMockSessionStore(msgs);
      agent.useSessionStore(store);
      expect(agent.getHistoryLength()).toBe(5);

      agent.clearHistory();
      expect(agent.getHistoryLength()).toBe(0);
    });
  });

  // =========================================================================
  // abort
  // =========================================================================

  describe('abort', () => {
    it('does not throw when no request is active', () => {
      const agent = new StateSetAgent('test-key');
      expect(() => agent.abort()).not.toThrow();
    });

    it('cancels an active request causing chat to throw', async () => {
      const agent = new StateSetAgent('test-key');

      // Create a stream whose finalMessage rejects with an AbortError
      // synchronously upon being called (simulating the SDK aborting).
      const abortError = new Error('Request cancelled');
      abortError.name = 'AbortError';

      let rejectFn: (err: Error) => void;
      const stream = {
        on: vi.fn().mockReturnThis(),
        finalMessage: vi.fn().mockImplementation(() => {
          return new Promise<never>((_resolve, reject) => {
            rejectFn = reject;
          });
        }),
      };
      mockAnthropicInstance.messages.stream.mockReturnValue(stream);

      const chatPromise = agent.chat('hello');

      // Wait a tick so the stream is set up, then reject as the abort would
      await vi.waitFor(() => {
        expect(stream.finalMessage).toHaveBeenCalled();
      });
      rejectFn!(abortError);

      await expect(chatPromise).rejects.toThrow('Request cancelled');
    });
  });

  // =========================================================================
  // connect / disconnect
  // =========================================================================

  describe('connect & disconnect', () => {
    it('initializes MCP client and loads tools', async () => {
      const agent = new StateSetAgent('test-key');
      mockMcpClientInstance.listTools.mockResolvedValue({
        tools: [
          {
            name: 'list_agents',
            description: 'List agents',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      });

      await agent.connect();

      expect(mockMcpClientInstance.connect).toHaveBeenCalledTimes(1);
      expect(mockMcpClientInstance.listTools).toHaveBeenCalledTimes(1);
    });

    it('disconnect closes the transport', async () => {
      const agent = new StateSetAgent('test-key');
      await agent.connect();
      await agent.disconnect();

      expect(mockTransportInstance.close).toHaveBeenCalledTimes(1);
    });

    it('passes MCP env vars needed for knowledge base tools', async () => {
      const previousKbHost = process.env.STATESET_KB_HOST;
      const previousOpenAI = process.env.OPENAI_API_KEY;
      const previousOpenAIAlt = process.env.OPEN_AI;

      process.env.STATESET_KB_HOST = '  http://qdrant.internal  ';
      process.env.OPENAI_API_KEY = '  test-openai-key  ';
      process.env.OPEN_AI = '  alt-openai-key  ';

      const agent = new StateSetAgent('test-key');
      await agent.connect();

      try {
        expect(mockTransportOptions).not.toBeNull();
        expect(mockTransportOptions?.env).toEqual(
          expect.objectContaining({
            STATESET_KB_HOST: 'http://qdrant.internal',
            OPENAI_API_KEY: 'test-openai-key',
            OPEN_AI: 'alt-openai-key',
          }),
        );
      } finally {
        process.env.STATESET_KB_HOST = previousKbHost;
        process.env.OPENAI_API_KEY = previousOpenAI;
        process.env.OPEN_AI = previousOpenAIAlt;
      }
    });

    it('clears transport if connect fails after spawning', async () => {
      mockMcpClientInstance.connect.mockRejectedValueOnce(new Error('spawn failed'));
      const agent = new StateSetAgent('test-key');

      await expect(agent.connect()).rejects.toThrow('spawn failed');

      expect(mockTransportInstances).toHaveLength(1);
      expect(mockTransportInstances[0].close).toHaveBeenCalledTimes(1);
    });

    it('clears transport if tool discovery fails during connect', async () => {
      mockMcpClientInstance.listTools.mockRejectedValueOnce(new Error('tools failed'));
      const agent = new StateSetAgent('test-key');

      await expect(agent.connect()).rejects.toThrow('tools failed');

      expect(mockTransportInstances).toHaveLength(1);
      expect(mockTransportInstances[0].close).toHaveBeenCalledTimes(1);
    });

    it('disconnect is safe to call when never connected', async () => {
      const agent = new StateSetAgent('test-key');
      // transport is null – should not throw
      await expect(agent.disconnect()).resolves.toBeUndefined();
    });

    it('disconnect can be called multiple times without throwing', async () => {
      const agent = new StateSetAgent('test-key');
      await agent.connect();
      await agent.disconnect();
      await expect(agent.disconnect()).resolves.toBeUndefined();
    });

    it('suppresses transport close errors during disconnect', async () => {
      const agent = new StateSetAgent('test-key');
      await agent.connect();
      mockTransportInstance.close.mockRejectedValueOnce(new Error('close failed'));

      await expect(agent.disconnect()).resolves.toBeUndefined();
      expect((agent as unknown as { tools: unknown[] }).tools).toHaveLength(0);
    });

    it('clears cached tools when disconnecting', async () => {
      mockMcpClientInstance.listTools.mockResolvedValueOnce({
        tools: [
          {
            name: 'list_agents',
            description: 'List agents',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      });

      const agent = new StateSetAgent('test-key');
      await agent.connect();

      expect((agent as unknown as { tools: unknown[] }).tools).toHaveLength(1);

      await agent.disconnect();
      expect((agent as unknown as { tools: unknown[] }).tools).toHaveLength(0);
    });

    it('reconnect closes an existing transport before creating a new one', async () => {
      const agent = new StateSetAgent('test-key');
      await agent.connect();
      const firstTransport = mockTransportInstances[0];
      await agent.connect();

      expect(firstTransport?.close).toHaveBeenCalledTimes(1);
      expect(mockTransportInstances).toHaveLength(2);
    });

    it('clears cached tools when a reconnect attempt fails', async () => {
      mockMcpClientInstance.listTools
        .mockResolvedValueOnce({
          tools: [
            {
              name: 'list_agents',
              description: 'List agents',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        })
        .mockRejectedValueOnce(new Error('tools failed'));

      const agent = new StateSetAgent('test-key');

      await agent.connect();
      expect((agent as unknown as { tools: unknown[] }).tools).toHaveLength(1);

      await expect(agent.connect()).rejects.toThrow('tools failed');
      expect((agent as unknown as { tools: unknown[] }).tools).toHaveLength(0);
      expect(mockTransportInstances).toHaveLength(2);
    });
  });

  // =========================================================================
  // chat — basic flow
  // =========================================================================

  describe('chat — basic flow', () => {
    it('adds user message to history', async () => {
      const agent = new StateSetAgent('test-key');
      const stream = createMockStream('Hello!');
      mockAnthropicInstance.messages.stream.mockReturnValue(stream);

      await agent.chat('Hi there');

      // user message + assistant message = 2
      expect(agent.getHistoryLength()).toBe(2);
    });

    it('returns text assembled from the stream', async () => {
      const agent = new StateSetAgent('test-key');
      const stream = createMockStream('Hello world');
      mockAnthropicInstance.messages.stream.mockReturnValue(stream);

      const result = await agent.chat('Say hello');

      expect(result).toBe('Hello world');
    });

    it('calls onText callback with delta text', async () => {
      const agent = new StateSetAgent('test-key');
      const stream = createMockStream('chunk');
      mockAnthropicInstance.messages.stream.mockReturnValue(stream);

      const onText = vi.fn();
      await agent.chat('test', { onText });

      expect(onText).toHaveBeenCalledWith('chunk');
    });

    it('calls onUsage callback with token usage data', async () => {
      const agent = new StateSetAgent('test-key');
      const usage = { input_tokens: 42, output_tokens: 17 };
      const stream = createMockStream('response', 'end_turn', { usage });
      mockAnthropicInstance.messages.stream.mockReturnValue(stream);

      const onUsage = vi.fn();
      await agent.chat('test', { onUsage });

      expect(onUsage).toHaveBeenCalledTimes(1);
      expect(onUsage).toHaveBeenCalledWith(usage);
    });

    it('passes the correct model and system prompt to Anthropic', async () => {
      const agent = new StateSetAgent('test-key', 'claude-opus-4-20250514');
      agent.setSystemPrompt('You are a test bot');

      const stream = createMockStream('ok');
      mockAnthropicInstance.messages.stream.mockReturnValue(stream);

      await agent.chat('ping');

      const callArgs = mockAnthropicInstance.messages.stream.mock.calls[0][0];
      expect(callArgs.model).toBe('claude-opus-4-20250514');
      expect(callArgs.system).toBe('You are a test bot');
      expect(callArgs.max_tokens).toBe(4096);
    });
  });

  // =========================================================================
  // chat — tool use loop
  // =========================================================================

  describe('chat — tool use loop', () => {
    it('executes tool calls and feeds results back until end_turn', async () => {
      const agent = new StateSetAgent('test-key');

      // First call: model returns a tool_use
      const toolUseStream = {
        on: vi.fn().mockReturnThis(),
        finalMessage: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'tool_use',
              id: 'call_1',
              name: 'list_agents',
              input: { limit: 5 },
            },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      };

      // Second call: model returns text (end_turn)
      const endStream = createMockStream('Found 3 agents');

      mockAnthropicInstance.messages.stream
        .mockReturnValueOnce(toolUseStream)
        .mockReturnValueOnce(endStream);

      await agent.connect();
      const result = await agent.chat('List agents');

      expect(result).toBe('Found 3 agents');
      expect(mockMcpClientInstance.callTool).toHaveBeenCalledWith({
        name: 'list_agents',
        arguments: { limit: 5 },
      });
      // user msg + assistant (tool_use) + user (tool_result) + assistant (text) = 4
      expect(agent.getHistoryLength()).toBe(4);
    });

    it('calls onToolCall and onToolCallEnd callbacks', async () => {
      const agent = new StateSetAgent('test-key');

      const toolUseStream = {
        on: vi.fn().mockReturnThis(),
        finalMessage: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'tool_use',
              id: 'call_1',
              name: 'get_agent',
              input: { id: 'abc' },
            },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      };

      const endStream = createMockStream('Done');
      mockAnthropicInstance.messages.stream
        .mockReturnValueOnce(toolUseStream)
        .mockReturnValueOnce(endStream);

      await agent.connect();

      const onToolCall = vi.fn();
      const onToolCallEnd = vi.fn();
      await agent.chat('Get agent abc', { onToolCall, onToolCallEnd });

      expect(onToolCall).toHaveBeenCalledWith('get_agent', { id: 'abc' });
      expect(onToolCallEnd).toHaveBeenCalledTimes(1);
      expect(onToolCallEnd.mock.calls[0][0]).toMatchObject({
        name: 'get_agent',
        args: { id: 'abc' },
        resultText: 'tool-result',
        isError: false,
      });
      expect(onToolCallEnd.mock.calls[0][0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it('onToolCallStart with deny blocks the tool call', async () => {
      const agent = new StateSetAgent('test-key');

      const toolUseStream = {
        on: vi.fn().mockReturnThis(),
        finalMessage: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'tool_use',
              id: 'call_deny',
              name: 'delete_agent',
              input: { id: 'x' },
            },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      };

      const endStream = createMockStream('Okay, I will not delete.');
      mockAnthropicInstance.messages.stream
        .mockReturnValueOnce(toolUseStream)
        .mockReturnValueOnce(endStream);

      await agent.connect();

      const onToolCallStart = vi.fn().mockReturnValue({
        action: 'deny',
        reason: 'Not allowed in read-only mode',
      });
      const onToolCallEnd = vi.fn();
      await agent.chat('Delete agent x', { onToolCallStart, onToolCallEnd });

      // callTool should NOT have been invoked
      expect(mockMcpClientInstance.callTool).not.toHaveBeenCalled();
      // onToolCallEnd should report the denial
      expect(onToolCallEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'delete_agent',
          resultText: 'Error: Not allowed in read-only mode',
          isError: true,
          durationMs: 0,
        }),
      );
    });

    it('onToolCallStart with respond short-circuits with canned content', async () => {
      const agent = new StateSetAgent('test-key');

      const toolUseStream = {
        on: vi.fn().mockReturnThis(),
        finalMessage: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'tool_use',
              id: 'call_respond',
              name: 'list_agents',
              input: {},
            },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      };

      const endStream = createMockStream('Here are the cached agents');
      mockAnthropicInstance.messages.stream
        .mockReturnValueOnce(toolUseStream)
        .mockReturnValueOnce(endStream);

      await agent.connect();

      const onToolCallStart = vi.fn().mockReturnValue({
        action: 'respond',
        content: 'cached: [agent-1, agent-2]',
      });
      const onToolCallEnd = vi.fn();

      await agent.chat('List agents', { onToolCallStart, onToolCallEnd });

      expect(mockMcpClientInstance.callTool).not.toHaveBeenCalled();
      expect(onToolCallEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          resultText: 'cached: [agent-1, agent-2]',
          isError: false,
          durationMs: 0,
        }),
      );
    });

    it('onToolCallStart with allow and modified args forwards updated args', async () => {
      const agent = new StateSetAgent('test-key');

      const toolUseStream = {
        on: vi.fn().mockReturnThis(),
        finalMessage: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'tool_use',
              id: 'call_allow',
              name: 'list_agents',
              input: { limit: 100 },
            },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      };

      const endStream = createMockStream('Here are the agents');
      mockAnthropicInstance.messages.stream
        .mockReturnValueOnce(toolUseStream)
        .mockReturnValueOnce(endStream);

      await agent.connect();

      const onToolCallStart = vi.fn().mockReturnValue({
        action: 'allow',
        args: { limit: 10 }, // override limit
      });

      await agent.chat('List agents', { onToolCallStart });

      expect(mockMcpClientInstance.callTool).toHaveBeenCalledWith({
        name: 'list_agents',
        arguments: { limit: 10 },
      });
    });

    it('handles tool call errors gracefully', async () => {
      const agent = new StateSetAgent('test-key');

      const toolUseStream = {
        on: vi.fn().mockReturnThis(),
        finalMessage: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'tool_use',
              id: 'call_err',
              name: 'get_agent',
              input: { id: 'missing' },
            },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      };

      mockMcpClientInstance.callTool.mockRejectedValueOnce(new Error('Agent not found'));

      const endStream = createMockStream('Sorry, I could not find that agent.');
      mockAnthropicInstance.messages.stream
        .mockReturnValueOnce(toolUseStream)
        .mockReturnValueOnce(endStream);

      await agent.connect();

      const onToolCallEnd = vi.fn();
      const result = await agent.chat('Get agent missing', { onToolCallEnd });

      expect(result).toBe('Sorry, I could not find that agent.');
      expect(onToolCallEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'get_agent',
          resultText: 'Error: Agent not found',
          isError: true,
        }),
      );
    });
  });

  // =========================================================================
  // Session store integration (extractText via addMessage)
  // =========================================================================

  describe('session store logging', () => {
    function createMockSessionStore() {
      return {
        loadMessages: vi.fn().mockReturnValue([]),
        appendMessage: vi.fn(),
        appendLog: vi.fn(),
        getSessionId: vi.fn().mockReturnValue('test-session'),
      } as unknown as import('../session.js').SessionStore;
    }

    it('logs text user messages to session store via appendLog', async () => {
      const agent = new StateSetAgent('test-key');
      const store = createMockSessionStore();
      agent.useSessionStore(store);

      const stream = createMockStream('Response text');
      mockAnthropicInstance.messages.stream.mockReturnValue(stream);

      await agent.chat('Hello agent');

      // appendMessage should be called for both user and assistant messages
      expect(store.appendMessage).toHaveBeenCalledTimes(2);

      // appendLog should be called for both user (string content) and assistant (text block)
      expect(store.appendLog).toHaveBeenCalledTimes(2);

      // First appendLog call = user message
      const userLog = (store.appendLog as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(userLog.role).toBe('user');
      expect(userLog.text).toBe('Hello agent');

      // Second appendLog call = assistant message
      const assistantLog = (store.appendLog as ReturnType<typeof vi.fn>).mock.calls[1][0];
      expect(assistantLog.role).toBe('assistant');
      expect(assistantLog.text).toBe('Response text');
    });

    it('does not call appendLog for tool_result messages', async () => {
      const agent = new StateSetAgent('test-key');
      const store = createMockSessionStore();
      agent.useSessionStore(store);

      // First call returns a tool_use, second returns end_turn text
      const toolUseStream = {
        on: vi.fn().mockReturnThis(),
        finalMessage: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'tool_use',
              id: 'call_1',
              name: 'list_agents',
              input: {},
            },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      };

      const endStream = createMockStream('Here are the agents');
      mockAnthropicInstance.messages.stream
        .mockReturnValueOnce(toolUseStream)
        .mockReturnValueOnce(endStream);

      await agent.connect();
      await agent.chat('List agents');

      // Messages added: user, assistant(tool_use), user(tool_result), assistant(text)
      // appendMessage called for all 4
      expect(store.appendMessage).toHaveBeenCalledTimes(4);

      // appendLog should be called for:
      // 1. user "List agents" (text)
      // 2. assistant tool_use block (extractText returns null for tool_use only blocks? Let's check)
      // 3. user tool_result (extractText returns null)
      // 4. assistant "Here are the agents" (text)
      //
      // The tool_use content is [{type:'tool_use',...}] — extractText filters for
      // type==='text' blocks, finds none, returns null. So no log for #2.
      // The tool_result content is [{type:'tool_result',...}] — extractText returns null. No log for #3.
      //
      // So appendLog should be called exactly 2 times: user text + assistant text

      const logCalls = (store.appendLog as ReturnType<typeof vi.fn>).mock.calls;
      expect(logCalls.length).toBe(2);
      expect(logCalls[0][0].role).toBe('user');
      expect(logCalls[0][0].text).toBe('List agents');
      expect(logCalls[1][0].role).toBe('assistant');
      expect(logCalls[1][0].text).toBe('Here are the agents');
    });

    it('appendMessage is called with role and content for each message', async () => {
      const agent = new StateSetAgent('test-key');
      const store = createMockSessionStore();
      agent.useSessionStore(store);

      const stream = createMockStream('Hi');
      mockAnthropicInstance.messages.stream.mockReturnValue(stream);

      await agent.chat('Greetings');

      // Verify exact structure of the appended messages
      const calls = (store.appendMessage as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][0]).toEqual({ role: 'user', content: 'Greetings' });
      expect(calls[1][0]).toEqual({
        role: 'assistant',
        content: [{ type: 'text', text: 'Hi' }],
      });
    });
  });

  // =========================================================================
  // History trimming
  // =========================================================================

  describe('history trimming', () => {
    it('trims conversation history to MAX_HISTORY_MESSAGES (40) during chat', async () => {
      const agent = new StateSetAgent('test-key');

      const stream = createMockStream('ok');
      mockAnthropicInstance.messages.stream.mockReturnValue(stream);

      // Each chat call adds 2 messages (user + assistant).
      // 25 calls = 50 messages, but should be trimmed to 40.
      for (let i = 0; i < 25; i++) {
        await agent.chat(`message-${i}`);
      }

      expect(agent.getHistoryLength()).toBe(40);
    });
  });

  // =========================================================================
  // BASE_SYSTEM_PROMPT export
  // =========================================================================

  describe('BASE_SYSTEM_PROMPT', () => {
    it('is a non-empty string export', () => {
      expect(typeof BASE_SYSTEM_PROMPT).toBe('string');
      expect(BASE_SYSTEM_PROMPT.length).toBeGreaterThan(100);
    });

    it('mentions StateSet Response platform', () => {
      expect(BASE_SYSTEM_PROMPT).toContain('StateSet Response');
    });

    it('is the default system prompt for new agents', async () => {
      const agent = new StateSetAgent('test-key');
      const stream = createMockStream('ok');
      mockAnthropicInstance.messages.stream.mockReturnValue(stream);

      await agent.chat('hi');

      const callArgs = mockAnthropicInstance.messages.stream.mock.calls[0][0];
      expect(callArgs.system).toBe(BASE_SYSTEM_PROMPT);
    });
  });
});
