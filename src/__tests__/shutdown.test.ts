import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../lib/logger.js', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { onShutdown, runShutdownHooks, isShuttingDown, resetShutdown } from '../lib/shutdown.js';

describe('shutdown', () => {
  beforeEach(() => {
    resetShutdown();
  });

  describe('onShutdown', () => {
    it('registers a hook', async () => {
      const fn = vi.fn();
      onShutdown('test-hook', fn);
      await runShutdownHooks();
      expect(fn).toHaveBeenCalledOnce();
    });

    it('returns an unregister function', async () => {
      const fn = vi.fn();
      const unregister = onShutdown('removable', fn);
      unregister();
      await runShutdownHooks();
      expect(fn).not.toHaveBeenCalled();
    });

    it('unregister is idempotent', () => {
      const fn = vi.fn();
      const unregister = onShutdown('safe', fn);
      unregister();
      // Calling again should not throw
      expect(() => unregister()).not.toThrow();
    });
  });

  describe('runShutdownHooks', () => {
    it('runs all hooks in registration order', async () => {
      const order: number[] = [];
      onShutdown('first', () => {
        order.push(1);
      });
      onShutdown('second', () => {
        order.push(2);
      });
      onShutdown('third', () => {
        order.push(3);
      });
      await runShutdownHooks();
      expect(order).toEqual([1, 2, 3]);
    });

    it('handles async hooks', async () => {
      const order: number[] = [];
      onShutdown('async-hook', async () => {
        await new Promise((r) => setTimeout(r, 5));
        order.push(1);
      });
      onShutdown('sync-hook', () => {
        order.push(2);
      });
      await runShutdownHooks();
      expect(order).toEqual([1, 2]);
    });

    it('handles hook errors gracefully and continues', async () => {
      const results: string[] = [];
      onShutdown('good-1', () => {
        results.push('a');
      });
      onShutdown('bad', () => {
        throw new Error('hook failed');
      });
      onShutdown('good-2', () => {
        results.push('b');
      });

      // Should not throw
      await expect(runShutdownHooks()).resolves.toBeUndefined();
      // Both good hooks should have run
      expect(results).toEqual(['a', 'b']);
    });

    it('handles async hook rejection gracefully', async () => {
      const results: string[] = [];
      onShutdown('good', () => {
        results.push('ok');
      });
      onShutdown('bad-async', async () => {
        throw new Error('async fail');
      });

      await expect(runShutdownHooks()).resolves.toBeUndefined();
      expect(results).toEqual(['ok']);
    });

    it('is idempotent (second call is a no-op)', async () => {
      const fn = vi.fn();
      onShutdown('once', fn);
      await runShutdownHooks();
      await runShutdownHooks();
      expect(fn).toHaveBeenCalledOnce();
    });
  });

  describe('isShuttingDown', () => {
    it('returns false initially', () => {
      expect(isShuttingDown()).toBe(false);
    });

    it('returns true after runShutdownHooks', async () => {
      await runShutdownHooks();
      expect(isShuttingDown()).toBe(true);
    });

    it('returns false after resetShutdown', async () => {
      await runShutdownHooks();
      expect(isShuttingDown()).toBe(true);
      resetShutdown();
      expect(isShuttingDown()).toBe(false);
    });
  });

  describe('resetShutdown', () => {
    it('clears shutdown state', async () => {
      await runShutdownHooks();
      resetShutdown();
      expect(isShuttingDown()).toBe(false);
    });

    it('clears registered hooks', async () => {
      const fn = vi.fn();
      onShutdown('will-be-cleared', fn);
      resetShutdown();
      // Now run shutdown — the cleared hook should not execute
      await runShutdownHooks();
      expect(fn).not.toHaveBeenCalled();
    });

    it('allows re-running hooks after reset', async () => {
      const fn = vi.fn();
      await runShutdownHooks();
      resetShutdown();
      onShutdown('new-hook', fn);
      await runShutdownHooks();
      expect(fn).toHaveBeenCalledOnce();
    });
  });
});
