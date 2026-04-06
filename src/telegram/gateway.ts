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

interface SenderSession {
  agent: StateSetAgent;
  lastActivity: number;
  processing: boolean;
  queue: Array<{ text: string; chatId: number }>;
  connectPromise?: Promise<void>;
  droppedMessages?: number;
}

export interface TelegramGatewayOptions {
  model?: string;
  allowList?: string[];
  verbose?: boolean;
}

interface TelegramUser {
  id: number;
  is_bot?: boolean;
}

interface TelegramChat {
  id: number;
  type: string;
}

interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: TelegramChat;
  from?: TelegramUser;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_TELEGRAM_LENGTH = 4096;
const MAX_SESSIONS = 400;
const MAX_SESSION_QUEUE = 128;
const MIN_CHUNK_RATIO = 0.3;
const POLL_TIMEOUT_SECONDS = 30;
const POLL_RETRY_MS = 1500;
const POLL_RETRY_MAX_MS = 10000;

export class TelegramGateway {
  private sessions = new Map<string, SenderSession>();
  private running = false;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private anthropicApiKey: string | null = null;
  private model: ModelId;
  private allowList: Set<string> | null;
  private verbose: boolean;
  private botToken: string;
  private orgId = 'unknown';
  private botUserId: number | null = null;
  private updateOffset = 0;
  private pollAbortController: AbortController | null = null;
  private pollLoopPromise: Promise<void> | null = null;
  private pollFailures = 0;

  constructor(options: TelegramGatewayOptions = {}) {
    this.model = options.model ? resolveModelOrThrow(options.model) : getConfiguredModel();
    this.allowList = options.allowList?.length ? new Set(options.allowList) : null;
    this.verbose = options.verbose ?? false;
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  }

  async start(): Promise<void> {
    const runtime = validateRuntimeConfig();
    this.orgId = runtime.orgId;
    this.anthropicApiKey = runtime.anthropicApiKey;

    const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!botToken) {
      throw new Error(
        'TELEGRAM_BOT_TOKEN environment variable is required.\n' +
          'Create a bot via @BotFather and set TELEGRAM_BOT_TOKEN.',
      );
    }

    this.botToken = botToken;
    this.log.info('Starting Telegram gateway...');

    const me = await this.callApi<TelegramUser>('getMe', {});
    this.botUserId = me.id;

    this.running = true;
    this.startCleanupTimer();
    this.pollLoopPromise = this.runPollLoop().catch((err) => {
      if (!this.running) {
        return;
      }
      this.log.error('Telegram polling stopped: ' + getErrorMessage(err));
    });

    this.log.info('Telegram bot connected. Gateway is ready for messages.');
  }

  async stop(): Promise<void> {
    this.running = false;
    this.stopCleanupTimer();

    if (this.pollAbortController) {
      this.pollAbortController.abort();
      this.pollAbortController = null;
    }
    if (this.pollLoopPromise) {
      await this.pollLoopPromise.catch(() => {});
      this.pollLoopPromise = null;
    }

    const disconnects: Promise<void>[] = [];
    for (const [, session] of this.sessions) {
      disconnects.push(session.agent.disconnect().catch(() => {}));
    }
    await Promise.all(disconnects);
    this.sessions.clear();

    this.log.info('Gateway stopped.');
  }

  getHealth(): {
    running: boolean;
    connected: boolean;
    activeSessions: number;
    model: string;
    orgId: string;
    pollFailures: number;
  } {
    return {
      running: this.running,
      connected: this.running && this.botUserId !== null,
      activeSessions: this.sessions.size,
      model: this.model,
      orgId: this.orgId,
      pollFailures: this.pollFailures,
    };
  }

  private async runPollLoop(): Promise<void> {
    while (this.running) {
      this.pollAbortController = new AbortController();
      try {
        const updates = await this.callApi<TelegramUpdate[]>(
          'getUpdates',
          {
            offset: this.updateOffset,
            timeout: POLL_TIMEOUT_SECONDS,
            allowed_updates: ['message', 'edited_message'],
          },
          this.pollAbortController.signal,
        );
        this.pollFailures = 0;

        for (const update of updates) {
          this.updateOffset = Math.max(this.updateOffset, update.update_id + 1);
          await this.handleUpdate(update);
        }
      } catch (err) {
        if (this.isAbortError(err) || !this.running) {
          break;
        }
        this.pollFailures += 1;
        const delay = Math.min(POLL_RETRY_MS * this.pollFailures, POLL_RETRY_MAX_MS);
        this.log.error(
          'Telegram poll failed: ' + getErrorMessage(err) + ' (retrying in ' + delay + 'ms)',
        );
        await sleep(delay);
      } finally {
        this.pollAbortController = null;
      }
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message ?? update.edited_message;
    if (!message?.text || !message.from) {
      return;
    }
    if (message.from.is_bot || message.chat.type !== 'private') {
      return;
    }

    const userId = String(message.from.id);
    if (this.allowList && !this.allowList.has(userId)) {
      this.log.debug('Filtered message from ' + userId + ' (not in allowlist)');
      return;
    }

    const text = message.text.trim();
    if (!text) {
      return;
    }

    const session = this.getOrCreateSession(userId);
    if (!session) {
      await this.sendText(
        message.chat.id,
        'Too many active sessions right now; please retry in a moment.',
      );
      return;
    }
    if (session.queue.length >= MAX_SESSION_QUEUE) {
      session.droppedMessages = (session.droppedMessages ?? 0) + 1;
      this.log.warn(
        'Dropping message for ' +
          userId +
          ': session queue full (' +
          MAX_SESSION_QUEUE +
          '). Total dropped: ' +
          session.droppedMessages,
      );
      await this.sendText(
        message.chat.id,
        'You are sending messages too quickly. Please wait for the previous requests to complete.',
      );
      return;
    }

    this.log.debug(userId + ': ' + text.slice(0, 100) + (text.length > 100 ? '...' : ''));

    session.queue.push({ text, chatId: message.chat.id });
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
        await this.handleMessage(item.chatId, item.text, session, userId);
      } catch (err) {
        this.log.error(
          'Error processing message from ' +
            userId +
            ': ' +
            (err instanceof Error ? err.message : String(err)),
        );
        await this.sendText(
          item.chatId,
          'Sorry, something went wrong processing your message. Please try again.',
        );
      }
    }

    session.processing = false;
  }

  private async handleMessage(
    chatId: number,
    text: string,
    session: SenderSession,
    userId: string,
  ): Promise<void> {
    const commandResponse = this.handleCommand(text, session);
    if (commandResponse !== null) {
      await this.sendText(chatId, commandResponse);
      return;
    }

    try {
      await this.ensureAgentConnected(session, userId);
    } catch (err) {
      const errMsg = getErrorMessage(err);
      this.log.error('Failed to connect agent for ' + userId + ': ' + errMsg);
      await this.sendText(
        chatId,
        'I encountered an error processing your request. Please try again.',
      );
      return;
    }

    await this.sendTyping(chatId);

    let response: string;
    try {
      response = await session.agent.chat(text);
    } catch (err) {
      const errMsg = getErrorMessage(err);
      this.log.error('Agent error for ' + userId + ': ' + errMsg);
      response = 'I encountered an error processing your request. Please try again.';
    }

    const chunks = chunkMessage(cleanForTelegram(response));
    for (const chunk of chunks) {
      await this.sendText(chatId, chunk);
    }
  }

  private handleCommand(text: string, session: SenderSession): string | null {
    const normalized = text.trim();
    const lower = normalized.toLowerCase();

    if (lower === '/start' || lower === '/help') {
      return [
        'StateSet Response Agent',
        '',
        'Commands:',
        '/help - Show this help message',
        '/reset - Clear conversation history',
        '/clear - Same as /reset',
        '/status - Show session info',
        '/model - Show or change model (alias or full model ID)',
      ].join('\n');
    }

    if (lower === '/reset' || lower === '/clear') {
      session.agent.clearHistory();
      return 'Conversation history cleared.';
    }

    if (lower === '/status') {
      return [
        'Session Status',
        'Organization: ' + this.orgId,
        'Model: ' + session.agent.getModel(),
        'History: ' + session.agent.getHistoryLength() + ' messages',
        'Active sessions: ' + this.sessions.size,
      ].join('\n');
    }

    const modelMatch = /^\/model(?:\s+(.*))?$/i.exec(normalized);
    if (modelMatch) {
      const arg = modelMatch[1] ? modelMatch[1].trim() : '';
      if (!arg) {
        return 'Current model: ' + session.agent.getModel();
      }
      try {
        const resolved = resolveModelOrThrow(arg);
        session.agent.setModel(resolved);
        return 'Model changed to: ' + resolved;
      } catch {
        return formatUnknownModelError(arg);
      }
    }

    return null;
  }

  private getOrCreateSession(userId: string): SenderSession | null {
    let session = this.sessions.get(userId);
    const now = Date.now();

    if (session && now - session.lastActivity > SESSION_TTL_MS) {
      this.log.debug('Expiring stale session for ' + userId);
      session.agent.disconnect().catch(() => {});
      this.sessions.delete(userId);
      session = undefined;
    }

    if (!session) {
      if (this.sessions.size >= MAX_SESSIONS) {
        this.evictOldestSessions();
        if (this.sessions.size >= MAX_SESSIONS) {
          this.log.warn('Session cache limit reached (' + MAX_SESSIONS + ').');
          return null;
        }
      }

      this.log.debug('Creating new session for ' + userId);
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
        'Failed to connect agent for ' +
          userId +
          ': ' +
          (err instanceof Error ? err.message : String(err)),
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
      this.log.debug('Evicting inactive session for ' + userId);
      session.agent.disconnect().catch(() => {});
      this.sessions.delete(userId);
      if (this.sessions.size < MAX_SESSIONS) {
        break;
      }
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
        this.log.debug('Cleaning up expired session for ' + userId);
        session.agent.disconnect().catch(() => {});
        this.sessions.delete(userId);
      }
    }
    while (this.sessions.size > MAX_SESSIONS) {
      const before = this.sessions.size;
      this.evictOldestSessions();
      if (this.sessions.size >= before) {
        break;
      }
    }
  }

  private async sendText(chatId: number, text: string): Promise<void> {
    try {
      await this.callApi('sendMessage', {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      });
    } catch (err) {
      this.log.error(
        'Failed to send message to ' +
          chatId +
          ': ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  private async sendTyping(chatId: number): Promise<void> {
    try {
      await this.callApi('sendChatAction', {
        chat_id: chatId,
        action: 'typing',
      });
    } catch {
      // Typing indicators are best-effort.
    }
  }

  private async callApi<T>(
    method: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch('https://api.telegram.org/bot' + this.botToken + '/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });

    let body: TelegramApiResponse<T> | null = null;
    try {
      body = (await response.json()) as TelegramApiResponse<T>;
    } catch {
      body = null;
    }

    if (!response.ok || !body?.ok) {
      const description =
        body?.description ?? 'Telegram API ' + method + ' failed (' + response.status + ')';
      throw new Error(description);
    }

    return body.result;
  }

  private isAbortError(err: unknown): boolean {
    return err instanceof Error && err.name === 'AbortError';
  }

  private readonly log = logger.child('telegram');
}

export function cleanForTelegram(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function chunkMessage(text: string, maxLength: number = MAX_TELEGRAM_LENGTH): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitAt = -1;

    const paragraphIndex = remaining.lastIndexOf('\n\n', maxLength);
    if (paragraphIndex > maxLength * MIN_CHUNK_RATIO) {
      splitAt = paragraphIndex;
    }

    if (splitAt < 0) {
      const lineIndex = remaining.lastIndexOf('\n', maxLength);
      if (lineIndex > maxLength * MIN_CHUNK_RATIO) {
        splitAt = lineIndex;
      }
    }

    if (splitAt < 0) {
      const wordIndex = remaining.lastIndexOf(' ', maxLength);
      if (wordIndex > maxLength * MIN_CHUNK_RATIO) {
        splitAt = wordIndex;
      }
    }

    if (splitAt < 0) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
