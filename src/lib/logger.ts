/**
 * Structured logging module for StateSet Response CLI
 *
 * Features:
 * - Log levels (silent, error, warn, info, debug, trace)
 * - Correlation IDs for request tracing
 * - TTY detection (human-readable for terminal, JSON for pipes)
 * - Configurable log level
 * - Sensitive value redaction
 * - Performance timers
 * - Subsystem-scoped child loggers
 */

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  silent: 99,
  error: 4,
  warn: 3,
  info: 2,
  debug: 1,
  trace: 0,
};

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  silent: '',
  error: '\x1b[31m', // red
  warn: '\x1b[33m', // yellow
  info: '\x1b[32m', // green
  debug: '\x1b[36m', // cyan
  trace: '\x1b[90m', // dim
};

const RESET = '\x1b[0m';

const SENSITIVE_PATTERN =
  /(?:secret|token|password|api[-_]?key|authorization|credential|bearer|admin[-_]?secret)/i;

function redactContextValue(key: string, value: unknown): unknown {
  if (SENSITIVE_PATTERN.test(key)) {
    return '[redacted]';
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => redactContextValue(String(i), v));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactContextValue(k, v);
    }
    return out;
  }
  return value;
}

function redactContext(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!context || Object.keys(context).length === 0) return context;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) {
    out[k] = redactContextValue(k, v);
  }
  return out;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  subsystem?: string;
  correlationId?: string;
  context?: Record<string, unknown>;
  durationMs?: number;
}

export interface LoggerOptions {
  level?: LogLevel;
  forceJson?: boolean;
  forcePretty?: boolean;
}

export interface TimerHandle {
  /** End the timer and log the duration at the configured level. */
  end(context?: Record<string, unknown>): number;
  /** End the timer silently and return elapsed ms without logging. */
  elapsed(): number;
}

class Logger {
  private correlationId: string | null = null;
  private level: LogLevel = 'info';
  private forceJson: boolean = false;
  private forcePretty: boolean = false;
  private defaultContext: Record<string, unknown> = {};
  private subsystem: string | undefined;

  configure(options: LoggerOptions): void {
    if (options.level) {
      this.level = options.level;
    }
    if (options.forceJson !== undefined) {
      this.forceJson = options.forceJson;
    }
    if (options.forcePretty !== undefined) {
      this.forcePretty = options.forcePretty;
    }
  }

  getLevel(): LogLevel {
    return this.level;
  }

  isLevelEnabled(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level];
  }

  setDefaultContext(ctx: Record<string, unknown>): void {
    this.defaultContext = { ...ctx };
  }

  setCorrelationId(id: string): void {
    this.correlationId = id;
  }

  clearCorrelationId(): void {
    this.correlationId = null;
  }

  getCorrelationId(): string | null {
    return this.correlationId;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level];
  }

  private isJsonMode(): boolean {
    if (this.forceJson) return true;
    if (this.forcePretty) return false;
    return !process.stderr.isTTY;
  }

  private formatTimestamp(isoString: string): string {
    return isoString.slice(11, 23); // HH:MM:SS.mmm
  }

  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    durationMs?: number,
  ): void {
    if (!this.shouldLog(level)) return;

    const merged =
      Object.keys(this.defaultContext).length > 0 || (context && Object.keys(context).length > 0)
        ? { ...this.defaultContext, ...context }
        : undefined;

    const safeContext = redactContext(merged);

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(this.subsystem && { subsystem: this.subsystem }),
      ...(this.correlationId && { correlationId: this.correlationId }),
      ...(safeContext && Object.keys(safeContext).length > 0 && { context: safeContext }),
      ...(durationMs !== undefined && { durationMs }),
    };

    const output = level === 'error' || level === 'warn' ? process.stderr : process.stdout;

    if (this.isJsonMode()) {
      output.write(JSON.stringify(entry) + '\n');
    } else {
      const ts = this.formatTimestamp(entry.timestamp);
      const color = LOG_LEVEL_COLORS[level];
      const levelTag = `[${level.toUpperCase().padEnd(5)}]`;
      const sub = this.subsystem ? ` ${'\x1b[90m'}[${this.subsystem}]${RESET}` : '';
      const corrId = this.correlationId ? ` [${this.correlationId}]` : '';
      const dur = durationMs !== undefined ? ` \x1b[90m(${formatMs(durationMs)})${RESET}` : '';
      const ctxStr =
        safeContext && Object.keys(safeContext).length > 0 ? ` ${JSON.stringify(safeContext)}` : '';

      output.write(`${ts} ${color}${levelTag}${RESET}${sub}${corrId} ${message}${dur}${ctxStr}\n`);
    }
  }

  trace(message: string, context?: Record<string, unknown>): void {
    this.log('trace', message, context);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  /**
   * Start a performance timer. Returns a handle to end/read elapsed time.
   * Logs at the given level when `.end()` is called.
   */
  time(label: string, level: LogLevel = 'debug'): TimerHandle {
    const start = performance.now();
    let ended = false;
    return {
      end: (context?: Record<string, unknown>) => {
        const elapsed = Math.round(performance.now() - start);
        if (!ended) {
          ended = true;
          this.log(level, label, context, elapsed);
        }
        return elapsed;
      },
      elapsed: () => Math.round(performance.now() - start),
    };
  }

  /**
   * Create a child logger scoped to a subsystem.
   * The child inherits the parent's config and correlation ID at call time
   * but has its own subsystem prefix and optional extra context.
   */
  child(subsystem: string, context?: Record<string, unknown>): ChildLogger {
    return new ChildLogger(this, subsystem, context);
  }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Child logger scoped to a subsystem. Safe for concurrent use —
 * does not mutate parent state.
 */
class ChildLogger {
  private childContext: Record<string, unknown>;

  constructor(
    private parent: Logger,
    private subsystem: string,
    context?: Record<string, unknown>,
  ) {
    this.childContext = context ?? {};
  }

  private merge(context?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (Object.keys(this.childContext).length === 0) return context;
    return { ...this.childContext, ...context };
  }

  private prefixed(message: string): string {
    return `[${this.subsystem}] ${message}`;
  }

  trace(message: string, context?: Record<string, unknown>): void {
    this.parent.trace(this.prefixed(message), this.merge(context));
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.parent.debug(this.prefixed(message), this.merge(context));
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.parent.info(this.prefixed(message), this.merge(context));
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.parent.warn(this.prefixed(message), this.merge(context));
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.parent.error(this.prefixed(message), this.merge(context));
  }

  time(label: string, level: LogLevel = 'debug'): TimerHandle {
    return this.parent.time(this.prefixed(label), level);
  }
}

// Export singleton instance
export const logger = new Logger();

// Export class for testing
export { Logger, ChildLogger };
