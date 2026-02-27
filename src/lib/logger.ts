/**
 * Structured logging module for StateSet Response CLI
 *
 * Features:
 * - Log levels (debug, info, warn, error)
 * - Correlation IDs for request tracing
 * - TTY detection (human-readable for terminal, JSON for pipes)
 * - Configurable log level
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m', // green
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
};

const RESET = '\x1b[0m';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  context?: Record<string, unknown>;
}

export interface LoggerOptions {
  level?: LogLevel;
  forceJson?: boolean;
  forcePretty?: boolean;
}

class Logger {
  private correlationId: string | null = null;
  private level: LogLevel = 'info';
  private forceJson: boolean = false;
  private forcePretty: boolean = false;
  private defaultContext: Record<string, unknown> = {};

  /**
   * Configure the logger
   */
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

  /**
   * Set default context that is merged into every log entry.
   */
  setDefaultContext(ctx: Record<string, unknown>): void {
    this.defaultContext = { ...ctx };
  }

  /**
   * Set correlation ID for request tracing
   */
  setCorrelationId(id: string): void {
    this.correlationId = id;
  }

  /**
   * Clear correlation ID
   */
  clearCorrelationId(): void {
    this.correlationId = null;
  }

  /**
   * Get current correlation ID
   */
  getCorrelationId(): string | null {
    return this.correlationId;
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level];
  }

  /**
   * Determine if output should be JSON
   */
  private isJsonMode(): boolean {
    if (this.forceJson) return true;
    if (this.forcePretty) return false;
    return !process.stdout.isTTY;
  }

  /**
   * Format timestamp for pretty output
   */
  private formatTimestamp(isoString: string): string {
    return isoString.slice(11, 23); // HH:MM:SS.mmm
  }

  /**
   * Core logging function
   */
  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const merged =
      Object.keys(this.defaultContext).length > 0 || (context && Object.keys(context).length > 0)
        ? { ...this.defaultContext, ...context }
        : undefined;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(this.correlationId && { correlationId: this.correlationId }),
      ...(merged && Object.keys(merged).length > 0 && { context: merged }),
    };

    if (this.isJsonMode()) {
      // JSON output for machine consumption
      console.log(JSON.stringify(entry));
    } else {
      // Human-readable output
      const ts = this.formatTimestamp(entry.timestamp);
      const color = LOG_LEVEL_COLORS[level];
      const levelTag = `[${level.toUpperCase().padEnd(5)}]`;
      const corrId = this.correlationId ? ` [${this.correlationId}]` : '';
      const ctxStr =
        context && Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : '';

      console.log(`${ts} ${color}${levelTag}${RESET}${corrId} ${message}${ctxStr}`);
    }
  }

  /**
   * Debug level log
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  /**
   * Info level log
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  /**
   * Warning level log
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  /**
   * Error level log
   */
  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  /**
   * Create a child logger with a specific correlation ID and optional context.
   */
  child(correlationId: string, context?: Record<string, unknown>): ChildLogger {
    return new ChildLogger(this, correlationId, context);
  }
}

/**
 * Child logger with a prefix. Safe for concurrent use — does not
 * mutate parent state.
 */
class ChildLogger {
  private childContext: Record<string, unknown>;

  constructor(
    private parent: Logger,
    private prefix: string,
    context?: Record<string, unknown>,
  ) {
    this.childContext = context ?? {};
  }

  private merge(context?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (Object.keys(this.childContext).length === 0) return context;
    return { ...this.childContext, ...context };
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.parent.debug(`[${this.prefix}] ${message}`, this.merge(context));
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.parent.info(`[${this.prefix}] ${message}`, this.merge(context));
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.parent.warn(`[${this.prefix}] ${message}`, this.merge(context));
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.parent.error(`[${this.prefix}] ${message}`, this.merge(context));
  }
}

// Export singleton instance
export const logger = new Logger();

// Export class for testing
export { Logger };
