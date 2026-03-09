import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { StateSetAgent, type AssistantTurnInfo } from '../../agent.js';
import { getRuntimeContext } from '../../config.js';
import { getErrorMessage } from '../../lib/errors.js';
import { readJsonFile, readTextFile } from '../../utils/file-read.js';
import type { SessionStore } from '../../session.js';
import { BASE_SYSTEM_PROMPT } from '../../system-prompt.js';

const WRITE_TOOL_PREFIXES = [
  'create_',
  'update_',
  'delete_',
  'bulk_',
  'import_',
  'deploy',
  'rollback',
  'assign_',
  'cancel_',
  'merge_',
  'patch_',
  'apply_',
  'release_',
  'refund_',
  'send_',
  'set_',
];

const READ_ONLY_TOOL_PREFIXES = [
  'list_',
  'get_',
  'search_',
  'kb_',
  'export_',
  'bootstrap_',
  'validate_',
];

export interface ToolTraceEntry {
  step: number;
  name: string;
  args: Record<string, unknown>;
  decision: 'allow' | 'blocked' | 'mock';
  reason?: string;
  resultText?: string;
  isError?: boolean;
  durationMs?: number;
}

export interface AgentTraceResult {
  input: string;
  finalResponse: string;
  toolCalls: ToolTraceEntry[];
  assistantTurns: AssistantTurnInfo[];
  sandboxed: boolean;
  mockSource?: string;
  contextSource?: string;
}

export interface AgentTraceOptions {
  input: string;
  agentId?: string;
  mockFile?: string;
  contextFile?: string;
  allowWrites?: boolean;
}

export interface TracedAgentSessionOptions {
  agentId?: string;
  mockFile?: string;
  contextFile?: string;
  allowWrites?: boolean;
  seedMessages?: Anthropic.MessageParam[];
}

type MockToolMap = Record<string, unknown>;

function readMockToolMap(mockFile?: string): { map: MockToolMap; path?: string } {
  if (!mockFile) {
    return { map: {} };
  }

  const resolvedPath = path.resolve(mockFile);
  const parsed = readJsonFile(resolvedPath, {
    label: 'mock tool response file',
    expectObject: true,
  }) as Record<string, unknown>;
  const map =
    parsed.tools && typeof parsed.tools === 'object' && !Array.isArray(parsed.tools)
      ? (parsed.tools as MockToolMap)
      : (parsed as MockToolMap);
  return { map, path: resolvedPath };
}

function readContextOverride(contextFile?: string): { content?: string; path?: string } {
  if (!contextFile) {
    return {};
  }

  const resolvedPath = path.resolve(contextFile);
  return {
    content: readTextFile(resolvedPath, { label: 'simulation context file' }),
    path: resolvedPath,
  };
}

function findPendingTraceIndex(toolCalls: ToolTraceEntry[], name: string): number {
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    if (toolCalls[index]?.name === name && toolCalls[index]?.resultText === undefined) {
      return index;
    }
  }
  return -1;
}

function resolveMockResponse(
  toolName: string,
  mockMap: MockToolMap,
): { matched: boolean; content: string } | null {
  const exact = mockMap[toolName];
  const lowerExact = mockMap[toolName.toLowerCase()];
  const wildcard = mockMap['*'] ?? mockMap.__default;
  const value = exact ?? lowerExact ?? wildcard;
  if (value === undefined) {
    return null;
  }
  return {
    matched: true,
    content: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  };
}

export function isLikelyWriteToolName(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (READ_ONLY_TOOL_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return false;
  }
  if (WRITE_TOOL_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }
  return /(?:create|update|delete|import|bulk|deploy|rollback|assign|cancel|merge|patch|apply|send|rate)(?:_|$)/.test(
    normalized,
  );
}

export class TracedAgentSession {
  private readonly agent: StateSetAgent;
  private readonly sandboxed: boolean;
  private readonly mockMap: MockToolMap;
  private readonly mockSource?: string;
  private readonly contextSource?: string;
  private readonly previousAgentId: string | undefined;
  private readonly agentId?: string;
  private connected = false;

  constructor(options: TracedAgentSessionOptions = {}) {
    this.agentId = options.agentId;
    this.previousAgentId = process.env.STATESET_ACTIVE_AGENT_ID;
    if (options.agentId) {
      process.env.STATESET_ACTIVE_AGENT_ID = options.agentId;
    }
    const { anthropicApiKey } = getRuntimeContext();
    const { map: mockMap, path: mockSource } = readMockToolMap(options.mockFile);
    const { content: contextContent, path: contextSource } = readContextOverride(
      options.contextFile,
    );
    this.sandboxed = options.allowWrites !== true;
    this.mockMap = mockMap;
    this.mockSource = mockSource;
    this.contextSource = contextSource;
    this.agent = new StateSetAgent(anthropicApiKey);
    if (options.seedMessages && options.seedMessages.length > 0) {
      this.agent.useSessionStore({
        loadMessages: () => options.seedMessages || [],
      } as unknown as SessionStore);
    }
    if (contextContent) {
      this.agent.setSystemPrompt(
        `${BASE_SYSTEM_PROMPT}\n\nAdditional replay/simulation context:\n${contextContent.trim()}`,
      );
    }
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    await this.agent.connect();
    this.connected = true;
  }

  async run(input: string): Promise<AgentTraceResult> {
    const normalizedInput = input.trim();
    if (!normalizedInput) {
      throw new Error('Simulation input is required.');
    }
    await this.connect();

    const toolCalls: ToolTraceEntry[] = [];
    const assistantTurns: AssistantTurnInfo[] = [];

    try {
      const finalResponse = await this.agent.chat(normalizedInput, {
        onAssistantTurn: (turn) => {
          assistantTurns.push(turn);
        },
        onToolCallStart: async (name, args) => {
          const trace: ToolTraceEntry = {
            step: toolCalls.length + 1,
            name,
            args,
            decision: 'allow',
          };

          const mock = resolveMockResponse(name, this.mockMap);
          if (mock) {
            trace.decision = 'mock';
            trace.reason = `Mock response loaded from ${path.basename(this.mockSource || '')}`;
            toolCalls.push(trace);
            return {
              action: 'respond',
              content: mock.content,
            };
          }

          if (this.sandboxed && isLikelyWriteToolName(name)) {
            trace.decision = 'blocked';
            trace.reason =
              'Blocked write-like tool call in simulator mode. Re-run with --allow-writes to permit it.';
            toolCalls.push(trace);
            return {
              action: 'deny',
              reason: trace.reason,
            };
          }

          toolCalls.push(trace);
          return { action: 'allow', args };
        },
        onToolCallEnd: (result) => {
          const index = findPendingTraceIndex(toolCalls, result.name);
          if (index === -1) {
            toolCalls.push({
              step: toolCalls.length + 1,
              name: result.name,
              args: {},
              decision: result.isError ? 'blocked' : 'allow',
              resultText: result.resultText,
              isError: result.isError,
              durationMs: result.durationMs,
            });
            return;
          }
          toolCalls[index] = {
            ...toolCalls[index],
            resultText: result.resultText,
            isError: result.isError,
            durationMs: result.durationMs,
          };
        },
      });

      return {
        input: normalizedInput,
        finalResponse,
        toolCalls,
        assistantTurns,
        sandboxed: this.sandboxed,
        mockSource: this.mockSource,
        contextSource: this.contextSource,
      };
    } catch (error) {
      throw new Error(`Simulation failed: ${getErrorMessage(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.agent.disconnect();
      this.connected = false;
    }
    if (this.agentId) {
      if (this.previousAgentId === undefined) {
        delete process.env.STATESET_ACTIVE_AGENT_ID;
      } else {
        process.env.STATESET_ACTIVE_AGENT_ID = this.previousAgentId;
      }
    }
  }
}

export async function runTracedAgentChat(options: AgentTraceOptions): Promise<AgentTraceResult> {
  const session = new TracedAgentSession(options);
  try {
    return await session.run(options.input);
  } finally {
    await session.disconnect();
  }
}
