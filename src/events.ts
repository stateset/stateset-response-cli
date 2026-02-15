import { Cron } from 'croner';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  watch,
  type FSWatcher,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from './lib/logger.js';
import { getAnthropicApiKey, getConfiguredModel, getCurrentOrg, type ModelId } from './config.js';
import { StateSetAgent, type ChatCallbacks } from './agent.js';
import { SessionStore, getStateSetDir, sanitizeSessionId } from './session.js';
import { buildSystemPrompt } from './prompt.js';
import { loadMemory } from './memory.js';
import { formatUsage } from './utils/display.js';

const DEBOUNCE_MS = 100;
const RETRY_BASE_MS = 100;

/** An event that triggers an agent run: immediately, at a specific time, or on a cron schedule. */
export type ResponseEvent =
  | { type: 'immediate'; text: string; session?: string }
  | { type: 'one-shot'; text: string; at: string; session?: string }
  | { type: 'periodic'; text: string; schedule: string; timezone: string; session?: string };

/** Configuration for the events runner: model override, fallback session, and output flags. */
export interface EventsRunnerOptions {
  model?: ModelId;
  defaultSession: string;
  showUsage?: boolean;
  stdout?: boolean;
}

/** Validates and parses a JSON string into a typed ResponseEvent, throwing on invalid input. */
export function parseEvent(content: string, filename: string): ResponseEvent {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (e) {
    throw new Error(
      `Invalid JSON in event file ${filename}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid event data in ${filename}`);
  }
  const data = raw as Record<string, unknown>;

  if (!data.type || typeof data.text !== 'string') {
    throw new Error(`Missing required fields (type, text) in ${filename}`);
  }

  const session = typeof data.session === 'string' ? data.session : undefined;

  switch (data.type) {
    case 'immediate':
      return { type: 'immediate', text: data.text, session };
    case 'one-shot': {
      if (typeof data.at !== 'string') {
        throw new Error(`Missing 'at' for one-shot event in ${filename}`);
      }
      return { type: 'one-shot', text: data.text, at: data.at, session };
    }
    case 'periodic': {
      if (typeof data.schedule !== 'string')
        throw new Error(`Missing 'schedule' for periodic event in ${filename}`);
      if (typeof data.timezone !== 'string')
        throw new Error(`Missing 'timezone' for periodic event in ${filename}`);
      return {
        type: 'periodic',
        text: data.text,
        schedule: data.schedule,
        timezone: data.timezone,
        session,
      };
    }
    default:
      throw new Error(`Unknown event type "${String(data.type)}" in ${filename}`);
  }
}

interface QueuedEvent {
  filename: string;
  event: ResponseEvent;
}

class SessionAgentRunner {
  private agent: StateSetAgent;
  private store: SessionStore;
  private connected = false;
  private queue: Promise<void> = Promise.resolve();
  private showUsage: boolean;
  private stdout: boolean;

  constructor(sessionId: string, model: ModelId, showUsage: boolean, stdout: boolean) {
    this.store = new SessionStore(sessionId);
    this.agent = new StateSetAgent(getAnthropicApiKey(), model);
    this.agent.useSessionStore(this.store);
    this.showUsage = showUsage;
    this.stdout = stdout;
  }

  async ensureConnected(): Promise<void> {
    if (this.connected) return;
    await this.agent.connect();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.agent.disconnect();
    this.connected = false;
  }

  enqueue(event: QueuedEvent): void {
    this.queue = this.queue
      .then(() => this.run(event))
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`Event error (${this.store.getSessionId()}): ${msg}`);
      });
  }

  private async run({ filename, event }: QueuedEvent): Promise<void> {
    await this.ensureConnected();

    const sessionId = this.store.getSessionId();
    const memory = loadMemory(sessionId);
    const systemPrompt = buildSystemPrompt({ sessionId, memory });
    this.agent.setSystemPrompt(systemPrompt);

    const scheduleInfo =
      event.type === 'one-shot'
        ? event.at
        : event.type === 'periodic'
          ? event.schedule
          : 'immediate';

    const message = `[EVENT:${filename}:${event.type}:${scheduleInfo}] ${event.text}`;

    let usageSummary = '';
    const callbacks: ChatCallbacks = {
      onUsage: (usage) => {
        if (this.showUsage) {
          usageSummary = formatUsage(usage);
        }
      },
    };

    const response = await this.agent.chat(message, callbacks);
    const output = response.trim();
    const silent = output.startsWith('[SILENT]');

    logEventResult({
      session: sessionId,
      filename,
      event,
      response: output,
      silent,
      usage: usageSummary || null,
    });

    if (this.stdout) {
      if (!silent) {
        console.log(`\n[EVENT:${filename}] (${sessionId})\n${output}\n`);
      }
      if (usageSummary) {
        console.log(`  ${usageSummary}`);
      }
    }
  }
}

/**
 * Watches ~/.stateset/events/ for JSON event files and schedules agent runs.
 * Supports immediate execution, one-shot timers, and cron-based periodic runs.
 */
export class EventsRunner {
  private eventsDir: string;
  private watcher: FSWatcher | null = null;
  private knownFiles = new Set<string>();
  private timers = new Map<string, NodeJS.Timeout>();
  private crons = new Map<string, Cron>();
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private startTime: number;
  private options: EventsRunnerOptions;
  private sessionRunners = new Map<string, SessionAgentRunner>();

  constructor(options: EventsRunnerOptions) {
    this.options = options;
    this.startTime = Date.now();
    this.eventsDir = path.join(getStateSetDir(), 'events');
  }

  start(): void {
    if (!existsSync(this.eventsDir)) {
      mkdirSync(this.eventsDir, { recursive: true, mode: 0o700 });
    }

    this.scanExisting();

    this.watcher = watch(this.eventsDir, (_eventType, filename) => {
      if (!filename || !filename.endsWith('.json')) return;
      this.debounce(filename, () => this.handleFileChange(filename));
    });

    logger.info(`Events watcher started: ${this.eventsDir}`);
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    for (const cron of this.crons.values()) {
      cron.stop();
    }
    this.crons.clear();

    const disconnects: Promise<void>[] = [];
    for (const runner of this.sessionRunners.values()) {
      disconnects.push(runner.disconnect());
    }
    await Promise.all(disconnects);
    this.sessionRunners.clear();
  }

  private debounce(filename: string, fn: () => void): void {
    const existing = this.debounceTimers.get(filename);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(
      filename,
      setTimeout(() => {
        this.debounceTimers.delete(filename);
        fn();
      }, DEBOUNCE_MS),
    );
  }

  private scanExisting(): void {
    let files: string[] = [];
    try {
      files = readdirSync(this.eventsDir).filter((f) => f.endsWith('.json'));
    } catch {
      return;
    }

    for (const filename of files) {
      this.handleFile(filename);
    }
  }

  private handleFileChange(filename: string): void {
    const filePath = path.join(this.eventsDir, filename);

    if (!existsSync(filePath)) {
      this.handleDelete(filename);
      return;
    }

    if (this.knownFiles.has(filename)) {
      this.cancelScheduled(filename);
    }

    this.handleFile(filename);
  }

  private handleDelete(filename: string): void {
    if (!this.knownFiles.has(filename)) return;
    this.cancelScheduled(filename);
    this.knownFiles.delete(filename);
  }

  private cancelScheduled(filename: string): void {
    const timer = this.timers.get(filename);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(filename);
    }

    const cron = this.crons.get(filename);
    if (cron) {
      cron.stop();
      this.crons.delete(filename);
    }
  }

  private async handleFile(filename: string): Promise<void> {
    const filePath = path.join(this.eventsDir, filename);
    let event: ResponseEvent | null = null;
    let lastError: Error | null = null;

    for (let i = 0; i < 3; i++) {
      try {
        const content = await readFile(filePath, 'utf-8');
        event = this.parseEvent(content, filename);
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (i < 2) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * 2 ** i));
        }
      }
    }

    if (!event) {
      logger.error(`Failed to parse event file: ${filename}`, { error: lastError?.message ?? '' });
      this.deleteFile(filename);
      return;
    }

    this.knownFiles.add(filename);

    switch (event.type) {
      case 'immediate':
        this.handleImmediate(filename, event);
        break;
      case 'one-shot':
        this.handleOneShot(filename, event);
        break;
      case 'periodic':
        this.handlePeriodic(filename, event);
        break;
    }
  }

  private parseEvent(content: string, filename: string): ResponseEvent {
    return parseEvent(content, filename);
  }

  private handleImmediate(filename: string, event: ResponseEvent & { type: 'immediate' }): void {
    const filePath = path.join(this.eventsDir, filename);

    try {
      const stat = statSync(filePath);
      if (stat.mtimeMs < this.startTime) {
        this.deleteFile(filename);
        return;
      }
    } catch {
      return;
    }

    this.execute(filename, event, true);
  }

  private handleOneShot(filename: string, event: ResponseEvent & { type: 'one-shot' }): void {
    const atTime = new Date(event.at).getTime();
    const now = Date.now();

    if (!Number.isFinite(atTime) || atTime <= now) {
      this.deleteFile(filename);
      return;
    }

    const timer = setTimeout(() => {
      this.timers.delete(filename);
      this.execute(filename, event, true);
    }, atTime - now);

    this.timers.set(filename, timer);
  }

  private handlePeriodic(filename: string, event: ResponseEvent & { type: 'periodic' }): void {
    try {
      const cron = new Cron(event.schedule, { timezone: event.timezone }, () => {
        this.execute(filename, event, false);
      });
      this.crons.set(filename, cron);
    } catch {
      logger.error(`Invalid cron schedule for ${filename}: ${event.schedule}`);
      this.deleteFile(filename);
    }
  }

  private execute(filename: string, event: ResponseEvent, deleteAfter: boolean): void {
    const sessionId = sanitizeSessionId(event.session || this.options.defaultSession);
    const runner = this.getSessionRunner(sessionId);
    runner.enqueue({ filename, event });

    if (deleteAfter) {
      this.deleteFile(filename);
    }
  }

  private getSessionRunner(sessionId: string): SessionAgentRunner {
    const existing = this.sessionRunners.get(sessionId);
    if (existing) return existing;

    const model = this.options.model ?? getConfiguredModel();
    const runner = new SessionAgentRunner(
      sessionId,
      model,
      Boolean(this.options.showUsage),
      Boolean(this.options.stdout),
    );
    this.sessionRunners.set(sessionId, runner);
    return runner;
  }

  private deleteFile(filename: string): void {
    const filePath = path.join(this.eventsDir, filename);
    try {
      unlinkSync(filePath);
    } catch {
      // ignore
    }
    this.knownFiles.delete(filename);
  }
}

function logEventResult(entry: {
  session: string;
  filename: string;
  event: ResponseEvent;
  response: string;
  silent: boolean;
  usage: string | null;
}) {
  const logDir = path.join(getStateSetDir(), 'events');
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true, mode: 0o700 });
  }

  const logPath = path.join(logDir, 'log.jsonl');
  const payload = {
    ts: new Date().toISOString(),
    session: entry.session,
    filename: entry.filename,
    event: entry.event,
    response: entry.response,
    silent: entry.silent,
    usage: entry.usage,
  };
  const line = JSON.stringify(payload);
  try {
    appendFileSync(logPath, line + '\n', 'utf-8');
  } catch {
    // ignore logging failures
  }
}

/** Validates that org credentials and an Anthropic API key are configured before starting the runner. */
export function validateEventsPrereqs(): void {
  getCurrentOrg();
  getAnthropicApiKey();
}
