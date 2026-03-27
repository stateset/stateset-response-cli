import { describe, it, expect, beforeEach, vi, afterEach, type SpyInstance } from 'vitest';

// We need to control isTTY behavior. The module checks process.stderr.isTTY internally.
// We'll set it to false so we get the simpler LogProgress path (no timers to manage).

import { createProgress, isProgressActive } from '../lib/progress.js';

describe('progress', () => {
  let stderrWrite: SpyInstance;
  const origIsTTY = process.stderr.isTTY;

  beforeEach(() => {
    // Force non-TTY mode (LogProgress) for predictable testing
    Object.defineProperty(process.stderr, 'isTTY', { value: false, writable: true });
    stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    // Ensure no active progress from previous test
    // (we can only clear by calling done() on whatever is active)
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process.stderr, 'isTTY', { value: origIsTTY, writable: true });
  });

  describe('createProgress', () => {
    it('returns a reporter with expected methods', () => {
      const reporter = createProgress({ message: 'Loading...' });
      expect(typeof reporter.update).toBe('function');
      expect(typeof reporter.setPercent).toBe('function');
      expect(typeof reporter.tick).toBe('function');
      expect(typeof reporter.succeed).toBe('function');
      expect(typeof reporter.fail).toBe('function');
      expect(typeof reporter.done).toBe('function');
      reporter.done();
    });

    it('succeed writes a message to stderr', () => {
      const reporter = createProgress({ message: 'Working...' });
      reporter.succeed('All done');
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('All done'));
    });

    it('fail writes a message to stderr', () => {
      const reporter = createProgress({ message: 'Trying...' });
      reporter.fail('Something broke');
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('Something broke'));
    });
  });

  describe('isProgressActive', () => {
    it('returns false when no progress is active', () => {
      expect(isProgressActive()).toBe(false);
    });

    it('returns true when a progress reporter is active', () => {
      const reporter = createProgress({ message: 'test' });
      expect(isProgressActive()).toBe(true);
      reporter.done();
    });

    it('returns false after done() is called', () => {
      const reporter = createProgress({ message: 'test' });
      expect(isProgressActive()).toBe(true);
      reporter.done();
      expect(isProgressActive()).toBe(false);
    });

    it('returns false after succeed() is called', () => {
      const reporter = createProgress({ message: 'test' });
      reporter.succeed('ok');
      expect(isProgressActive()).toBe(false);
    });

    it('returns false after fail() is called', () => {
      const reporter = createProgress({ message: 'test' });
      reporter.fail('nope');
      expect(isProgressActive()).toBe(false);
    });
  });

  describe('nesting prevention', () => {
    it('returns a noop reporter when one is already active', () => {
      const first = createProgress({ message: 'first' });
      expect(isProgressActive()).toBe(true);

      const second = createProgress({ message: 'second' });
      // The second reporter should be noop — calling done on it should NOT clear active state
      second.done();
      expect(isProgressActive()).toBe(true);

      // Clean up the real one
      first.done();
      expect(isProgressActive()).toBe(false);
    });

    it('noop reporter methods do nothing', () => {
      const first = createProgress({ message: 'active' });
      const noop = createProgress({ message: 'noop' });

      // None of these should throw
      noop.update('test');
      noop.setPercent(50);
      noop.tick();
      noop.succeed('ok');
      noop.fail('err');
      noop.done();

      // First is still active
      expect(isProgressActive()).toBe(true);
      first.done();
    });
  });

  describe('LogProgress behavior (non-TTY)', () => {
    it('succeed uses fallback message when no argument', () => {
      const reporter = createProgress({ message: 'Default msg' });
      reporter.succeed();
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('Default msg'));
    });

    it('fail uses fallback message when no argument', () => {
      const reporter = createProgress({ message: 'Default msg' });
      reporter.fail();
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('Default msg'));
    });

    it('update changes the message', () => {
      const reporter = createProgress({ message: 'initial' });
      reporter.update('updated');
      reporter.succeed();
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('updated'));
    });

    it('tick triggers a log on first call', () => {
      const reporter = createProgress({ message: 'ticking' });
      reporter.tick();
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('ticking'));
      reporter.done();
    });

    it('setPercent triggers a log on first call', () => {
      const reporter = createProgress({ message: 'percentage' });
      reporter.setPercent(50);
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('percentage'));
      reporter.done();
    });
  });

  describe('SpinnerProgress behavior (TTY)', () => {
    it('creates a spinner reporter when TTY', () => {
      Object.defineProperty(process.stderr, 'isTTY', { value: true, writable: true });
      vi.useFakeTimers();

      const reporter = createProgress({ message: 'Spinning...' });
      expect(isProgressActive()).toBe(true);

      // The spinner writes to stderr via render
      expect(stderrWrite).toHaveBeenCalled();

      reporter.done();
      expect(isProgressActive()).toBe(false);

      vi.useRealTimers();
    });
  });
});
