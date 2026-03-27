/**
 * Graceful shutdown registry.
 *
 * Modules register cleanup callbacks that run in order on SIGINT/SIGTERM.
 * If cleanup takes longer than the timeout, the process exits forcefully.
 */

import { logger } from './logger.js';

export type ShutdownHook = () => void | Promise<void>;

const hooks: Array<{ name: string; fn: ShutdownHook }> = [];
let shuttingDown = false;

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Register a cleanup hook. Hooks run in registration order during shutdown.
 * Returns a function to unregister.
 */
export function onShutdown(name: string, fn: ShutdownHook): () => void {
  const entry = { name, fn };
  hooks.push(entry);
  return () => {
    const idx = hooks.indexOf(entry);
    if (idx !== -1) hooks.splice(idx, 1);
  };
}

/**
 * Run all shutdown hooks. Called automatically on SIGINT/SIGTERM.
 * Can also be called manually for clean exit.
 */
export async function runShutdownHooks(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.debug('Running shutdown hooks', { count: hooks.length });

  for (const hook of hooks) {
    try {
      await hook.fn();
      logger.debug(`Shutdown hook completed: ${hook.name}`);
    } catch (err) {
      logger.warn(`Shutdown hook failed: ${hook.name}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Install SIGINT/SIGTERM handlers that run cleanup hooks before exit.
 */
export function installShutdownHandlers(timeoutMs: number = DEFAULT_TIMEOUT_MS): void {
  const handler = async (signal: string) => {
    logger.debug(`Received ${signal}, shutting down`);

    // Force exit after timeout
    const forceTimer = setTimeout(() => {
      logger.warn('Shutdown timeout reached, forcing exit');
      process.exit(1);
    }, timeoutMs);
    forceTimer.unref();

    try {
      await runShutdownHooks();
    } finally {
      clearTimeout(forceTimer);
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => handler('SIGTERM'));
  // SIGINT is typically handled by the chat session's own handler,
  // so we only register SIGTERM here. Chat session calls runShutdownHooks() on exit.
}

/**
 * Check if shutdown is in progress.
 */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

/**
 * Reset shutdown state (for testing).
 */
export function resetShutdown(): void {
  shuttingDown = false;
  hooks.length = 0;
}
