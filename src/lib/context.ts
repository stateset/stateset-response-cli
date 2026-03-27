/**
 * Request context for tracing and correlation.
 *
 * Uses AsyncLocalStorage so context propagates through async chains
 * without manual threading. Each request/operation gets a unique
 * request ID, trace ID, and span ID.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

function generateId(prefix: string, bytes: number = 8): string {
  return `${prefix}_${crypto.randomBytes(bytes).toString('hex')}`;
}

export class Span {
  readonly id: string;
  readonly name: string;
  readonly parentSpanId: string | undefined;
  readonly startTime: number;
  private endTime: number | null = null;
  private _status: 'running' | 'ok' | 'error' = 'running';
  private attributes: Record<string, unknown> = {};
  private events: Array<{ name: string; ts: number; attrs?: Record<string, unknown> }> = [];

  constructor(name: string, parentSpanId?: string) {
    this.id = generateId('span', 4);
    this.name = name;
    this.parentSpanId = parentSpanId;
    this.startTime = performance.now();
  }

  setAttribute(key: string, value: unknown): void {
    this.attributes[key] = value;
  }

  addEvent(name: string, attrs?: Record<string, unknown>): void {
    this.events.push({ name, ts: performance.now(), attrs });
  }

  end(status: 'ok' | 'error' = 'ok'): void {
    if (this.endTime !== null) return;
    this.endTime = performance.now();
    this._status = status;
  }

  get status(): string {
    return this._status;
  }

  get durationMs(): number | null {
    if (this.endTime === null) return null;
    return Math.round(this.endTime - this.startTime);
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      parentSpanId: this.parentSpanId,
      status: this._status,
      durationMs: this.durationMs,
      attributes: Object.keys(this.attributes).length > 0 ? this.attributes : undefined,
      events: this.events.length > 0 ? this.events : undefined,
    };
  }
}

export class RequestContext {
  readonly requestId: string;
  readonly traceId: string;
  readonly startTime: number;
  private spanStack: Span[] = [];
  private completedSpans: Span[] = [];
  private tags = new Set<string>();
  private metadata: Record<string, unknown> = {};

  constructor(opts?: { traceId?: string; requestId?: string }) {
    this.requestId = opts?.requestId ?? generateId('req');
    this.traceId = opts?.traceId ?? crypto.randomBytes(16).toString('hex');
    this.startTime = performance.now();
  }

  /**
   * Start a new span (nested under the current span if any).
   */
  startSpan(name: string): Span {
    const parentId =
      this.spanStack.length > 0 ? this.spanStack[this.spanStack.length - 1].id : undefined;
    const span = new Span(name, parentId);
    this.spanStack.push(span);
    return span;
  }

  /**
   * End the current (most recent) span.
   */
  endSpan(status: 'ok' | 'error' = 'ok'): Span | undefined {
    const span = this.spanStack.pop();
    if (span) {
      span.end(status);
      this.completedSpans.push(span);
    }
    return span;
  }

  get currentSpan(): Span | undefined {
    return this.spanStack[this.spanStack.length - 1];
  }

  get currentSpanId(): string | undefined {
    return this.currentSpan?.id;
  }

  addTag(tag: string): void {
    this.tags.add(tag);
  }

  setMetadata(key: string, value: unknown): void {
    this.metadata[key] = value;
  }

  get elapsedMs(): number {
    return Math.round(performance.now() - this.startTime);
  }

  /**
   * Get trace headers for distributed tracing.
   */
  getTraceHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'x-request-id': this.requestId,
      'x-trace-id': this.traceId,
    };
    if (this.currentSpanId) {
      headers['x-span-id'] = this.currentSpanId;
    }
    return headers;
  }

  toJSON(): Record<string, unknown> {
    return {
      requestId: this.requestId,
      traceId: this.traceId,
      elapsedMs: this.elapsedMs,
      tags: this.tags.size > 0 ? [...this.tags] : undefined,
      metadata: Object.keys(this.metadata).length > 0 ? this.metadata : undefined,
      spans:
        this.completedSpans.length > 0 ? this.completedSpans.map((s) => s.toJSON()) : undefined,
    };
  }
}

/**
 * Run a function within a request context.
 */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return asyncLocalStorage.run(context, fn);
}

/**
 * Get the current request context, or null if not in a context.
 */
export function getContext(): RequestContext | null {
  return asyncLocalStorage.getStore() ?? null;
}

/**
 * Get or create a request context (creates one if none exists).
 */
export function getOrCreateContext(): RequestContext {
  const existing = asyncLocalStorage.getStore();
  if (existing) return existing;
  return new RequestContext();
}

/**
 * Create a child context that shares the parent's trace ID.
 */
export function createChildContext(parent: RequestContext): RequestContext {
  return new RequestContext({ traceId: parent.traceId });
}

/**
 * Run a function within a new span on the current context.
 * Automatically ends the span when the function completes.
 */
export async function withSpan<T>(name: string, fn: (span: Span) => T | Promise<T>): Promise<T> {
  const ctx = getContext();
  if (!ctx) return fn(new Span(name));

  const span = ctx.startSpan(name);
  try {
    const result = await fn(span);
    ctx.endSpan('ok');
    return result;
  } catch (err) {
    ctx.endSpan('error');
    throw err;
  }
}
