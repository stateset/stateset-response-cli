import { Cron } from 'croner';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  lstatSync,
  statSync,
  unlinkSync,
  watch,
  type FSWatcher,
} from 'node:fs';
import path from 'node:path';
import { logger } from './lib/logger.js';
import {
  getConfiguredModel,
  getAnthropicApiKey,
  getRuntimeContext,
  type RuntimeContext,
  type ModelId,
} from './config.js';
import { StateSetAgent, type ChatCallbacks } from './agent.js';
import { SessionStore, getStateSetDir, sanitizeSessionId } from './session.js';
import { buildSystemPrompt } from './prompt.js';
import { loadMemory } from './memory.js';
import { formatUsage } from './utils/display.js';
import { readTextFile, MAX_TEXT_FILE_SIZE_BYTES } from './utils/file-read.js';
import { getErrorMessage } from './lib/errors.js';

const DEBOUNCE_MS = 100;
const RETRY_BASE_MS = 100;
const SESSION_RUNNER_TTL_MS = 15 * 60_000;
const SESSION_RUNNER_MAX_COUNT = 200;
const SESSION_RUNNER_MAX_PENDING = 32;
const SESSION_RUNNER_CLEANUP_MS = 5 * 60_000;
const ONE_SHOT_POLL_MS = 1000;
const MAX_EVENT_FILE_SIZE_BYTES = 1_048_576;
const EVENT_RETRY_DELAY_MS = 1000;
const WATCHER_RESTART_DELAY_MS = 2000;

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
  anthropicApiKey?: string;
  mcpEnvOverrides?: Record<string, string>;
}

/** Validates and parses a JSON string into a typed ResponseEvent, throwing on invalid input. */
export function parseEvent(content: string, filename: string): ResponseEvent {
  if (Buffer.byteLength(content, 'utf-8') > MAX_EVENT_FILE_SIZE_BYTES) {
    throw new Error(`Event file too large in ${filename}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (e) {
    throw new Error(`Invalid JSON in event file ${filename}: ${getErrorMessage(e)}`);
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

interface ScheduledOneShot {
  event: ResponseEvent & { type: 'one-shot' };
  at: number;
}

class SessionAgentRunner {
  private agent: StateSetAgent;
  private store: SessionStore;
  private connected = false;
  private lastUsedAt = Date.now();
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private showUsage: boolean;
  private stdout: boolean;
  private mcpEnvOverrides: Record<string, string>;

  constructor(
    sessionId: string,
    model: ModelId,
    showUsage: boolean,
    stdout: boolean,
    apiKey: string,
    mcpEnvOverrides: Record<string, string>,
  ) {
    this.store = new SessionStore(sessionId);
    this.agent = new StateSetAgent(apiKey, model);
    this.agent.useSessionStore(this.store);
    this.mcpEnvOverrides = mcpEnvOverrides;
    this.agent.setMcpEnvOverrides(mcpEnvOverrides);
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

  touch(): void {
    this.lastUsedAt = Date.now();
  }

  getLastUsedAt(): number {
    return this.lastUsedAt;
  }

  isIdle(): boolean {
    return this.pending === 0;
  }

  enqueue(event: QueuedEvent): boolean {
    if (this.pending >= SESSION_RUNNER_MAX_PENDING) {
      logger.warn(
        `Queue saturated for session ${this.store.getSessionId()} (${SESSION_RUNNER_MAX_PENDING} events).`,
      );
      return false;
    }

    this.queue = this.queue
      .then(() => this.run(event))
      .catch((err) => {
        const msg = getErrorMessage(err);
        logger.error(`Event error (${this.store.getSessionId()}): ${msg}`);
      })
      .finally(() => {
        this.pending = Math.max(0, this.pending - 1);
        this.touch();
      });
    this.pending += 1;
    this.touch();
    return true;
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
  private watcherRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private knownFiles = new Set<string>();
  private oneShots = new Map<string, ScheduledOneShot>();
  private crons = new Map<string, Cron>();
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private executionRetryTimers = new Map<string, NodeJS.Timeout>();
  private sessionCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private oneShotTimer: ReturnType<typeof setInterval> | null = null;
  private startTime: number;
  private options: EventsRunnerOptions;
  private anthropicApiKey: string;
  private sessionRunners = new Map<string, SessionAgentRunner>();
  private mcpEnvOverrides: Record<string, string>;
  private running = false;

  constructor(options: EventsRunnerOptions) {
    this.options = options;
    this.startTime = Date.now();
    this.eventsDir = path.join(getStateSetDir(), 'events');
    this.anthropicApiKey = options.anthropicApiKey ?? getAnthropicApiKey();
    this.mcpEnvOverrides = options.mcpEnvOverrides ? { ...options.mcpEnvOverrides } : {};
  }

  start(): void {
    if (this.running) {
      return;
    }

    if (!existsSync(this.eventsDir)) {
      mkdirSync(this.eventsDir, { recursive: true, mode: 0o700 });
    }

    this.running = true;
    void this.scanExisting();
    this.startSessionCleanup();
    this.startWatcher();

    logger.info(`Events watcher started: ${this.eventsDir}`);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.stopSessionCleanup();
    this.stopWatcherRestartTimer();

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    for (const timer of this.executionRetryTimers.values()) {
      clearTimeout(timer);
    }
    this.executionRetryTimers.clear();

    this.oneShots.clear();
    this.stopOneShotPoller();

    for (const cron of this.crons.values()) {
      cron.stop();
    }
    this.crons.clear();

    await this.cleanupSessionRunners(true);
  }

  private startSessionCleanup(): void {
    if (this.sessionCleanupTimer) return;
    this.sessionCleanupTimer = setInterval(() => {
      void this.cleanupSessionRunners().catch((error) => {
        logger.error(`Failed to cleanup session runners: ${getErrorMessage(error)}`);
      });
    }, SESSION_RUNNER_CLEANUP_MS);
  }

  private startWatcher(): void {
    try {
      this.watcher = watch(this.eventsDir, (_eventType, filename) => {
        const nextFilename = typeof filename === 'string' ? filename : String(filename ?? '');
        if (!nextFilename || !nextFilename.endsWith('.json')) return;
        this.debounce(nextFilename, () => this.handleFileChange(nextFilename));
      });
    } catch (error) {
      this.handleWatcherError(error);
      return;
    }

    this.watcher.on('error', (error) => {
      this.handleWatcherError(error);
    });
  }

  private handleWatcherError(error: unknown): void {
    logger.error(`Events watcher error: ${getErrorMessage(error)}`);

    if (!this.running) {
      return;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    this.scheduleWatcherRestart();
  }

  private scheduleWatcherRestart(): void {
    if (this.watcherRestartTimer) {
      return;
    }

    this.watcherRestartTimer = setTimeout(() => {
      this.watcherRestartTimer = null;
      if (!this.running) {
        return;
      }

      logger.info(`Restarting events watcher: ${this.eventsDir}`);
      this.startWatcher();
    }, WATCHER_RESTART_DELAY_MS);
  }

  private stopWatcherRestartTimer(): void {
    if (!this.watcherRestartTimer) {
      return;
    }
    clearTimeout(this.watcherRestartTimer);
    this.watcherRestartTimer = null;
  }

  private startOneShotPoller(): void {
    if (this.oneShotTimer) {
      return;
    }
    this.oneShotTimer = setInterval(() => {
      this.processOneShots();
    }, ONE_SHOT_POLL_MS);
  }

  private stopOneShotPoller(): void {
    if (!this.oneShotTimer) {
      return;
    }
    clearInterval(this.oneShotTimer);
    this.oneShotTimer = null;
  }

  private processOneShots(): void {
    if (this.oneShots.size === 0) {
      this.stopOneShotPoller();
      return;
    }

    const now = Date.now();
    const due: string[] = [];
    for (const [filename, scheduled] of this.oneShots.entries()) {
      if (scheduled.at <= now) {
        due.push(filename);
      }
    }

    for (const filename of due) {
      const scheduled = this.oneShots.get(filename);
      if (!scheduled) continue;
      this.oneShots.delete(filename);
      this.execute(filename, scheduled.event, true);
    }
  }

  private stopSessionCleanup(): void {
    if (this.sessionCleanupTimer) {
      clearInterval(this.sessionCleanupTimer);
      this.sessionCleanupTimer = null;
    }
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
      void this.handleFile(filename).catch((err) => {
        const msg = getErrorMessage(err);
        logger.error(`Failed to process event file ${filename}: ${msg}`);
      });
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

    void this.handleFile(filename).catch((err) => {
      const msg = getErrorMessage(err);
      logger.error(`Failed to process event file ${filename}: ${msg}`);
    });
  }

  private handleDelete(filename: string): void {
    if (!this.knownFiles.has(filename)) return;
    const timer = this.debounceTimers.get(filename);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(filename);
    }
    this.clearExecutionRetry(filename);
    this.cancelScheduled(filename);
    this.knownFiles.delete(filename);
  }

  private cancelScheduled(filename: string): void {
    if (this.oneShots.has(filename)) {
      this.oneShots.delete(filename);
    }

    const cron = this.crons.get(filename);
    if (cron) {
      cron.stop();
      this.crons.delete(filename);
    }
  }

  private async handleFile(filename: string): Promise<void> {
    const filePath = path.join(this.eventsDir, filename);
    let stats: ReturnType<typeof lstatSync>;

    try {
      stats = lstatSync(filePath);
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`Skipping unsafe event file: ${filename}`);
    }
    if (stats.size > MAX_EVENT_FILE_SIZE_BYTES) {
      throw new Error(`Event file too large: ${filename} (${stats.size} bytes)`);
    }

    let event: ResponseEvent | null = null;
    let lastError: Error | null = null;

    for (let i = 0; i < 3; i++) {
      try {
        const content = readTextFile(filePath, {
          label: `event file ${filename}`,
          maxBytes: Math.min(MAX_EVENT_FILE_SIZE_BYTES, MAX_TEXT_FILE_SIZE_BYTES),
        });
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

    this.scheduleOneShot(filename, event, atTime);
  }

  private scheduleOneShot(
    filename: string,
    event: ResponseEvent & { type: 'one-shot' },
    atTime: number,
  ): void {
    if (atTime <= Date.now()) {
      this.execute(filename, event, true);
      return;
    }

    this.oneShots.set(filename, { event, at: atTime });
    this.startOneShotPoller();
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
    void this.cleanupSessionRunners().catch((error) => {
      logger.error(`Failed to cleanup session runners: ${getErrorMessage(error)}`);
    });
    const sessionId = sanitizeSessionId(event.session || this.options.defaultSession);
    const runner = this.getSessionRunner(sessionId);
    if (!runner) {
      this.scheduleExecutionRetry(
        filename,
        event,
        deleteAfter,
        `Event session runner limit reached (${SESSION_RUNNER_MAX_COUNT}) for session ${sessionId}`,
      );
      return;
    }

    runner.touch();
    const accepted = runner.enqueue({ filename, event });
    if (!accepted) {
      this.scheduleExecutionRetry(
        filename,
        event,
        deleteAfter,
        `Queue saturated for session ${sessionId} while executing ${filename}`,
      );
      return;
    }

    if (deleteAfter) {
      this.deleteFile(filename);
    }
  }

  private scheduleExecutionRetry(
    filename: string,
    event: ResponseEvent,
    deleteAfter: boolean,
    reason: string,
  ): void {
    if (!this.running || this.executionRetryTimers.has(filename)) {
      return;
    }

    logger.warn(`${reason}; retrying in ${EVENT_RETRY_DELAY_MS}ms.`);
    const timer = setTimeout(() => {
      this.executionRetryTimers.delete(filename);
      if (!this.running) {
        return;
      }
      this.execute(filename, event, deleteAfter);
    }, EVENT_RETRY_DELAY_MS);
    this.executionRetryTimers.set(filename, timer);
  }

  private clearExecutionRetry(filename: string): void {
    const timer = this.executionRetryTimers.get(filename);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.executionRetryTimers.delete(filename);
  }

  private getSessionRunner(sessionId: string): SessionAgentRunner | null {
    const existing = this.sessionRunners.get(sessionId);
    if (existing) {
      existing.touch();
      return existing;
    }

    if (this.sessionRunners.size >= SESSION_RUNNER_MAX_COUNT) {
      const evicted = this.evictOldestIdleRunner();
      if (!evicted) {
        return null;
      }
    }

    const model = this.options.model ?? getConfiguredModel();
    const runner = new SessionAgentRunner(
      sessionId,
      model,
      Boolean(this.options.showUsage),
      Boolean(this.options.stdout),
      this.anthropicApiKey,
      this.mcpEnvOverrides,
    );
    this.sessionRunners.set(sessionId, runner);
    return runner;
  }

  private evictOldestIdleRunner(): boolean {
    const candidates = [...this.sessionRunners.entries()]
      .filter(([, runner]) => runner.isIdle())
      .sort((a, b) => a[1].getLastUsedAt() - b[1].getLastUsedAt());

    const candidate = candidates[0];
    if (!candidate) {
      return false;
    }

    const [sessionId, runner] = candidate;
    this.sessionRunners.delete(sessionId);
    void runner.disconnect().catch((error) => {
      const msg = getErrorMessage(error);
      logger.error(`Failed to disconnect idle runner ${sessionId}: ${msg}`);
    });
    return true;
  }

  private async cleanupSessionRunners(force = false): Promise<void> {
    if (force) {
      const disconnects: Promise<void>[] = [];
      for (const [sessionId, runner] of this.sessionRunners.entries()) {
        this.sessionRunners.delete(sessionId);
        disconnects.push(runner.disconnect());
      }
      await Promise.all(disconnects);
      return;
    }

    const expiredSessions: string[] = [];
    const now = Date.now();
    for (const [sessionId, runner] of this.sessionRunners.entries()) {
      if (!runner.isIdle()) continue;
      if (now - runner.getLastUsedAt() <= SESSION_RUNNER_TTL_MS) continue;
      expiredSessions.push(sessionId);
    }

    await this.evictSessionRunners(expiredSessions);
    await this.enforceSessionRunnerLimit();
  }

  private async evictSessionRunners(sessionIds: string[]): Promise<void> {
    const disconnects: Promise<void>[] = [];

    for (const sessionId of sessionIds) {
      const runner = this.sessionRunners.get(sessionId);
      if (!runner || !runner.isIdle()) continue;
      this.sessionRunners.delete(sessionId);
      disconnects.push(
        runner.disconnect().catch((error) => {
          const msg = getErrorMessage(error);
          logger.error(`Failed to disconnect idle runner ${sessionId}: ${msg}`);
        }),
      );
    }

    await Promise.all(disconnects);
  }

  private async enforceSessionRunnerLimit(): Promise<void> {
    if (this.sessionRunners.size <= SESSION_RUNNER_MAX_COUNT) {
      return;
    }

    const excess = this.sessionRunners.size - SESSION_RUNNER_MAX_COUNT;
    const idleSessions = [...this.sessionRunners.entries()]
      .filter(([, runner]) => runner.isIdle())
      .sort((a, b) => a[1].getLastUsedAt() - b[1].getLastUsedAt())
      .slice(0, excess)
      .map(([sessionId]) => sessionId);

    if (idleSessions.length > 0) {
      await this.evictSessionRunners(idleSessions);
      return;
    }

    if (excess > 0) {
      logger.warn(`Event session runner limit reached (${SESSION_RUNNER_MAX_COUNT}).`);
    }
  }

  private deleteFile(filename: string): void {
    this.clearExecutionRetry(filename);
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
export function validateEventsPrereqs(): RuntimeContext {
  return getRuntimeContext();
}
