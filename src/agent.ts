import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionStore } from './session.js';
import { type ModelId, DEFAULT_MODEL } from './config.js';
import { INTEGRATION_DEFINITIONS } from './integrations/registry.js';
import { isRetryable, getErrorMessage } from './lib/errors.js';
import { metrics } from './lib/metrics.js';

const THIS_FILE = fileURLToPath(import.meta.url);
const __dirname = path.dirname(THIS_FILE);
const IS_TS = THIS_FILE.endsWith('.ts');
const MAX_HISTORY_MESSAGES = 40;
const DEFAULT_MAX_TOKENS = 16384;
const MAX_TOOL_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;
const MAX_TOOL_CALL_ARG_BYTES = 1_048_576;
const MCP_CONNECT_TIMEOUT_MS = 30_000;
const MCP_DISCONNECT_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

const INTEGRATION_ENV_KEYS = new Set<string>([
  'STATESET_ALLOW_APPLY',
  'RESPONSE_ALLOW_APPLY',
  'ALLOW_APPLY',
  'STATESET_REDACT',
  'RESPONSE_REDACT',
  'REDACT_PII',
]);

for (const def of INTEGRATION_DEFINITIONS) {
  for (const field of def.fields) {
    for (const envVar of field.envVars) {
      INTEGRATION_ENV_KEYS.add(envVar);
    }
  }
}

const MCP_EXTRA_ENV_KEYS = new Set<string>(['STATESET_KB_HOST', 'OPENAI_API_KEY', 'OPEN_AI']);

interface ToolInputSchema {
  type?: string | string[];
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isExpectedType(value: unknown, expectedType: string): boolean {
  if (expectedType === 'integer') {
    return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
  }
  if (expectedType === 'number') {
    return typeof value === 'number' && Number.isFinite(value);
  }
  if (expectedType === 'boolean') {
    return typeof value === 'boolean';
  }
  if (expectedType === 'string') {
    return typeof value === 'string';
  }
  if (expectedType === 'array') {
    return Array.isArray(value);
  }
  if (expectedType === 'object') {
    return isPlainObject(value);
  }
  if (expectedType === 'null') {
    return value === null;
  }
  return typeof value === expectedType;
}

function buildMcpEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INTEGRATION_ENV_KEYS) {
    const value = process.env[key];
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) {
      env[key] = trimmed;
    }
  }
  for (const key of MCP_EXTRA_ENV_KEYS) {
    const value = process.env[key];
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) {
      env[key] = trimmed;
    }
  }
  return env;
}

function getContentBlocks(
  content: Anthropic.MessageParam['content'],
): Anthropic.ContentBlockParam[] | null {
  return Array.isArray(content) ? content : null;
}

function extractToolUseIds(message: Anthropic.MessageParam): string[] {
  const blocks = getContentBlocks(message.content);
  if (!blocks) return [];
  const ids: string[] = [];
  for (const block of blocks) {
    if (block.type === 'tool_use' && typeof block.id === 'string') {
      ids.push(block.id);
    }
  }
  return ids;
}

function extractToolResultIds(message: Anthropic.MessageParam): string[] {
  const blocks = getContentBlocks(message.content);
  if (!blocks) return [];
  const ids: string[] = [];
  for (const block of blocks) {
    if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      ids.push(block.tool_use_id);
    }
  }
  return ids;
}

function isToolResultOnlyMessage(message: Anthropic.MessageParam): boolean {
  const blocks = getContentBlocks(message.content);
  if (!blocks || blocks.length === 0) return false;
  return blocks.every((block) => block.type === 'tool_result');
}

export function normalizeToolHistory(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const normalized: Anthropic.MessageParam[] = [];
  const seenToolUseIds = new Set<string>();

  for (const message of messages) {
    if (message.role === 'assistant') {
      normalized.push(message);
      for (const id of extractToolUseIds(message)) {
        seenToolUseIds.add(id);
      }
      continue;
    }

    if (message.role === 'user' && isToolResultOnlyMessage(message)) {
      const toolResultIds = extractToolResultIds(message);
      if (toolResultIds.length === 0) {
        continue;
      }
      const missing = toolResultIds.some((id) => !seenToolUseIds.has(id));
      if (missing) {
        continue;
      }
      toolResultIds.forEach((id) => seenToolUseIds.delete(id));
      normalized.push(message);
      continue;
    }

    normalized.push(message);
  }

  return normalized;
}

/** Default system prompt injected when no override is provided via prompt files. */
export const BASE_SYSTEM_PROMPT = `You are an AI assistant for managing the StateSet Response platform.
You have tools to manage agents, rules, skills, attributes, examples, evals, datasets, functions,
responses, channels, messages, knowledge base (semantic search and vector storage), and agent/channel settings.

You also have optional commerce/support tools (if configured):
- Shopify: order listings, fulfillment hold previews/releases, order tagging, and partial refunds
- Gorgias: ticket search, review, macros, and bulk actions
- Recharge: customers, subscriptions, charges, orders, and raw API requests
- Klaviyo: profiles (including bulk import/merge), lists, segments, tags, campaigns, flows, templates, forms, images, catalogs, coupons, subscriptions, push tokens, reporting, data privacy, and events
- Loop Returns: returns lifecycle, exchanges, refunds, labels, and notes
- ShipStation: orders, labels, rates, shipments, and tagging
- ShipHero: warehouse orders, inventory, routing, and shipments
- ShipFusion: 3PL orders, inventory, shipments, returns, and ASNs
- ShipHawk: rates, bookings, shipments, pickups, and BOLs
- Zendesk: ticket search, updates, macros, merges, and batch operations
- Advanced: raw Shopify GraphQL/REST and raw Gorgias API requests for full coverage

Guidelines:
- Be concise and action-oriented
- When listing items, format them as readable tables or summaries
- When creating or modifying items, confirm the action and show key fields of the result
- The organization is automatically scoped — you never need to ask for org_id
- When the user refers to an entity by name, use the list tools first to find the ID, then operate on it
- For bulk operations, confirm the count before proceeding
- When showing IDs, include the first 8 characters for brevity unless the user asks for the full ID
- For knowledge base searches, present the top matches with their similarity scores
- For channel threads, include message counts and most recent activity when relevant

Commerce/support safety:
- Always preview first before any write operation (e.g., release holds, refunds, ticket updates)
- Never proceed without explicit user confirmation
- If a tool reports writes are disabled, explain how to enable them (use /apply on in chat, start a session with --apply, or set STATESET_ALLOW_APPLY=true for non-interactive runs)`;

/**
 * Hooks invoked during the agentic chat loop for streaming text,
 * intercepting tool calls (before/after execution), and tracking token usage.
 */
export interface ChatCallbacks {
  onText?: (delta: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolCallStart?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<ToolCallDecision | void> | ToolCallDecision | void;
  onToolCallEnd?: (result: ToolCallResult) => void;
  onUsage?: (usage: Anthropic.Usage) => void;
}

/**
 * Result of an `onToolCallStart` hook: 'allow' proceeds (optionally with modified args),
 * 'deny' blocks the call with a reason, 'respond' short-circuits with canned content.
 */
export interface ToolCallDecision {
  action: 'allow' | 'deny' | 'respond';
  args?: Record<string, unknown>;
  reason?: string;
  content?: string;
}

/** Captures the outcome of a single MCP tool invocation, including timing and error state. */
export interface ToolCallResult {
  name: string;
  args: Record<string, unknown>;
  resultText: string;
  isError: boolean;
  durationMs: number;
}

export interface ToolCallPayload<T = unknown> {
  payload: T;
  rawText: string;
  isError: boolean;
}

export interface HealthCheckResult {
  connected: boolean;
  toolCount: number;
  latencyMs: number;
  error?: string;
}

/**
 * Orchestrates conversation with Claude via the Anthropic API and delegates
 * tool execution to a co-located MCP server subprocess.
 */
export class StateSetAgent {
  private anthropic: Anthropic;
  private mcpClient: Client;
  private transport: StdioClientTransport | null = null;
  private tools: Anthropic.Tool[] = [];
  private conversationHistory: Anthropic.MessageParam[] = [];
  private model: ModelId;
  private abortController: AbortController | null = null;
  private systemPrompt: string = BASE_SYSTEM_PROMPT;
  private sessionStore: SessionStore | null = null;
  private mcpEnvOverrides: Record<string, string> = {};

  constructor(anthropicApiKey: string, model?: ModelId) {
    this.anthropic = new Anthropic({ apiKey: anthropicApiKey });
    this.mcpClient = new Client({ name: 'stateset-cli', version: '1.0.0' }, { capabilities: {} });
    this.model = model || DEFAULT_MODEL;
  }

  setMcpEnvOverrides(overrides: Record<string, string>): void {
    this.mcpEnvOverrides = { ...overrides };
  }

  setModel(model: ModelId): void {
    this.model = model;
  }

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /** Loads conversation history from a session store, trimming to the most recent messages. */
  useSessionStore(store: SessionStore): void {
    this.sessionStore = store;
    const loaded = store.loadMessages();
    this.conversationHistory = normalizeToolHistory(loaded.slice(-MAX_HISTORY_MESSAGES));
  }

  getModel(): ModelId {
    return this.model;
  }

  getHistoryLength(): number {
    return this.conversationHistory.length;
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /** Returns true if the MCP transport is active. */
  isConnected(): boolean {
    return this.transport !== null;
  }

  /** Pings the MCP server by listing tools and returns connection health info. */
  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.transport) {
      return { connected: false, toolCount: 0, latencyMs: 0, error: 'Not connected' };
    }
    const start = Date.now();
    try {
      const { tools } = await this.mcpClient.listTools();
      return {
        connected: true,
        toolCount: tools.length,
        latencyMs: Date.now() - start,
      };
    } catch (err: unknown) {
      return {
        connected: false,
        toolCount: 0,
        latencyMs: Date.now() - start,
        error: getErrorMessage(err),
      };
    }
  }

  /** Spawns the MCP server as a child process and discovers available tools. */
  async connect(): Promise<void> {
    if (this.transport) {
      await this.disconnect();
    }
    this.tools = [];

    const serverPath = path.join(__dirname, 'mcp-server', IS_TS ? 'index.ts' : 'index.js');
    const command = process.execPath;
    const args = IS_TS ? ['--loader', 'tsx', serverPath] : [serverPath];

    const transport = new StdioClientTransport({
      command,
      args,
      stderr: 'inherit',
      cwd: process.cwd(),
      env: {
        ...buildMcpEnv(),
        ...this.mcpEnvOverrides,
      },
    });
    this.transport = transport;

    const connectStart = Date.now();
    try {
      await withTimeout(this.mcpClient.connect(transport), MCP_CONNECT_TIMEOUT_MS, 'MCP connect');
      const { tools } = await withTimeout(
        this.mcpClient.listTools(),
        MCP_CONNECT_TIMEOUT_MS,
        'MCP listTools',
      );
      this.tools = tools.map((tool) => ({
        name: tool.name,
        description: tool.description || '',
        input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
      }));
      metrics.recordConnectionEvent({ type: 'connect', durationMs: Date.now() - connectStart });
    } catch (error: unknown) {
      metrics.recordConnectionEvent({
        type: 'error',
        durationMs: Date.now() - connectStart,
        error: getErrorMessage(error),
      });
      this.transport = null;
      this.tools = [];
      await transport.close().catch((closeErr: unknown) => {
        // Log transport close failure for diagnostics but don't mask the original error.
        if (closeErr instanceof Error) {
          metrics.increment('mcp.transport.closeErrors');
        }
      });
      throw error;
    }
  }

  /**
   * Runs the agentic loop: streams Claude's response, executes any tool calls
   * via MCP, feeds results back, and repeats until no more tool use is requested.
   * Returns the concatenated text output.
   */
  async chat(
    userMessage: Anthropic.MessageParam['content'],
    callbacks?: ChatCallbacks,
  ): Promise<string> {
    metrics.increment('chat.messages');
    this.addMessage({ role: 'user', content: userMessage });

    const textParts: string[] = [];

    // Agentic loop: keep calling Claude until it stops using tools
    while (true) {
      this.abortController = new AbortController();

      const stream = this.anthropic.messages.stream(
        {
          model: this.model,
          max_tokens: DEFAULT_MAX_TOKENS,
          system: this.systemPrompt,
          tools: this.tools,
          messages: this.conversationHistory,
        },
        { signal: this.abortController.signal },
      );

      let currentText = '';

      stream.on('text', (delta) => {
        currentText += delta;
        callbacks?.onText?.(delta);
      });

      let finalMessage: Anthropic.Message;
      try {
        finalMessage = await stream.finalMessage();
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error('Request cancelled');
        }
        throw err;
      } finally {
        this.abortController = null;
      }

      // Add assistant response to history
      this.addMessage({ role: 'assistant', content: finalMessage.content });

      // Collect text blocks
      if (currentText) {
        textParts.push(currentText);
      }

      if (finalMessage.usage) {
        metrics.recordTokenUsage(finalMessage.usage);
        callbacks?.onUsage?.(finalMessage.usage);
      }

      // Continue only if the model explicitly requested tool use
      if (finalMessage.stop_reason !== 'tool_use') {
        break;
      }

      // Execute tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of finalMessage.content) {
        if (block.type === 'tool_use') {
          let args: Record<string, unknown>;
          try {
            args = this.parseToolCallArguments(block.input);
            this.validateToolCallArgs(block.name, args);
          } catch (error) {
            const reason = getErrorMessage(error);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: `Error: ${reason}`,
              is_error: true,
            });
            callbacks?.onToolCallEnd?.({
              name: block.name,
              args: {},
              resultText: `Error: ${reason}`,
              isError: true,
              durationMs: 0,
            });
            continue;
          }

          callbacks?.onToolCall?.(block.name, args);

          if (callbacks?.onToolCallStart) {
            const decision = await callbacks.onToolCallStart(block.name, args);
            if (decision?.action === 'deny') {
              const reason = decision.reason || 'Tool call denied by hook.';
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: `Error: ${reason}`,
                is_error: true,
              });
              callbacks?.onToolCallEnd?.({
                name: block.name,
                args,
                resultText: `Error: ${reason}`,
                isError: true,
                durationMs: 0,
              });
              continue;
            }
            if (decision?.action === 'respond') {
              const content = decision.content || '';
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content,
              });
              callbacks?.onToolCallEnd?.({
                name: block.name,
                args,
                resultText: content,
                isError: false,
                durationMs: 0,
              });
              continue;
            }
            if (decision?.action === 'allow' && decision.args) {
              args = decision.args;
            }
          }

          try {
            this.validateToolCallArgs(block.name, args);
          } catch (error) {
            const reason = getErrorMessage(error);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: `Error: ${reason}`,
              is_error: true,
            });
            callbacks?.onToolCallEnd?.({
              name: block.name,
              args,
              resultText: `Error: ${reason}`,
              isError: true,
              durationMs: 0,
            });
            continue;
          }

          const startTime = Date.now();
          try {
            const result = await this.callToolWithRetry(block.name, args);
            const isError = Boolean((result as { isError?: boolean }).isError);

            const resultText = (result.content as Array<{ type: string; text?: string }>)
              .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c)))
              .join('\n');

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: resultText,
              is_error: isError,
            });

            const durationMs = Date.now() - startTime;
            metrics.recordToolCall(block.name, durationMs, isError);

            callbacks?.onToolCallEnd?.({
              name: block.name,
              args,
              resultText,
              isError,
              durationMs,
            });
          } catch (error: unknown) {
            const elapsed = Date.now() - startTime;
            metrics.recordToolCall(block.name, elapsed, true);
            const errMsg = getErrorMessage(error);
            const resultText = `Error calling tool "${block.name}" (${elapsed}ms): ${errMsg}`;
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: resultText,
              is_error: true,
            });
            callbacks?.onToolCallEnd?.({
              name: block.name,
              args,
              resultText,
              isError: true,
              durationMs: elapsed,
            });
          }
        }
      }

      // Feed tool results back
      this.addMessage({ role: 'user', content: toolResults });
    }

    return textParts.join('\n');
  }

  /** Closes the stdio transport to the MCP server subprocess. */
  async disconnect(): Promise<void> {
    if (this.transport) {
      try {
        await withTimeout(this.transport.close(), MCP_DISCONNECT_TIMEOUT_MS, 'MCP transport close');
      } catch {
        // Best-effort cleanup. Transport shutdown should not block shutdown flows.
      } finally {
        this.transport = null;
      }
    }
    this.tools = [];
    metrics.recordConnectionEvent({ type: 'disconnect' });
  }

  private trimHistory(): void {
    if (this.conversationHistory.length > MAX_HISTORY_MESSAGES) {
      this.conversationHistory = normalizeToolHistory(
        this.conversationHistory.slice(-MAX_HISTORY_MESSAGES),
      );
      return;
    }
    this.conversationHistory = normalizeToolHistory(this.conversationHistory);
  }

  /**
   * Calls an MCP tool with automatic retry for transient errors.
   * Retries up to MAX_TOOL_RETRIES times with exponential backoff.
   */
  private async callToolWithRetry(name: string, args: Record<string, unknown>) {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_TOOL_RETRIES; attempt++) {
      try {
        return await this.mcpClient.callTool({ name, arguments: args });
      } catch (err: unknown) {
        lastError = err;
        const isMcpTransport =
          err instanceof Error && (/EPIPE|closed|transport/i.test(err.message) || isRetryable(err));
        if (!isMcpTransport || attempt === MAX_TOOL_RETRIES) throw err;
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_BASE_DELAY_MS * Math.pow(2, attempt)),
        );
      }
    }
    throw lastError;
  }

  private parseToolCallArguments(rawArgs: unknown): Record<string, unknown> {
    if (rawArgs == null) {
      return {};
    }
    if (Array.isArray(rawArgs)) {
      throw new Error('Tool call arguments must be a JSON object, not an array.');
    }
    if (!isPlainObject(rawArgs)) {
      throw new Error('Tool call arguments must be a JSON object.');
    }
    return rawArgs;
  }

  private validateToolCallArgs(toolName: string, args: Record<string, unknown>): void {
    const serialized = JSON.stringify(args);
    if (serialized.length > MAX_TOOL_CALL_ARG_BYTES) {
      throw new Error(`Tool call arguments for "${toolName}" are too large.`);
    }

    const tool = this.tools.find((candidate) => candidate.name === toolName);
    if (!tool?.input_schema || typeof tool.input_schema !== 'object') return;

    const schema = tool.input_schema as ToolInputSchema;
    if (schema.type && schema.type !== 'object') {
      return;
    }

    const properties = isPlainObject(schema.properties) ? schema.properties : null;
    const additionalProperties = schema.additionalProperties ?? true;

    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(args, key)) {
          throw new Error(`Tool "${toolName}" argument "${key}" is required.`);
        }
      }
    }

    if (properties && additionalProperties === false) {
      for (const key of Object.keys(args)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          throw new Error(`Tool "${toolName}" argument "${key}" is not allowed.`);
        }
      }
    }

    if (!properties) {
      return;
    }

    for (const [key, value] of Object.entries(args)) {
      const rawPropertySchema = properties[key];
      if (!isPlainObject(rawPropertySchema)) {
        continue;
      }
      const propertySchema = rawPropertySchema as ToolInputSchema;
      const expected = propertySchema.type;
      if (!expected) {
        continue;
      }
      const expectedTypes = Array.isArray(expected) ? expected : [expected];
      const matches = expectedTypes.some((entry) => isExpectedType(value, entry));
      if (!matches) {
        throw new Error(
          `Tool "${toolName}" argument "${key}" has invalid type. Expected ${expectedTypes.join('|')}.`,
        );
      }
    }
  }

  /**
   * Calls an MCP tool directly with optional JSON arguments.
   * Useful for slash commands and non-interactive command modes.
   */
  async callTool<T = unknown>(
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<ToolCallPayload<T>> {
    if (!this.transport) {
      await this.connect();
    }

    const safeArgs = this.parseToolCallArguments(args);
    this.validateToolCallArgs(toolName, safeArgs);

    const response = await this.callToolWithRetry(toolName, safeArgs);

    const contentArray = Array.isArray(response.content)
      ? (response.content as Array<{ type: string; text?: string }>)
      : [];
    const rawText = contentArray
      .map((c) => {
        if (c.type === 'text' && typeof c.text === 'string') {
          return c.text;
        }
        return JSON.stringify(c);
      })
      .join('\n');

    let payload: T;
    if (rawText.length > MAX_TOOL_CALL_ARG_BYTES) {
      payload = rawText as T;
      return {
        payload,
        rawText,
        isError: Boolean(response.isError),
      };
    }

    try {
      payload = JSON.parse(rawText) as T;
    } catch {
      payload = rawText as T;
    }

    return {
      payload,
      rawText,
      isError: Boolean(response.isError),
    };
  }

  private addMessage(message: Anthropic.MessageParam): void {
    this.conversationHistory.push(message);
    this.trimHistory();

    if (this.sessionStore) {
      this.sessionStore.appendMessage(message);
      const text = this.extractText(message);
      if (text) {
        this.sessionStore.appendLog({
          ts: new Date().toISOString(),
          role: message.role as 'user' | 'assistant',
          text,
        });
      }
    }
  }

  private extractText(message: Anthropic.MessageParam): string | null {
    if (message.role !== 'user' && message.role !== 'assistant') return null;
    const content = message.content;

    if (Array.isArray(content)) {
      if (content.length > 0 && content.every((part) => part.type === 'tool_result')) {
        return null;
      }
      const textParts = content
        .filter(
          (part) => part.type === 'text' && typeof (part as { text?: string }).text === 'string',
        )
        .map((part) => (part as { text: string }).text.trim())
        .filter(Boolean);
      if (textParts.length === 0) return null;
      return textParts.join('\n');
    }

    if (typeof content === 'string') {
      return content.trim() || null;
    }

    return null;
  }
}
