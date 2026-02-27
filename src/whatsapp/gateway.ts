import {
  createWhatsAppSocket,
  waitForConnection,
  extractText,
  jidToPhone,
  isGroup,
  getStatusCode,
  getDisconnectReason,
  type WhatsAppSocket,
} from './session.js';
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
  queue: Array<{ text: string; jid: string; messageId: string }>;
  connectPromise?: Promise<void>;
  droppedMessages?: number;
}

export interface GatewayOptions {
  model?: string;
  allowList?: string[];
  allowGroups?: boolean;
  selfChatOnly?: boolean;
  authDir?: string;
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_WHATSAPP_LENGTH = 4000;
const MAX_SESSIONS = 400;
const MAX_SESSION_QUEUE = 128;
const MIN_CHUNK_RATIO = 0.3;
const SENT_MESSAGE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const AGENT_MARKER = '[agent]';
const AGENT_MARKER_LOWER = AGENT_MARKER.toLowerCase();
const RECONNECT_INITIAL_MS = 2000;
const RECONNECT_MAX_MS = 30000;
const RECONNECT_FACTOR = 1.8;
const RECONNECT_JITTER = 0.25;
const RECONNECT_MAX_ATTEMPTS = 12;
const normalizePhone = (jid: string): string => jidToPhone(jid).replace(/[^0-9]/g, '');

// ---------------------------------------------------------------------------
// WhatsApp Gateway
// ---------------------------------------------------------------------------

export class WhatsAppGateway {
  private sessions = new Map<string, SenderSession>();
  private sock: WhatsAppSocket | null = null;
  private running = false;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private reconnectScheduled = false;
  private connecting = false;
  private model: ModelId;
  private allowList: Set<string> | null;
  private allowGroups: boolean;
  private selfChatOnly: boolean;
  private authDir?: string;
  private verbose: boolean;
  private ownJid: string | null = null;
  private ownPhone: string | null = null;
  private sentMessageIds = new Map<string, number>();
  private anthropicApiKey: string | null = null;
  private orgId = 'unknown';

  constructor(options: GatewayOptions = {}) {
    this.model = options.model ? resolveModelOrThrow(options.model) : getConfiguredModel();
    this.allowList = options.allowList?.length
      ? new Set(options.allowList.map((p) => p.replace(/[^0-9]/g, '')))
      : null;
    this.selfChatOnly = options.selfChatOnly ?? false;
    this.allowGroups = this.selfChatOnly ? false : (options.allowGroups ?? false);
    this.authDir = options.authDir;
    this.verbose = options.verbose ?? false;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    const runtime = validateRuntimeConfig();
    this.orgId = runtime.orgId;
    this.anthropicApiKey = runtime.anthropicApiKey;

    this.running = true;
    this.startCleanupTimer();
    await this.connect();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.stopCleanupTimer();

    // Disconnect all agent sessions
    const disconnects: Promise<void>[] = [];
    for (const [, session] of this.sessions) {
      disconnects.push(session.agent.disconnect().catch(() => {}));
    }
    await Promise.all(disconnects);
    this.sessions.clear();
    this.sentMessageIds.clear();

    // Close socket
    if (this.sock) {
      try {
        this.sock.end();
      } catch {
        /* ignore */
      }
      this.sock = null;
    }

    this.log.info('Gateway stopped.');
  }

  /** Returns a snapshot of gateway health for observability. */
  getHealth(): {
    running: boolean;
    connected: boolean;
    connecting: boolean;
    reconnectAttempts: number;
    activeSessions: number;
    model: string;
    orgId: string;
  } {
    return {
      running: this.running,
      connected: this.sock?.ws?.readyState === 1,
      connecting: this.connecting,
      reconnectAttempts: this.reconnectAttempts,
      activeSessions: this.sessions.size,
      model: this.model,
      orgId: this.orgId,
    };
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  private async connect(): Promise<void> {
    if (this.connecting) {
      this.log.debug('Connect already in progress; skipping.');
      return;
    }

    if (this.sock?.ws?.readyState === 1) {
      this.log.debug('Socket already open; skipping connect.');
      return;
    }

    this.connecting = true;
    this.log.info('Connecting to WhatsApp...');

    let qrTerminal: {
      generate: (qr: string, opts: Record<string, unknown>, cb: (code: string) => void) => void;
    } | null = null;
    try {
      qrTerminal = (await import('qrcode-terminal')).default;
    } catch {
      // qrcode-terminal not available; print raw QR string
    }

    if (this.sock) {
      try {
        this.sock.end();
      } catch {
        /* ignore */
      }
      this.sock = null;
    }

    this.sock = await createWhatsAppSocket({
      authDir: this.authDir,
      verbose: this.verbose,
      onQr: (qr: string) => {
        console.log('\n--- Scan this QR code with WhatsApp ---\n');
        if (qrTerminal) {
          qrTerminal.generate(qr, { small: true }, (code: string) => {
            console.log(code);
          });
        } else {
          console.log(`QR data: ${qr}`);
          console.log('(Install qrcode-terminal for visual QR code)');
        }
        console.log('\nOpen WhatsApp > Settings > Linked Devices > Link a Device\n');
      },
    });

    this.setupEventHandlers(this.sock);

    try {
      await waitForConnection(this.sock);
      this.reconnectAttempts = 0;
      this.ownJid = this.sock.user?.id ?? null;
      this.ownPhone = this.ownJid ? normalizePhone(this.ownJid) : null;
      this.log.info(`Connected as ${this.ownJid ?? 'unknown'}`);
    } catch (err) {
      this.log.error(`Initial connection failed: ${err instanceof Error ? err.message : err}`);
      if (this.running) {
        await this.scheduleReconnect();
      }
    } finally {
      this.connecting = false;
    }
  }

  private setupEventHandlers(sock: WhatsAppSocket): void {
    // Connection state changes (for reconnection)
    sock.ev.on('connection.update', (async (update: {
      connection?: string;
      lastDisconnect?: { error?: { output?: { statusCode?: number } } };
    }) => {
      if (update.connection === 'close') {
        const code = getStatusCode(update.lastDisconnect);
        this.log.info(`Connection closed (code: ${code})`);

        const reasons = await getDisconnectReason();
        if (code === reasons.loggedOut) {
          this.log.warn('Logged out — cannot reconnect. Clear auth and re-scan QR.');
          this.running = false;
          return;
        }

        if (this.running) {
          await this.scheduleReconnect();
        }
      }
    }) as never);

    // Incoming messages
    sock.ev.on('messages.upsert', ((event: {
      messages: Array<Record<string, unknown>>;
      type: string;
    }) => {
      if (event.type !== 'notify') return;

      for (const msg of event.messages) {
        const key = msg.key as { remoteJid?: string; fromMe?: boolean; id?: string } | undefined;
        if (!key?.remoteJid) continue;

        const jid = key.remoteJid;
        const isFromMe = Boolean(key.fromMe);
        const isSelfChat = this.isSelfChat(jid);

        if (this.selfChatOnly) {
          if (!isSelfChat) continue;
          if (isGroup(jid)) continue;
          if (isFromMe && this.isSentByGateway(key.id)) {
            this.log.debug(`Skipping gateway echo ${key.id ?? ''}`.trim());
            continue;
          }
        } else {
          // Skip own messages
          if (isFromMe) continue;

          // Skip self-chat (message from own number)
          if (isSelfChat) continue;
        }

        // Group filtering
        if (isGroup(jid) && !this.allowGroups) continue;

        // Allowlist filtering
        const phone = normalizePhone(jid);
        if (this.allowList && !this.allowList.has(phone)) {
          this.log.debug(`Filtered message from ${phone} (not in allowlist)`);
          continue;
        }

        const text = extractText(msg);
        if (!text || text.trim().length === 0) continue;
        if (this.selfChatOnly && this.isAgentMessage(text)) {
          this.log.debug('Skipping agent-tagged message');
          continue;
        }

        this.log.debug(`Message from ${phone}: ${text.substring(0, 80)}...`);
        this.enqueueMessage(jid, text.trim(), key.id ?? '');
      }
    }) as never);
  }

  // -------------------------------------------------------------------------
  // Reconnection with exponential backoff
  // -------------------------------------------------------------------------

  private async scheduleReconnect(): Promise<void> {
    if (!this.running) return;
    if (this.connecting) {
      this.log.debug('Reconnect skipped: connect already in progress.');
      return;
    }
    if (this.sock?.ws?.readyState === 1) {
      this.log.debug('Reconnect skipped: socket already open.');
      return;
    }
    if (this.reconnectScheduled) {
      this.log.debug('Reconnect already scheduled.');
      return;
    }
    this.reconnectScheduled = true;

    try {
      this.reconnectAttempts++;
      if (this.reconnectAttempts > RECONNECT_MAX_ATTEMPTS) {
        this.log.warn(`Max reconnect attempts (${RECONNECT_MAX_ATTEMPTS}) reached. Stopping.`);
        this.running = false;
        return;
      }

      const baseDelay = Math.min(
        RECONNECT_INITIAL_MS * Math.pow(RECONNECT_FACTOR, this.reconnectAttempts - 1),
        RECONNECT_MAX_MS,
      );
      const jitter = baseDelay * RECONNECT_JITTER * (Math.random() * 2 - 1);
      const delay = Math.round(baseDelay + jitter);

      this.log.info(
        `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS})...`,
      );
      await sleep(delay);

      if (!this.running) return;

      try {
        await this.connect();
      } catch (err) {
        this.log.error(`Reconnect failed: ${err instanceof Error ? err.message : err}`);
      }
    } finally {
      this.reconnectScheduled = false;
    }
  }

  // -------------------------------------------------------------------------
  // Message Processing
  // -------------------------------------------------------------------------

  private enqueueMessage(jid: string, text: string, messageId: string): void {
    const session = this.getOrCreateSession(jid);
    if (!session) {
      this.sendText(jid, 'Too many active sessions right now; please retry in a moment.').catch(
        () => {},
      );
      return;
    }
    if (session.queue.length >= MAX_SESSION_QUEUE) {
      session.droppedMessages = (session.droppedMessages ?? 0) + 1;
      this.log.warn(
        `Dropping message for ${jidToPhone(jid)}: session queue full (${MAX_SESSION_QUEUE}). Total dropped: ${session.droppedMessages}`,
      );
      this.sendText(
        jid,
        'You are sending messages too quickly. Please wait for the previous requests to complete.',
      ).catch(() => {});
      return;
    }

    session.queue.push({ text, jid, messageId });
    session.lastActivity = Date.now();

    if (!session.processing) {
      void this.processQueue(jid, session).catch((err) => {
        this.log.error(
          `Unhandled queue error for ${jidToPhone(jid)}: ${err instanceof Error ? err.message : err}`,
        );
      });
    }
  }

  private async processQueue(jid: string, session: SenderSession): Promise<void> {
    session.processing = true;

    while (session.queue.length > 0) {
      const item = session.queue.shift()!;
      try {
        await this.handleMessage(item.jid, item.text, session);
      } catch (err) {
        this.log.error(
          `Error processing message from ${jidToPhone(jid)}: ${err instanceof Error ? err.message : err}`,
        );
        await this.sendText(
          item.jid,
          'Sorry, something went wrong processing your message. Please try again.',
        );
      }
    }

    session.processing = false;
  }

  private async handleMessage(jid: string, text: string, session: SenderSession): Promise<void> {
    // Handle built-in commands
    const commandResponse = this.handleCommand(text, session);
    if (commandResponse !== null) {
      await this.sendText(jid, commandResponse);
      return;
    }

    try {
      await this.ensureAgentConnected(session, jid);
    } catch (err) {
      const errMsg = getErrorMessage(err);
      this.log.error(`Failed to connect agent for ${jidToPhone(jid)}: ${errMsg}`);
      await this.sendText(jid, 'I encountered an error processing your request. Please try again.');
      return;
    }

    // Send typing indicator
    await this.sendTyping(jid);

    // Send to agent
    let response: string;
    try {
      response = await session.agent.chat(text);
    } catch (err) {
      const errMsg = getErrorMessage(err);
      this.log.error(`Agent error for ${jidToPhone(jid)}: ${errMsg}`);
      response = 'I encountered an error processing your request. Please try again.';
    }

    // Format and send response
    const formatted = cleanForWhatsApp(response);
    const chunks = chunkMessage(formatted);

    for (const chunk of chunks) {
      await this.sendText(jid, chunk);
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
        '/help — Show this help message',
        '/reset — Clear conversation history',
        '/clear — Same as /reset',
        '/status — Show session info',
        '/model — Show or change model (alias or full model ID)',
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
        `Organization: ${this.orgId}`,
        `Model: ${session.agent.getModel()}`,
        `History: ${session.agent.getHistoryLength()} messages`,
        `Active sessions: ${this.sessions.size}`,
      ].join('\n');
    }

    const modelMatch = /^\/model(?:\s+(.*))?$/.exec(lower);
    if (modelMatch) {
      const arg = modelMatch[1] ? modelMatch[1].trim() : '';
      if (!arg) {
        return `Current model: ${session.agent.getModel()}`;
      }
      try {
        const resolved = resolveModelOrThrow(arg);
        session.agent.setModel(resolved);
        return `Model changed to: ${resolved}`;
      } catch {
        return formatUnknownModelError(arg);
      }
    }

    return null; // Not a command
  }

  // -------------------------------------------------------------------------
  // Session Management
  // -------------------------------------------------------------------------

  private getOrCreateSession(jid: string): SenderSession | null {
    const phone = jidToPhone(jid);
    let session = this.sessions.get(phone);
    const now = Date.now();

    if (session && now - session.lastActivity > SESSION_TTL_MS) {
      this.log.debug(`Expiring stale session for ${phone}`);
      session.agent.disconnect().catch(() => {});
      this.sessions.delete(phone);
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

      this.log.debug(`Creating new session for ${phone}`);
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
      session.connectPromise = this.connectAgent(agent, phone);
      this.sessions.set(phone, session);
    }

    session.lastActivity = Date.now();
    return session;
  }

  private connectAgent(agent: StateSetAgent, phone: string): Promise<void> {
    return agent.connect().catch((err) => {
      this.log.error(
        `Failed to connect agent for ${phone}: ${err instanceof Error ? err.message : err}`,
      );
      throw err;
    });
  }

  private async ensureAgentConnected(session: SenderSession, jid: string): Promise<void> {
    if (!session.connectPromise) {
      session.connectPromise = this.connectAgent(session.agent, jidToPhone(jid));
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

    for (const [phone, session] of candidates.slice(0, limit)) {
      this.log.debug(`Evicting inactive session for ${phone}`);
      session.agent.disconnect().catch(() => {});
      this.sessions.delete(phone);
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
    for (const [phone, session] of this.sessions) {
      if (now - session.lastActivity > SESSION_TTL_MS && !session.processing) {
        this.log.debug(`Cleaning up expired session for ${phone}`);
        session.agent.disconnect().catch(() => {});
        this.sessions.delete(phone);
      }
    }
    while (this.sessions.size > MAX_SESSIONS) {
      const before = this.sessions.size;
      this.evictOldestSessions();
      if (this.sessions.size >= before) break;
    }
    this.pruneSentMessageIds();
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  private async sendText(jid: string, text: string): Promise<void> {
    if (!this.sock) return;
    const outboundText = this.decorateOutgoing(text);
    try {
      const result = await this.sock.sendMessage(jid, { text: outboundText });
      const messageId = (result as { key?: { id?: string } })?.key?.id;
      if (messageId) {
        this.rememberSentMessage(messageId);
      }
    } catch (err) {
      this.log.error(
        `Failed to send message to ${jidToPhone(jid)}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private async sendTyping(jid: string): Promise<void> {
    if (!this.sock) return;
    try {
      await this.sock.sendPresenceUpdate('composing', jid);
    } catch {
      // Typing indicators are best-effort
    }
  }

  // -------------------------------------------------------------------------
  // Logging
  // -------------------------------------------------------------------------

  private readonly log = logger.child('whatsapp');

  private isAgentMessage(text: string): boolean {
    return text.trimStart().toLowerCase().startsWith(AGENT_MARKER_LOWER);
  }

  private decorateOutgoing(text: string): string {
    if (!this.selfChatOnly) return text;
    if (!text.trim()) return text;
    if (this.isAgentMessage(text)) return text;
    return `${AGENT_MARKER} ${text}`;
  }

  private isSelfChat(jid: string): boolean {
    if (!this.ownPhone) return false;
    return normalizePhone(jid) === this.ownPhone;
  }

  private isSentByGateway(messageId?: string): boolean {
    if (!messageId) return false;
    const sentAt = this.sentMessageIds.get(messageId);
    if (!sentAt) return false;
    if (Date.now() - sentAt > SENT_MESSAGE_TTL_MS) {
      this.sentMessageIds.delete(messageId);
      return false;
    }
    return true;
  }

  private rememberSentMessage(messageId: string): void {
    this.sentMessageIds.set(messageId, Date.now());
  }

  private pruneSentMessageIds(): void {
    const now = Date.now();
    for (const [id, ts] of this.sentMessageIds) {
      if (now - ts > SENT_MESSAGE_TTL_MS) {
        this.sentMessageIds.delete(id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Text Formatting
// ---------------------------------------------------------------------------

/**
 * Convert markdown to WhatsApp-friendly formatting.
 *
 * WhatsApp supports:
 *   *bold*, _italic_, ~strikethrough~, ```monospace```
 */
export function cleanForWhatsApp(text: string): string {
  let result = text;

  // Convert markdown headers to bold
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // Convert **bold** to *bold* (WhatsApp style)
  result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');

  // Convert __bold__ to *bold*
  result = result.replace(/__(.+?)__/g, '*$1*');

  // Convert ~~strike~~ to ~strike~ (already WhatsApp compatible)
  // No change needed

  // Convert markdown code blocks ```lang\n...\n``` to just ```...```
  result = result.replace(/```\w*\n/g, '```\n');

  // Convert inline `code` to plain text (WhatsApp doesn't support inline code well)
  // Only match single backticks, not triple backtick code fences
  result = result.replace(/(?<!`)`(?!`)([^`\n]+)`(?!`)/g, '$1');

  // Convert markdown links [text](url) to text (url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  // Convert markdown bullet lists
  result = result.replace(/^[-*]\s+/gm, '- ');

  // Convert numbered lists (already fine)

  // Remove horizontal rules
  result = result.replace(/^---+$/gm, '');

  // Clean up excessive blank lines
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}

/**
 * Split a message into chunks that fit within WhatsApp's size limit.
 * Splits at paragraph > sentence > word boundaries.
 */
export function chunkMessage(text: string, maxLength: number = MAX_WHATSAPP_LENGTH): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = -1;

    // Try to split at paragraph boundary
    const paraBreak = remaining.lastIndexOf('\n\n', maxLength);
    if (paraBreak > maxLength * MIN_CHUNK_RATIO) {
      splitIndex = paraBreak;
    }

    // Try to split at sentence boundary
    if (splitIndex === -1) {
      const slice = remaining.slice(0, maxLength);
      const sentenceMatch = slice.match(/.*[.!?]\s/s);
      if (sentenceMatch && sentenceMatch[0].length > maxLength * MIN_CHUNK_RATIO) {
        splitIndex = sentenceMatch[0].length;
      }
    }

    // Try to split at line boundary
    if (splitIndex === -1) {
      const lineBreak = remaining.lastIndexOf('\n', maxLength);
      if (lineBreak > maxLength * MIN_CHUNK_RATIO) {
        splitIndex = lineBreak;
      }
    }

    // Try to split at word boundary
    if (splitIndex === -1) {
      const wordBreak = remaining.lastIndexOf(' ', maxLength);
      if (wordBreak > maxLength * MIN_CHUNK_RATIO) {
        splitIndex = wordBreak;
      }
    }

    // Hard split as last resort
    if (splitIndex === -1) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Direct execution support
// ---------------------------------------------------------------------------

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('/gateway.ts') || process.argv[1].endsWith('/gateway.js'));

if (isDirectRun) {
  const gateway = new WhatsAppGateway();

  const shutdown = async () => {
    logger.info('Shutting down...');
    try {
      await gateway.stop();
    } finally {
      process.exitCode = 0;
    }
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });

  gateway.start().catch((err) => {
    logger.error('Gateway failed to start:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
