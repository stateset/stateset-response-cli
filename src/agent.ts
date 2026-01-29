import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatToolCall } from './utils/display.js';
import { type ModelId, DEFAULT_MODEL } from './config.js';

const THIS_FILE = fileURLToPath(import.meta.url);
const __dirname = path.dirname(THIS_FILE);
const IS_TS = THIS_FILE.endsWith('.ts');
const MAX_HISTORY_MESSAGES = 40;

const SYSTEM_PROMPT = `You are an AI assistant for managing the StateSet Response platform.
You have tools to manage agents, rules, skills, attributes, examples, evals, datasets, functions,
responses, channels, messages, knowledge base (semantic search and vector storage), and agent/channel settings.

Guidelines:
- Be concise and action-oriented
- When listing items, format them as readable tables or summaries
- When creating or modifying items, confirm the action and show key fields of the result
- The organization is automatically scoped — you never need to ask for org_id
- When the user refers to an entity by name, use the list tools first to find the ID, then operate on it
- For bulk operations, confirm the count before proceeding
- When showing IDs, include the first 8 characters for brevity unless the user asks for the full ID
- For knowledge base searches, present the top matches with their similarity scores
- For channel threads, include message counts and most recent activity when relevant`;

export interface ChatCallbacks {
  onText?: (delta: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
}

export class StateSetAgent {
  private anthropic: Anthropic;
  private mcpClient: Client;
  private transport: StdioClientTransport | null = null;
  private tools: Anthropic.Tool[] = [];
  private conversationHistory: Anthropic.MessageParam[] = [];
  private model: ModelId;
  private abortController: AbortController | null = null;

  constructor(anthropicApiKey: string, model?: ModelId) {
    this.anthropic = new Anthropic({ apiKey: anthropicApiKey });
    this.mcpClient = new Client(
      { name: 'stateset-cli', version: '1.0.0' },
      { capabilities: {} }
    );
    this.model = model || DEFAULT_MODEL;
  }

  setModel(model: ModelId): void {
    this.model = model;
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

  async connect(): Promise<void> {
    const serverPath = path.join(__dirname, 'mcp-server', IS_TS ? 'index.ts' : 'index.js');
    const command = process.execPath;
    const args = IS_TS ? ['--loader', 'tsx', serverPath] : [serverPath];

    this.transport = new StdioClientTransport({
      command,
      args,
      stderr: 'inherit',
    });

    await this.mcpClient.connect(this.transport);

    const { tools } = await this.mcpClient.listTools();
    this.tools = tools.map(tool => ({
      name: tool.name,
      description: tool.description || '',
      input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
    }));
  }

  async chat(userMessage: string, callbacks?: ChatCallbacks): Promise<string> {
    this.conversationHistory.push({ role: 'user', content: userMessage });
    this.trimHistory();

    const textParts: string[] = [];

    // Agentic loop: keep calling Claude until it stops using tools
    while (true) {
      this.abortController = new AbortController();

      const stream = this.anthropic.messages.stream(
        {
          model: this.model,
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
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
      }

      this.abortController = null;

      // Add assistant response to history
      this.conversationHistory.push({ role: 'assistant', content: finalMessage.content });
      this.trimHistory();

      // Collect text blocks
      if (currentText) {
        textParts.push(currentText);
      }

      // If no more tool calls, we're done
      if (finalMessage.stop_reason === 'end_turn' || finalMessage.stop_reason !== 'tool_use') {
        break;
      }

      // Execute tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of finalMessage.content) {
        if (block.type === 'tool_use') {
          callbacks?.onToolCall?.(block.name, block.input as Record<string, unknown>);

          try {
            const result = await this.mcpClient.callTool({
              name: block.name,
              arguments: block.input as Record<string, unknown>,
            });

            const resultText = (result.content as Array<{ type: string; text?: string }>)
              .map(c => c.type === 'text' ? c.text : JSON.stringify(c))
              .join('\n');

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: resultText,
            });
          } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: `Error: ${errMsg}`,
              is_error: true,
            });
          }
        }
      }

      // Feed tool results back
      this.conversationHistory.push({ role: 'user', content: toolResults });
      this.trimHistory();
    }

    return textParts.join('\n');
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
    }
  }

  private trimHistory(): void {
    if (this.conversationHistory.length > MAX_HISTORY_MESSAGES) {
      this.conversationHistory = this.conversationHistory.slice(-MAX_HISTORY_MESSAGES);
    }
  }
}
