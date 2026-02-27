import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CircuitBreaker,
  CircuitOpenError,
  getCircuitBreaker,
  resetAllCircuitBreakers,
} from '../lib/circuit-breaker.js';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetAllCircuitBreakers();
  });

  it('starts in closed state', () => {
    const breaker = new CircuitBreaker();
    expect(breaker.getState()).toBe('closed');
    expect(breaker.getFailureCount()).toBe(0);
  });

  it('stays closed on successful calls', async () => {
    const breaker = new CircuitBreaker();
    await breaker.execute(async () => 'ok');
    await breaker.execute(async () => 'ok');
    expect(breaker.getState()).toBe('closed');
    expect(breaker.getFailureCount()).toBe(0);
  });

  it('tracks failure count', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5 });
    for (let i = 0; i < 3; i++) {
      await breaker
        .execute(async () => {
          throw new Error('fail');
        })
        .catch(() => {});
    }
    expect(breaker.getFailureCount()).toBe(3);
    expect(breaker.getState()).toBe('closed');
  });

  it('opens after reaching failure threshold', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });
    for (let i = 0; i < 3; i++) {
      await breaker
        .execute(async () => {
          throw new Error('fail');
        })
        .catch(() => {});
    }
    expect(breaker.getState()).toBe('open');
    expect(breaker.getFailureCount()).toBe(3);
  });

  it('rejects calls immediately when open', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 10000 });
    await breaker
      .execute(async () => {
        throw new Error('fail');
      })
      .catch(() => {});
    await breaker
      .execute(async () => {
        throw new Error('fail');
      })
      .catch(() => {});
    expect(breaker.getState()).toBe('open');

    await expect(breaker.execute(async () => 'ok')).rejects.toThrow(CircuitOpenError);
  });

  it('CircuitOpenError includes remaining time', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 30000 });
    await breaker
      .execute(async () => {
        throw new Error('fail');
      })
      .catch(() => {});

    try {
      await breaker.execute(async () => 'ok');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CircuitOpenError);
      const err = e as CircuitOpenError;
      expect(err.remainingMs).toBeGreaterThan(0);
      expect(err.remainingMs).toBeLessThanOrEqual(30000);
      expect(err.message).toContain('Circuit breaker open');
    }
  });

  it('transitions to half-open after reset timeout', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 5000 });
    await breaker
      .execute(async () => {
        throw new Error('fail');
      })
      .catch(() => {});
    expect(breaker.getState()).toBe('open');

    vi.advanceTimersByTime(5000);

    // Next call should transition to half-open and execute
    const result = await breaker.execute(async () => 'recovered');
    expect(result).toBe('recovered');
  });

  it('closes after enough successes in half-open', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 2,
      resetTimeoutMs: 1000,
    });
    await breaker
      .execute(async () => {
        throw new Error('fail');
      })
      .catch(() => {});
    expect(breaker.getState()).toBe('open');

    vi.advanceTimersByTime(1000);

    // First success in half-open
    await breaker.execute(async () => 'ok');
    expect(breaker.getState()).toBe('half-open');

    // Second success closes the circuit
    await breaker.execute(async () => 'ok');
    expect(breaker.getState()).toBe('closed');
  });

  it('re-opens on failure in half-open state', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      successThreshold: 2,
      resetTimeoutMs: 1000,
    });
    await breaker
      .execute(async () => {
        throw new Error('fail');
      })
      .catch(() => {});
    vi.advanceTimersByTime(1000);

    // Transition to half-open, then fail
    await breaker
      .execute(async () => {
        throw new Error('fail again');
      })
      .catch(() => {});
    expect(breaker.getState()).toBe('open');
  });

  it('resets to closed state', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    await breaker
      .execute(async () => {
        throw new Error('fail');
      })
      .catch(() => {});
    expect(breaker.getState()).toBe('open');

    breaker.reset();
    expect(breaker.getState()).toBe('closed');
    expect(breaker.getFailureCount()).toBe(0);
  });

  it('resets failure count on success', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5 });
    await breaker
      .execute(async () => {
        throw new Error('fail');
      })
      .catch(() => {});
    await breaker
      .execute(async () => {
        throw new Error('fail');
      })
      .catch(() => {});
    expect(breaker.getFailureCount()).toBe(2);

    await breaker.execute(async () => 'ok');
    expect(breaker.getFailureCount()).toBe(0);
  });
});

describe('getCircuitBreaker', () => {
  afterEach(() => {
    resetAllCircuitBreakers();
  });

  it('returns the same instance for the same key', () => {
    const a = getCircuitBreaker('svc:foo');
    const b = getCircuitBreaker('svc:foo');
    expect(a).toBe(b);
  });

  it('returns different instances for different keys', () => {
    const a = getCircuitBreaker('svc:foo');
    const b = getCircuitBreaker('svc:bar');
    expect(a).not.toBe(b);
  });
});

describe('resetAllCircuitBreakers', () => {
  it('clears the global breaker pool', () => {
    const a = getCircuitBreaker('svc:one');
    resetAllCircuitBreakers();
    const b = getCircuitBreaker('svc:one');
    expect(a).not.toBe(b);
  });
});
