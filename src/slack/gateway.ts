/**
 * Slack Gateway for StateSet Response
 *
 * Bridges Slack messages to the StateSet Response agent via Bolt (Socket Mode).
 * Each Slack user gets their own agent session for multi-turn conversations.
 *
 * Behavior:
 *   - In DMs: responds to all messages
 *   - In channels: only responds when @mentioned or in threads with the bot
 */

import { StateSetAgent } from '../agent.js';
import {
  resolveModelOrThrow,
  formatUnknownModelError,
  getConfiguredModel,
  validateRuntimeConfig,
  type ModelId,
} from '../config.js';
import { logger } from '../lib/logger.js';
import { getErrorMessage } from '../lib/errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SenderSession {
  agent: StateSetAgent;
  lastActivity: number;
  processing: boolean;
  queue: Array<{ text: string; channel: string; threadTs?: string }>;
  connectPromise?: Promise<void>;
  droppedMessages?: number;
}

export interface SlackGatewayOptions {
  model?: string;
  allowList?: string[];
  verbose?: boolean;
}

// Minimal Bolt types so we don't require @slack/bolt at compile time
interface SlackApp {
  client: {
    auth: { test: (opts: { token: string }) => Promise<{ user_id?: string }> };
    chat: { postMessage: (opts: Record<string, unknown>) => Promise<unknown> };
  };
  message: (handler: (args: { event: SlackMessageEvent }) => Promise<void>) => void;
  action: (
    pattern: RegExp,
    handler: (args: {
      action: { action_id?: string; value?: string };
      body: {
        user?: { id?: string };
        channel?: { id?: string };
        message?: { thread_ts?: string; ts?: string };
      };
      ack: () => Promise<void>;
      respond: (msg: { text: string; replace_original?: boolean }) => Promise<void>;
    }) => Promise<void>,
  ) => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

interface SlackMessageEvent {
  text?: string;
  user?: string;
  channel?: string;
  channel_type?: string;
  thread_ts?: string;
  ts?: string;
  subtype?: string;
  bot_id?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_SLACK_LENGTH = 3000;
const MAX_SESSIONS = 400;
const MAX_SESSION_QUEUE = 128;
const MIN_CHUNK_RATIO = 0.3;

// ---------------------------------------------------------------------------
// Slack Gateway
// ---------------------------------------------------------------------------

export class SlackGateway {
  private sessions = new Map<string, SenderSession>();
  private app: SlackApp | null = null;
  private running = false;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private anthropicApiKey: string | null = null;
  private model: ModelId;
  private allowList: Set<string> | null;
  private verbose: boolean;
  private botUserId: string | null = null;
  private botToken: string;
  private orgId = 'unknown';

  constructor(options: SlackGatewayOptions = {}) {
    this.model = options.model ? resolveModelOrThrow(options.model) : getConfiguredModel();
    this.allowList = options.allowList?.length ? new Set(options.allowList) : null;
    this.verbose = options.verbose ?? false;
    this.botToken = process.env.SLACK_BOT_TOKEN || '';
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    const runtime = validateRuntimeConfig();
    this.orgId = runtime.orgId;
    this.anthropicApiKey = runtime.anthropicApiKey;

    const botToken = process.env.SLACK_BOT_TOKEN;
    const appToken = process.env.SLACK_APP_TOKEN;

    if (!botToken) {
      throw new Error(
        'SLACK_BOT_TOKEN environment variable is required.\n' +
          'Get one from your Slack app settings: https://api.slack.com/apps',
      );
    }
    if (!appToken) {
      throw new Error(
        'SLACK_APP_TOKEN environment variable is required (starts with xapp-).\n' +
          'Enable Socket Mode and generate an app-level token in your Slack app settings.',
      );
    }

    this.botToken = botToken;

    // Dynamic import — clear error if @slack/bolt is not installed
    let AppCtor: new (opts: Record<string, unknown>) => SlackApp;
    try {
      const bolt = await import('@slack/bolt');
      AppCtor =
        (bolt as { default?: { App: typeof AppCtor }; App?: typeof AppCtor }).default?.App ??
        (bolt as { App: typeof AppCtor }).App;
    } catch {
      throw new Error('@slack/bolt is not installed. Install it with: npm install @slack/bolt');
    }

    this.log.info('Starting Slack gateway...');

    this.app = new AppCtor({
      token: botToken,
      appToken,
      socketMode: true,
    });

    // Resolve bot user ID for mention detection
    try {
      const auth = await this.app.client.auth.test({ token: botToken });
      this.botUserId = auth.user_id ?? null;
      this.log.debug(`Bot user ID: ${this.botUserId}`);
    } catch {
      this.log.info('Warning: could not resolve bot user ID. Mention detection may not work.');
    }

    this.setupEventHandlers();

    this.running = true;
    this.startCleanupTimer();

    await this.app.start();
    this.log.info('Slack bot connected. Gateway is ready for messages.');
  }

  async stop(): Promise<void> {
    this.running = false;
    this.stopCleanupTimer();

    const disconnects: Promise<void>[] = [];
    for (const [, session] of this.sessions) {
      disconnects.push(session.agent.disconnect().catch(() => {}));
    }
    await Promise.all(disconnects);
    this.sessions.clear();

    if (this.app) {
      try {
        await this.app.stop();
      } catch {
        /* ignore */
      }
      this.app = null;
    }

    this.log.info('Gateway stopped.');
  }

  /** Returns a snapshot of gateway health for observability. */
  getHealth(): {
    running: boolean;
    connected: boolean;
    activeSessions: number;
    model: string;
    orgId: string;
  } {
    return {
      running: this.running,
      connected: this.app !== null,
      activeSessions: this.sessions.size,
      model: this.model,
      orgId: this.orgId,
    };
  }

  // -------------------------------------------------------------------------
  // Event Handlers
  // -------------------------------------------------------------------------

  private setupEventHandlers(): void {
    if (!this.app) return;

    // Incoming messages
    this.app.message(async ({ event }) => {
      try {
        await this.onMessage(event);
      } catch (err) {
        this.log.error(`Error handling message: ${err instanceof Error ? err.message : err}`);
        if (this.verbose && err instanceof Error) this.log.error(String(err));
      }
    });

    // Button action callbacks
    this.app.action(/.*/, async ({ action, body, ack, respond }) => {
      await ack();

      try {
        const userId = body.user?.id;
        const channel = body.channel?.id;
        const threadTs = body.message?.thread_ts ?? body.message?.ts;

        if (!userId || !channel) return;

        const actionId = action.action_id || action.value || '';
        const syntheticText = actionId.startsWith('/') ? actionId : actionId;

        if (syntheticText) {
          await this.onMessage({
            text: syntheticText,
            user: userId,
            channel,
            channel_type: 'im',
            thread_ts: threadTs,
          });
        }
      } catch (err) {
        this.log.error(`Error handling action: ${err instanceof Error ? err.message : err}`);
        try {
          await respond({
            text: 'Sorry, I encountered an error processing that action.',
            replace_original: false,
          });
        } catch {
          /* ignore */
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // Message Processing
  // -------------------------------------------------------------------------

  private async onMessage(event: SlackMessageEvent): Promise<void> {
    // Skip bot messages
    if (event.subtype === 'bot_message' || event.bot_id) return;

    const userId = event.user;
    const channel = event.channel;
    if (!userId || !channel) return;

    // Allowlist check
    if (this.allowList && !this.allowList.has(userId)) {
      this.log.debug(`Filtered message from ${userId} (not in allowlist)`);
      return;
    }

    let text = event.text || '';

    // In channels (not DMs), only respond when @mentioned or in existing threads
    if (event.channel_type !== 'im') {
      if (this.botUserId && !text.includes(`<@${this.botUserId}>`)) {
        // Not mentioned — only respond if it's a thread reply (bot may have participated)
        if (!event.thread_ts) return;
      }
      // Strip the mention
      if (this.botUserId) {
        text = text.replace(new RegExp(`<@${this.botUserId}>`, 'g'), '').trim();
      }
    }

    if (!text) return;

    this.log.debug(`${userId}: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);

    const session = this.getOrCreateSession(userId);
    if (!session) {
      await this.sendText(channel, 'Too many active sessions right now; please retry in a moment.');
      return;
    }
    if (session.queue.length >= MAX_SESSION_QUEUE) {
      session.droppedMessages = (session.droppedMessages ?? 0) + 1;
      this.log.warn(
        `Dropping message for ${userId}: session queue full (${MAX_SESSION_QUEUE}). Total dropped: ${session.droppedMessages}`,
      );
      await this.sendText(
        channel,
        'You are sending messages too quickly. Please wait for the previous requests to complete.',
      );
      return;
    }
    session.queue.push({ text, channel, threadTs: event.thread_ts ?? event.ts });
    session.lastActivity = Date.now();

    if (!session.processing) {
      await this.processQueue(userId, session);
    }
  }

  private async processQueue(userId: string, session: SenderSession): Promise<void> {
    session.processing = true;

    while (session.queue.length > 0) {
      const item = session.queue.shift()!;
      try {
        await this.handleMessage(item.channel, item.text, session, userId, item.threadTs);
      } catch (err) {
        this.log.error(
          `Error processing message from ${userId}: ${err instanceof Error ? err.message : err}`,
        );
        await this.sendText(
          item.channel,
          'Sorry, something went wrong processing your message. Please try again.',
          item.threadTs,
        );
      }
    }

    session.processing = false;
  }

  private async handleMessage(
    channel: string,
    text: string,
    session: SenderSession,
    userId: string,
    threadTs?: string,
  ): Promise<void> {
    // Handle built-in commands
    const commandResponse = this.handleCommand(text, session);
    if (commandResponse !== null) {
      await this.sendText(channel, commandResponse, threadTs);
      return;
    }

    try {
      await this.ensureAgentConnected(session, userId);
    } catch (err) {
      const errMsg = getErrorMessage(err);
      this.log.error(`Failed to connect agent for ${userId}: ${errMsg}`);
      const response = 'I encountered an error processing your request. Please try again.';
      const formatted = cleanForSlack(response);
      const chunks = chunkMessage(formatted);
      for (const chunk of chunks) {
        await this.sendText(channel, chunk, threadTs);
      }
      return;
    }

    // Send to agent
    let response: string;
    try {
      response = await session.agent.chat(text);
    } catch (err) {
      const errMsg = getErrorMessage(err);
      this.log.error(`Agent error for ${channel}: ${errMsg}`);
      response = 'I encountered an error processing your request. Please try again.';
    }

    // Format and send
    const formatted = cleanForSlack(response);
    const chunks = chunkMessage(formatted);

    for (const chunk of chunks) {
      await this.sendText(channel, chunk, threadTs);
    }
  }

  // -------------------------------------------------------------------------
  // Built-in Commands
  // -------------------------------------------------------------------------

  private handleCommand(text: string, session: SenderSession): string | null {
    const lower = text.toLowerCase().trim();

    if (lower === '/help') {
      return [
        '*StateSet Response Agent*',
        '',
        'Commands:',
        '`/help` — Show this help message',
        '`/reset` — Clear conversation history',
        '`/clear` — Same as /reset',
        '`/status` — Show session info',
        '`/model` — Show or change model (alias or full model ID)',
        '',
        'Send any message to chat with the AI agent.',
        'The agent can manage your StateSet Response platform:',
        'agents, rules, skills, attributes, examples, evals,',
        'datasets, functions, responses, channels, messages,',
        'knowledge base, and settings.',
      ].join('\n');
    }

    if (lower === '/reset' || lower === '/clear') {
      session.agent.clearHistory();
      return 'Conversation history cleared.';
    }

    if (lower === '/status') {
      return [
        '*Session Status*',
        `Organization: \`${this.orgId}\``,
        `Model: \`${session.agent.getModel()}\``,
        `History: ${session.agent.getHistoryLength()} messages`,
        `Active sessions: ${this.sessions.size}`,
      ].join('\n');
    }

    const modelMatch = /^\/model(?:\s+(.*))?$/.exec(lower);
    if (modelMatch) {
      const arg = modelMatch[1] ? modelMatch[1].trim() : '';
      if (!arg) {
        return `Current model: \`${session.agent.getModel()}\``;
      }
      try {
        const resolved = resolveModelOrThrow(arg);
        session.agent.setModel(resolved);
        return `Model changed to: \`${resolved}\``;
      } catch {
        return formatUnknownModelError(arg);
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Session Management
  // -------------------------------------------------------------------------

  private getOrCreateSession(userId: string): SenderSession | null {
    let session = this.sessions.get(userId);
    const now = Date.now();

    if (session && now - session.lastActivity > SESSION_TTL_MS) {
      this.log.debug(`Expiring stale session for ${userId}`);
      session.agent.disconnect().catch(() => {});
      this.sessions.delete(userId);
      session = undefined;
    }

    if (!session) {
      if (this.sessions.size >= MAX_SESSIONS) {
        this.evictOldestSessions();
        if (this.sessions.size >= MAX_SESSIONS) {
          this.log.warn(`Session cache limit reached (${MAX_SESSIONS}).`);
          return null;
        }
      }

      this.log.debug(`Creating new session for ${userId}`);
      const apiKey = this.anthropicApiKey;
      if (!apiKey) {
        return null;
      }
      const agent = new StateSetAgent(apiKey, this.model);

      session = {
        agent,
        lastActivity: Date.now(),
        processing: false,
        queue: [],
      };
      session.connectPromise = this.connectAgent(agent, userId);
      this.sessions.set(userId, session);
    }

    session.lastActivity = Date.now();
    return session;
  }

  private connectAgent(agent: StateSetAgent, userId: string): Promise<void> {
    return agent.connect().catch((err) => {
      this.log.error(
        `Failed to connect agent for ${userId}: ${err instanceof Error ? err.message : err}`,
      );
      throw err;
    });
  }

  private async ensureAgentConnected(session: SenderSession, userId: string): Promise<void> {
    if (!session.connectPromise) {
      session.connectPromise = this.connectAgent(session.agent, userId);
    }
    try {
      await session.connectPromise;
      session.connectPromise = undefined;
    } catch (err) {
      session.connectPromise = undefined;
      throw err;
    }
  }

  private evictOldestSessions(limit = 1): void {
    const candidates = [...this.sessions.entries()]
      .filter(([, session]) => !session.processing)
      .sort((a, b) => a[1].lastActivity - b[1].lastActivity);

    for (const [userId, session] of candidates.slice(0, limit)) {
      this.log.debug(`Evicting inactive session for ${userId}`);
      session.agent.disconnect().catch(() => {});
      this.sessions.delete(userId);
      if (this.sessions.size < MAX_SESSIONS) break;
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => this.cleanupSessions(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private cleanupSessions(): void {
    const now = Date.now();
    for (const [userId, session] of this.sessions) {
      if (now - session.lastActivity > SESSION_TTL_MS && !session.processing) {
        this.log.debug(`Cleaning up expired session for ${userId}`);
        session.agent.disconnect().catch(() => {});
        this.sessions.delete(userId);
      }
    }
    while (this.sessions.size > MAX_SESSIONS) {
      const before = this.sessions.size;
      this.evictOldestSessions();
      if (this.sessions.size >= before) break;
    }
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  private async sendText(channel: string, text: string, threadTs?: string): Promise<void> {
    if (!this.app) return;
    try {
      const opts: Record<string, unknown> = {
        token: this.botToken,
        channel,
        text,
      };
      if (threadTs) {
        opts.thread_ts = threadTs;
      }
      await this.app.client.chat.postMessage(opts);
    } catch (err) {
      this.log.error(
        `Failed to send message to ${channel}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Logging
  // -------------------------------------------------------------------------

  private readonly log = logger.child('slack');
}

// ---------------------------------------------------------------------------
// Text Formatting
// ---------------------------------------------------------------------------

/**
 * Convert markdown to Slack-friendly formatting.
 *
 * Slack supports:
 *   *bold*, _italic_, ~strikethrough~, `code`, ```code block```
 *   Links: <url|text>
 */
export function cleanForSlack(text: string): string {
  let result = text;

  // Convert markdown headers to bold
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // Convert **bold** to *bold* (Slack style)
  result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');

  // Convert __bold__ to *bold*
  result = result.replace(/__(.+?)__/g, '*$1*');

  // Convert markdown links [text](url) to Slack format <url|text>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');

  // Convert markdown code blocks (strip language identifier)
  result = result.replace(/```\w*\n/g, '```\n');

  // Convert markdown bullet lists
  result = result.replace(/^[-*]\s+/gm, '- ');

  // Remove horizontal rules
  result = result.replace(/^---+$/gm, '');

  // Clean up excessive blank lines
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}

/**
 * Split a message into chunks that fit within Slack's size limit.
 * Splits at paragraph > sentence > word boundaries.
 */
export function chunkMessage(text: string, maxLength: number = MAX_SLACK_LENGTH): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = -1;

    // Paragraph boundary
    const paraBreak = remaining.lastIndexOf('\n\n', maxLength);
    if (paraBreak > maxLength * MIN_CHUNK_RATIO) {
      splitIndex = paraBreak;
    }

    // Sentence boundary
    if (splitIndex === -1) {
      const slice = remaining.slice(0, maxLength);
      const sentenceMatch = slice.match(/.*[.!?]\s/s);
      if (sentenceMatch && sentenceMatch[0].length > maxLength * MIN_CHUNK_RATIO) {
        splitIndex = sentenceMatch[0].length;
      }
    }

    // Line boundary
    if (splitIndex === -1) {
      const lineBreak = remaining.lastIndexOf('\n', maxLength);
      if (lineBreak > maxLength * MIN_CHUNK_RATIO) {
        splitIndex = lineBreak;
      }
    }

    // Word boundary
    if (splitIndex === -1) {
      const wordBreak = remaining.lastIndexOf(' ', maxLength);
      if (wordBreak > maxLength * MIN_CHUNK_RATIO) {
        splitIndex = wordBreak;
      }
    }

    // Hard split
    if (splitIndex === -1) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  return chunks;
}
