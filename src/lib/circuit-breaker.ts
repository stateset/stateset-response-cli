export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit (default: 5) */
  failureThreshold?: number;
  /** Number of consecutive successes in half-open before closing (default: 2) */
  successThreshold?: number;
  /** Time in ms before attempting recovery from open state (default: 30000) */
  resetTimeoutMs?: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.successThreshold = options.successThreshold ?? 2;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime < this.resetTimeoutMs) {
        throw new CircuitOpenError(this.resetTimeoutMs - (Date.now() - this.lastFailureTime));
      }
      this.state = 'half-open';
      this.successCount = 0;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
  }

  private onSuccess(): void {
    this.failureCount = 0;
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = 'closed';
        this.successCount = 0;
      }
    }
  }

  private onFailure(): void {
    this.lastFailureTime = Date.now();
    this.failureCount++;
    if (this.state === 'half-open' || this.failureCount >= this.failureThreshold) {
      this.state = 'open';
    }
  }
}

export class CircuitOpenError extends Error {
  readonly remainingMs: number;

  constructor(remainingMs: number) {
    super(`Circuit breaker open (${Math.ceil(remainingMs / 1000)}s until retry)`);
    this.name = 'CircuitOpenError';
    this.remainingMs = remainingMs;
  }
}

const breakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(
  serviceKey: string,
  options?: CircuitBreakerOptions,
): CircuitBreaker {
  let breaker = breakers.get(serviceKey);
  if (!breaker) {
    breaker = new CircuitBreaker(options);
    breakers.set(serviceKey, breaker);
  }
  return breaker;
}

export function resetAllCircuitBreakers(): void {
  for (const breaker of breakers.values()) {
    breaker.reset();
  }
  breakers.clear();
}
