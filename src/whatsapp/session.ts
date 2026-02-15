import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// Baileys + auth are loaded dynamically since they are optional deps
type BaileysModule = typeof import('@whiskeysockets/baileys');

// Re-export a minimal socket type for consumers
export type WhatsAppSocket = {
  ev: { on: (event: string, handler: (...args: unknown[]) => void) => void };
  sendMessage: (jid: string, content: Record<string, unknown>) => Promise<unknown>;
  sendPresenceUpdate: (type: string, jid: string) => Promise<void>;
  end: (reason?: Error) => void;
  user?: { id: string };
  ws: { readyState: number };
};

const DEFAULT_AUTH_DIR = path.join(os.homedir(), '.stateset', 'whatsapp-auth');

/** Silent logger that satisfies Baileys' pino interface */
function makeSilentLogger() {
  const noop = () => silentLogger;
  const silentLogger: Record<string, unknown> = {
    level: 'silent',
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => makeSilentLogger(),
  };
  return silentLogger;
}

/** Verbose logger that prints to stderr */
function makeVerboseLogger() {
  const log =
    (level: string) =>
    (...args: unknown[]) => {
      const ts = new Date().toISOString();
      process.stderr.write(
        `[${ts}] [baileys:${level}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`,
      );
      return verboseLogger;
    };
  const verboseLogger: Record<string, unknown> = {
    level: 'debug',
    trace: log('trace'),
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    fatal: log('fatal'),
    child: () => makeVerboseLogger(),
  };
  return verboseLogger;
}

export interface CreateSocketOptions {
  authDir?: string;
  verbose?: boolean;
  onQr?: (qr: string) => void;
}

/**
 * Create a Baileys WhatsApp Web socket with persistent multi-file auth.
 */
export async function createWhatsAppSocket(
  options: CreateSocketOptions = {},
): Promise<WhatsAppSocket> {
  const authDir = options.authDir ?? DEFAULT_AUTH_DIR;

  // Ensure auth directory exists
  fs.mkdirSync(authDir, { recursive: true });
  try {
    fs.chmodSync(authDir, 0o700);
  } catch {
    /* best-effort */
  }

  // Dynamic import of optional dependency
  let baileys: BaileysModule;
  try {
    baileys = await import('@whiskeysockets/baileys');
  } catch {
    throw new Error(
      'WhatsApp gateway requires @whiskeysockets/baileys.\n' +
        'Install it with: npm install @whiskeysockets/baileys qrcode-terminal',
    );
  }

  const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
  } = baileys;

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const logger = options.verbose ? makeVerboseLogger() : makeSilentLogger();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger as never),
    },
    logger: logger as never,
    printQRInTerminal: false, // we handle QR ourselves
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
  });

  // Persist credentials on update
  sock.ev.on('creds.update' as never, saveCreds as never);

  // Handle QR codes
  sock.ev.on(
    'connection.update' as never,
    ((update: { qr?: string }) => {
      if (update.qr && options.onQr) {
        options.onQr(update.qr);
      }
    }) as never,
  );

  return sock as unknown as WhatsAppSocket;
}

/**
 * Wait for the socket connection to reach "open" state.
 * Rejects if the connection closes before opening.
 */
export function waitForConnection(sock: WhatsAppSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (update: {
      connection?: string;
      lastDisconnect?: { error?: { output?: { statusCode?: number } } };
    }) => {
      if (update.connection === 'open') {
        resolve();
      } else if (update.connection === 'close') {
        const code = getStatusCode(update.lastDisconnect);
        reject(new Error(`Connection closed before opening (code: ${code})`));
      }
    };
    sock.ev.on('connection.update', handler as never);
  });
}

/** Extract plain text from a Baileys message object */
export function extractText(message: Record<string, unknown> | undefined | null): string | null {
  if (!message) return null;

  const msg = message.message as Record<string, unknown> | undefined;
  if (!msg) return null;

  // Standard conversation
  if (typeof msg.conversation === 'string') return msg.conversation;

  // Extended text (quoted replies, links, etc.)
  const ext = msg.extendedTextMessage as Record<string, unknown> | undefined;
  if (ext && typeof ext.text === 'string') return ext.text;

  // Image/video/document captions
  for (const key of ['imageMessage', 'videoMessage', 'documentMessage']) {
    const media = msg[key] as Record<string, unknown> | undefined;
    if (media && typeof media.caption === 'string') return media.caption;
  }

  // Button response
  const btnResp = msg.buttonsResponseMessage as Record<string, unknown> | undefined;
  if (btnResp && typeof btnResp.selectedDisplayText === 'string')
    return btnResp.selectedDisplayText;

  // List response
  const listResp = msg.listResponseMessage as Record<string, unknown> | undefined;
  if (listResp && typeof listResp.title === 'string') return listResp.title;

  return null;
}

/** Convert a phone number to a WhatsApp JID */
export function toJid(phone: string): string {
  const cleaned = phone.replace(/[^0-9]/g, '');
  return `${cleaned}@s.whatsapp.net`;
}

/** Extract phone number from a WhatsApp JID */
export function jidToPhone(jid: string): string {
  return jid.replace(/@.*$/, '');
}

/** Check if a JID is a group chat */
export function isGroup(jid: string): boolean {
  return jid.endsWith('@g.us');
}

/** Extract status code from a Baileys disconnect event */
export function getStatusCode(lastDisconnect?: {
  error?: { output?: { statusCode?: number } };
}): number {
  return lastDisconnect?.error?.output?.statusCode ?? 0;
}

/** Clear stored auth credentials */
export function clearAuth(authDir?: string): void {
  const dir = authDir ?? DEFAULT_AUTH_DIR;
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Get DisconnectReason enum from Baileys */
export async function getDisconnectReason(): Promise<Record<string, number>> {
  try {
    const baileys = await import('@whiskeysockets/baileys');
    return baileys.DisconnectReason as unknown as Record<string, number>;
  } catch {
    // Fallback values if import fails
    return {
      connectionClosed: 428,
      connectionLost: 408,
      connectionReplaced: 440,
      timedOut: 408,
      loggedOut: 401,
      badSession: 500,
      restartRequired: 515,
    };
  }
}
