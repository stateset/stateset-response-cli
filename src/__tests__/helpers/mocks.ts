/**
 * Test mocks and utilities for StateSet Response CLI
 */
import { vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// GraphQL Client Mock
// ============================================================================

export interface MockGraphQLClient {
  request: ReturnType<typeof vi.fn>;
  _setResponse: (response: unknown) => void;
  _setError: (error: Error) => void;
}

export function createMockGraphQLClient(): MockGraphQLClient {
  let nextResponse: unknown = {};
  let nextError: Error | null = null;

  const client = {
    request: vi.fn().mockImplementation(async () => {
      if (nextError) {
        const error = nextError;
        nextError = null;
        throw error;
      }
      return nextResponse;
    }),
    _setResponse: (response: unknown) => {
      nextResponse = response;
      nextError = null;
    },
    _setError: (error: Error) => {
      nextError = error;
    },
  };

  return client;
}

// ============================================================================
// MCP Server Mock
// ============================================================================

interface ToolDefinition {
  name: string;
  description: string;
  schema: unknown;
  handler: (args: unknown) => Promise<unknown>;
}

export interface MockMcpServer {
  tool: ReturnType<typeof vi.fn>;
  _tools: Map<string, ToolDefinition>;
  _callTool: (name: string, args: unknown) => Promise<unknown>;
  _getTool: (name: string) => ToolDefinition | undefined;
  _listTools: () => string[];
}

export function createMockMcpServer(): MockMcpServer {
  const tools = new Map<string, ToolDefinition>();

  const server = {
    tool: vi.fn((name: string, description: string, schema: unknown, handler: (args: unknown) => Promise<unknown>) => {
      tools.set(name, { name, description, schema, handler });
    }),
    _tools: tools,
    _callTool: async (name: string, args: unknown) => {
      const tool = tools.get(name);
      if (!tool) {
        throw new Error(`Tool "${name}" not found. Available: ${[...tools.keys()].join(', ')}`);
      }
      return tool.handler(args);
    },
    _getTool: (name: string) => tools.get(name),
    _listTools: () => [...tools.keys()],
  };

  return server;
}

// ============================================================================
// Anthropic Client Mock
// ============================================================================

export interface MockAnthropicStream {
  on: ReturnType<typeof vi.fn>;
  finalMessage: ReturnType<typeof vi.fn>;
}

export interface MockAnthropicClient {
  messages: {
    stream: ReturnType<typeof vi.fn>;
  };
  _setStreamResponse: (response: unknown) => void;
  _setStreamError: (error: Error) => void;
  _simulateToolCall: (toolName: string, toolInput: unknown) => void;
}

export function createMockAnthropicClient(): MockAnthropicClient {
  let streamResponse: unknown = {
    content: [{ type: 'text', text: 'Mock response' }],
    stop_reason: 'end_turn',
  };
  let streamError: Error | null = null;
  let pendingToolCall: { name: string; input: unknown } | null = null;

  const createStream = (): MockAnthropicStream => ({
    on: vi.fn().mockReturnThis(),
    finalMessage: vi.fn().mockImplementation(async () => {
      if (streamError) {
        const error = streamError;
        streamError = null;
        throw error;
      }

      if (pendingToolCall) {
        const toolCall = pendingToolCall;
        pendingToolCall = null;
        return {
          content: [{
            type: 'tool_use',
            id: 'tool_call_123',
            name: toolCall.name,
            input: toolCall.input,
          }],
          stop_reason: 'tool_use',
        };
      }

      return streamResponse;
    }),
  });

  return {
    messages: {
      stream: vi.fn().mockImplementation(() => createStream()),
    },
    _setStreamResponse: (response: unknown) => {
      streamResponse = response;
      streamError = null;
      pendingToolCall = null;
    },
    _setStreamError: (error: Error) => {
      streamError = error;
    },
    _simulateToolCall: (name: string, input: unknown) => {
      pendingToolCall = { name, input };
    },
  };
}

// ============================================================================
// File System Mock Helpers
// ============================================================================

export function createMockFs() {
  const files = new Map<string, string>();

  return {
    readFileSync: vi.fn((path: string) => {
      const content = files.get(path);
      if (content === undefined) {
        const error = new Error(`ENOENT: no such file or directory, open '${path}'`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      return content;
    }),
    writeFileSync: vi.fn((path: string, content: string) => {
      files.set(path, content);
    }),
    existsSync: vi.fn((path: string) => files.has(path)),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn(),
    _setFile: (path: string, content: string) => {
      files.set(path, content);
    },
    _getFile: (path: string) => files.get(path),
    _clear: () => files.clear(),
  };
}

// ============================================================================
// Environment Mock Helpers
// ============================================================================

export function mockEnv(overrides: Record<string, string | undefined> = {}) {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, ...overrides };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  return {
    set: (key: string, value: string | undefined) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    },
  };
}

// ============================================================================
// GraphQL Error Helpers
// ============================================================================

export function createGraphQLError(message: string, code?: string) {
  const error = new Error(message) as Error & { response?: { errors?: Array<{ message: string }> } };
  error.response = {
    errors: [{ message }],
  };
  return error;
}

export function createNetworkError(code: string) {
  const error = new Error(`Network error: ${code}`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

export function createHttpError(status: number) {
  const error = new Error(`HTTP ${status}`) as Error & { response?: { status: number } };
  error.response = { status };
  return error;
}
