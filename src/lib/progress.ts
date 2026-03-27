/**
 * Adaptive progress reporting for CLI operations.
 *
 * Features:
 * - Spinner mode (default TTY)
 * - Percentage bar mode (when total is known)
 * - Log fallback (non-TTY / CI)
 * - Delayed display to avoid flash for fast ops
 * - Nesting prevention (returns noop if one is active)
 * - Graceful cleanup
 */

import chalk from 'chalk';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 80;
const BAR_WIDTH = 24;

export interface ProgressReporter {
  /** Update the progress message. */
  update(message: string): void;
  /** Set the percentage (0–100). Only meaningful in determinate mode. */
  setPercent(percent: number): void;
  /** Increment by one unit (for counted operations). */
  tick(): void;
  /** Complete with a success message. */
  succeed(message?: string): void;
  /** Complete with a failure message. */
  fail(message?: string): void;
  /** Complete and clear without a final message. */
  done(): void;
}

export interface ProgressOptions {
  /** Initial message shown next to the spinner. */
  message?: string;
  /** Total count for percentage tracking (enables bar mode). */
  total?: number;
  /** Delay before showing the spinner (ms). Avoids flash for fast ops. Default: 0. */
  delayMs?: number;
}

let activeProgress: ProgressReporter | null = null;

function isTTY(): boolean {
  return Boolean(process.stderr.isTTY);
}

function clearLine(): void {
  process.stderr.write('\r\x1b[K');
}

class SpinnerProgress implements ProgressReporter {
  private message: string;
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private delayTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private finished = false;
  private percent = -1;
  private current = 0;
  private total: number | undefined;

  constructor(options: ProgressOptions) {
    this.message = options.message ?? '';
    this.total = options.total;

    const startSpinner = () => {
      this.started = true;
      this.render();
      this.timer = setInterval(() => {
        this.frame = (this.frame + 1) % SPINNER_FRAMES.length;
        this.render();
      }, SPINNER_INTERVAL_MS);
    };

    if (options.delayMs && options.delayMs > 0) {
      this.delayTimer = setTimeout(() => {
        if (!this.finished) startSpinner();
      }, options.delayMs);
    } else {
      startSpinner();
    }
  }

  private render(): void {
    if (this.finished || !this.started) return;
    const spinner = chalk.cyan(SPINNER_FRAMES[this.frame]);
    let line = `${spinner} ${this.message}`;

    if (this.total !== undefined && this.total > 0) {
      const pct = Math.min(100, Math.round((this.current / this.total) * 100));
      const filled = Math.round((pct / 100) * BAR_WIDTH);
      const empty = BAR_WIDTH - filled;
      const bar = chalk.cyan('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
      line = `${spinner} ${bar} ${chalk.gray(`${pct}%`)} ${this.message}`;
    } else if (this.percent >= 0) {
      const pct = Math.min(100, Math.round(this.percent));
      const filled = Math.round((pct / 100) * BAR_WIDTH);
      const empty = BAR_WIDTH - filled;
      const bar = chalk.cyan('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
      line = `${spinner} ${bar} ${chalk.gray(`${pct}%`)} ${this.message}`;
    }

    clearLine();
    process.stderr.write(line);
  }

  update(message: string): void {
    this.message = message;
    if (this.started && !this.finished) this.render();
  }

  setPercent(percent: number): void {
    this.percent = Math.max(0, Math.min(100, percent));
    if (this.started && !this.finished) this.render();
  }

  tick(): void {
    this.current++;
    if (this.started && !this.finished) this.render();
  }

  private cleanup(): void {
    this.finished = true;
    if (this.delayTimer) {
      clearTimeout(this.delayTimer);
      this.delayTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.started) clearLine();
    activeProgress = null;
  }

  succeed(message?: string): void {
    this.cleanup();
    const msg = message ?? this.message;
    if (msg) process.stderr.write(`${chalk.green('✓')} ${msg}\n`);
  }

  fail(message?: string): void {
    this.cleanup();
    const msg = message ?? this.message;
    if (msg) process.stderr.write(`${chalk.red('✗')} ${msg}\n`);
  }

  done(): void {
    this.cleanup();
  }
}

class LogProgress implements ProgressReporter {
  private message: string;
  private logged = false;

  constructor(options: ProgressOptions) {
    this.message = options.message ?? '';
  }

  private maybeLog(): void {
    if (!this.logged && this.message) {
      this.logged = true;
      process.stderr.write(`  ${this.message}\n`);
    }
  }

  update(message: string): void {
    this.message = message;
  }

  setPercent(): void {
    this.maybeLog();
  }

  tick(): void {
    this.maybeLog();
  }

  succeed(message?: string): void {
    const msg = message ?? this.message;
    if (msg) process.stderr.write(`  ${msg}\n`);
    activeProgress = null;
  }

  fail(message?: string): void {
    const msg = message ?? this.message;
    if (msg) process.stderr.write(`  ${msg}\n`);
    activeProgress = null;
  }

  done(): void {
    activeProgress = null;
  }
}

const NOOP_PROGRESS: ProgressReporter = {
  update() {},
  setPercent() {},
  tick() {},
  succeed() {},
  fail() {},
  done() {},
};

/**
 * Create a progress reporter. Only one can be active at a time.
 * If one is already active, returns a noop reporter.
 *
 * Uses a spinner in TTY mode, falls back to log lines in non-TTY.
 */
export function createProgress(options: ProgressOptions = {}): ProgressReporter {
  if (activeProgress) return NOOP_PROGRESS;

  const reporter = isTTY() ? new SpinnerProgress(options) : new LogProgress(options);
  activeProgress = reporter;
  return reporter;
}

/**
 * Check if a progress reporter is currently active.
 */
export function isProgressActive(): boolean {
  return activeProgress !== null;
}
