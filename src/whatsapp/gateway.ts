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
  getAnthropicApiKey,
  configExists,
  getCurrentOrg,
  resolveModel,
  getConfiguredModel,
  type ModelId,
} from '../config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SenderSession {
  agent: StateSetAgent;
  lastActivity: number;
  processing: boolean;
  queue: Array<{ text: string; jid: string; messageId: string }>;
}

export interface GatewayOptions {
  model?: string;
  allowList?: string[];
  allowGroups?: boolean;
  authDir?: string;
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_WHATSAPP_LENGTH = 4000;
const RECONNECT_INITIAL_MS = 2000;
const RECONNECT_MAX_MS = 30000;
const RECONNECT_FACTOR = 1.8;
const RECONNECT_JITTER = 0.25;
const RECONNECT_MAX_ATTEMPTS = 12;

// ---------------------------------------------------------------------------
// WhatsApp Gateway
// ---------------------------------------------------------------------------

export class WhatsAppGateway {
  private sessions = new Map<string, SenderSession>();
  private sock: WhatsAppSocket | null = null;
  private running = false;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private model: ModelId;
  private allowList: Set<string> | null;
  private allowGroups: boolean;
  private authDir?: string;
  private verbose: boolean;
  private ownJid: string | null = null;

  constructor(options: GatewayOptions = {}) {
    this.model = options.model
      ? resolveModel(options.model) ?? getConfiguredModel()
      : getConfiguredModel();
    this.allowList = options.allowList?.length
      ? new Set(options.allowList.map(p => p.replace(/[^0-9]/g, '')))
      : null;
    this.allowGroups = options.allowGroups ?? false;
    this.authDir = options.authDir;
    this.verbose = options.verbose ?? false;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    if (!configExists()) {
      throw new Error('No configuration found. Run "response auth login" first.');
    }

    // Validate credentials upfront
    getAnthropicApiKey();
    getCurrentOrg();

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

    // Close socket
    if (this.sock) {
      try { this.sock.end(); } catch { /* ignore */ }
      this.sock = null;
    }

    this.log('Gateway stopped.');
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  private async connect(): Promise<void> {
    this.log('Connecting to WhatsApp...');

    let qrTerminal: { generate: (qr: string, opts: Record<string, unknown>, cb: (code: string) => void) => void } | null = null;
    try {
      qrTerminal = (await import('qrcode-terminal')).default;
    } catch {
      // qrcode-terminal not available; print raw QR string
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
      this.log(`Connected as ${this.ownJid ?? 'unknown'}`);
    } catch (err) {
      this.log(`Initial connection failed: ${err instanceof Error ? err.message : err}`);
      if (this.running) {
        await this.scheduleReconnect();
      }
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
        this.log(`Connection closed (code: ${code})`);

        const reasons = await getDisconnectReason();
        if (code === reasons.loggedOut) {
          this.log('Logged out — cannot reconnect. Clear auth and re-scan QR.');
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

        // Skip own messages
        if (key.fromMe) continue;

        // Skip self-chat (message from own number)
        if (this.ownJid && jidToPhone(key.remoteJid) === jidToPhone(this.ownJid)) continue;

        const jid = key.remoteJid;

        // Group filtering
        if (isGroup(jid) && !this.allowGroups) continue;

        // Allowlist filtering
        const phone = jidToPhone(jid);
        if (this.allowList && !this.allowList.has(phone)) {
          this.debugLog(`Filtered message from ${phone} (not in allowlist)`);
          continue;
        }

        const text = extractText(msg);
        if (!text || text.trim().length === 0) continue;

        this.debugLog(`Message from ${phone}: ${text.substring(0, 80)}...`);
        this.enqueueMessage(jid, text.trim(), key.id ?? '');
      }
    }) as never);
  }

  // -------------------------------------------------------------------------
  // Reconnection with exponential backoff
  // -------------------------------------------------------------------------

  private async scheduleReconnect(): Promise<void> {
    if (!this.running) return;

    this.reconnectAttempts++;
    if (this.reconnectAttempts > RECONNECT_MAX_ATTEMPTS) {
      this.log(`Max reconnect attempts (${RECONNECT_MAX_ATTEMPTS}) reached. Stopping.`);
      this.running = false;
      return;
    }

    const baseDelay = Math.min(
      RECONNECT_INITIAL_MS * Math.pow(RECONNECT_FACTOR, this.reconnectAttempts - 1),
      RECONNECT_MAX_MS,
    );
    const jitter = baseDelay * RECONNECT_JITTER * (Math.random() * 2 - 1);
    const delay = Math.round(baseDelay + jitter);

    this.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS})...`);
    await sleep(delay);

    if (!this.running) return;

    try {
      await this.connect();
    } catch (err) {
      this.log(`Reconnect failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // -------------------------------------------------------------------------
  // Message Processing
  // -------------------------------------------------------------------------

  private enqueueMessage(jid: string, text: string, messageId: string): void {
    const session = this.getOrCreateSession(jid);
    session.queue.push({ text, jid, messageId });
    session.lastActivity = Date.now();

    if (!session.processing) {
      this.processQueue(jid, session);
    }
  }

  private async processQueue(jid: string, session: SenderSession): Promise<void> {
    session.processing = true;

    while (session.queue.length > 0) {
      const item = session.queue.shift()!;
      try {
        await this.handleMessage(item.jid, item.text, session);
      } catch (err) {
        this.log(`Error processing message from ${jidToPhone(jid)}: ${err instanceof Error ? err.message : err}`);
        await this.sendText(item.jid, 'Sorry, something went wrong processing your message. Please try again.');
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

    // Send typing indicator
    await this.sendTyping(jid);

    // Send to agent
    let response: string;
    try {
      response = await session.agent.chat(text);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log(`Agent error for ${jidToPhone(jid)}: ${errMsg}`);
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
        '/model — Show or change model',
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
      const { orgId } = getCurrentOrg();
      return [
        '*Session Status*',
        `Organization: ${orgId}`,
        `Model: ${session.agent.getModel()}`,
        `History: ${session.agent.getHistoryLength()} messages`,
        `Active sessions: ${this.sessions.size}`,
      ].join('\n');
    }

    if (lower.startsWith('/model')) {
      const arg = text.slice(6).trim();
      if (!arg) {
        return `Current model: ${session.agent.getModel()}`;
      }
      const resolved = resolveModel(arg);
      if (!resolved) {
        return `Unknown model "${arg}". Valid: sonnet, haiku, opus`;
      }
      session.agent.setModel(resolved);
      return `Model changed to: ${resolved}`;
    }

    return null; // Not a command
  }

  // -------------------------------------------------------------------------
  // Session Management
  // -------------------------------------------------------------------------

  private getOrCreateSession(jid: string): SenderSession {
    const phone = jidToPhone(jid);
    let session = this.sessions.get(phone);

    if (!session) {
      this.debugLog(`Creating new session for ${phone}`);
      const apiKey = getAnthropicApiKey();
      const agent = new StateSetAgent(apiKey, this.model);

      // Connect agent asynchronously — it will be ready by the time we need it
      // since the queue processing is also async
      agent.connect().catch(err => {
        this.log(`Failed to connect agent for ${phone}: ${err instanceof Error ? err.message : err}`);
      });

      session = {
        agent,
        lastActivity: Date.now(),
        processing: false,
        queue: [],
      };
      this.sessions.set(phone, session);
    }

    session.lastActivity = Date.now();
    return session;
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => this.cleanupSessions(), CLEANUP_INTERVAL_MS);
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
        this.debugLog(`Cleaning up expired session for ${phone}`);
        session.agent.disconnect().catch(() => {});
        this.sessions.delete(phone);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  private async sendText(jid: string, text: string): Promise<void> {
    if (!this.sock) return;
    try {
      await this.sock.sendMessage(jid, { text });
    } catch (err) {
      this.log(`Failed to send message to ${jidToPhone(jid)}: ${err instanceof Error ? err.message : err}`);
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

  private log(message: string): void {
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`[${ts}] ${message}`);
  }

  private debugLog(message: string): void {
    if (this.verbose) {
      this.log(`[debug] ${message}`);
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
  // Keep backticks as-is since WhatsApp renders ```monospace```
  result = result.replace(/`([^`]+)`/g, '$1');

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
    if (paraBreak > maxLength * 0.3) {
      splitIndex = paraBreak;
    }

    // Try to split at sentence boundary
    if (splitIndex === -1) {
      const slice = remaining.slice(0, maxLength);
      const sentenceMatch = slice.match(/.*[.!?]\s/s);
      if (sentenceMatch && sentenceMatch[0].length > maxLength * 0.3) {
        splitIndex = sentenceMatch[0].length;
      }
    }

    // Try to split at line boundary
    if (splitIndex === -1) {
      const lineBreak = remaining.lastIndexOf('\n', maxLength);
      if (lineBreak > maxLength * 0.3) {
        splitIndex = lineBreak;
      }
    }

    // Try to split at word boundary
    if (splitIndex === -1) {
      const wordBreak = remaining.lastIndexOf(' ', maxLength);
      if (wordBreak > maxLength * 0.3) {
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
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Direct execution support
// ---------------------------------------------------------------------------

const isDirectRun = process.argv[1] &&
  (process.argv[1].endsWith('/gateway.ts') || process.argv[1].endsWith('/gateway.js'));

if (isDirectRun) {
  const gateway = new WhatsAppGateway();

  const shutdown = async () => {
    console.log('\nShutting down...');
    await gateway.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  gateway.start().catch(err => {
    console.error('Gateway failed to start:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
