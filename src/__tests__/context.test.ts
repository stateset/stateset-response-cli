import { describe, it, expect } from 'vitest';
import {
  RequestContext,
  Span,
  runWithContext,
  getContext,
  createChildContext,
  withSpan,
} from '../lib/context.js';

describe('context', () => {
  describe('RequestContext', () => {
    it('generates unique request IDs', () => {
      const a = new RequestContext();
      const b = new RequestContext();
      expect(a.requestId).toMatch(/^req_/);
      expect(b.requestId).toMatch(/^req_/);
      expect(a.requestId).not.toBe(b.requestId);
    });

    it('generates unique trace IDs', () => {
      const a = new RequestContext();
      const b = new RequestContext();
      expect(a.traceId).toBeTruthy();
      expect(b.traceId).toBeTruthy();
      expect(a.traceId).not.toBe(b.traceId);
    });

    it('accepts custom requestId and traceId', () => {
      const ctx = new RequestContext({
        requestId: 'req_custom',
        traceId: 'trace_custom',
      });
      expect(ctx.requestId).toBe('req_custom');
      expect(ctx.traceId).toBe('trace_custom');
    });

    it('tracks elapsed time', async () => {
      const ctx = new RequestContext();
      // elapsedMs should be non-negative
      expect(ctx.elapsedMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Span', () => {
    it('has an id, name, and running status', () => {
      const span = new Span('test-span');
      expect(span.id).toMatch(/^span_/);
      expect(span.name).toBe('test-span');
      expect(span.status).toBe('running');
      expect(span.durationMs).toBeNull();
    });

    it('records parent span id', () => {
      const span = new Span('child', 'parent_123');
      expect(span.parentSpanId).toBe('parent_123');
    });

    it('has no parent by default', () => {
      const span = new Span('root');
      expect(span.parentSpanId).toBeUndefined();
    });

    it('end() sets status and duration', () => {
      const span = new Span('test');
      span.end('ok');
      expect(span.status).toBe('ok');
      expect(span.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof span.durationMs).toBe('number');
    });

    it('end() with error status', () => {
      const span = new Span('test');
      span.end('error');
      expect(span.status).toBe('error');
    });

    it('end() defaults to ok', () => {
      const span = new Span('test');
      span.end();
      expect(span.status).toBe('ok');
    });

    it('end() is idempotent', () => {
      const span = new Span('test');
      span.end('ok');
      const duration = span.durationMs;
      span.end('error');
      // Status should not change after first end
      expect(span.status).toBe('ok');
      expect(span.durationMs).toBe(duration);
    });

    it('setAttribute and toJSON', () => {
      const span = new Span('test');
      span.setAttribute('http.method', 'GET');
      span.end();
      const json = span.toJSON();
      expect(json.attributes).toEqual({ 'http.method': 'GET' });
    });

    it('addEvent records events', () => {
      const span = new Span('test');
      span.addEvent('retry', { attempt: 2 });
      span.end();
      const json = span.toJSON();
      expect(json.events).toHaveLength(1);
      expect((json.events as any[])[0].name).toBe('retry');
      expect((json.events as any[])[0].attrs).toEqual({ attempt: 2 });
    });

    it('toJSON omits empty attributes and events', () => {
      const span = new Span('test');
      span.end();
      const json = span.toJSON();
      expect(json.attributes).toBeUndefined();
      expect(json.events).toBeUndefined();
    });
  });

  describe('startSpan / endSpan', () => {
    it('creates nested spans', () => {
      const ctx = new RequestContext();
      const parent = ctx.startSpan('parent-op');
      expect(ctx.currentSpan).toBe(parent);

      const child = ctx.startSpan('child-op');
      expect(child.parentSpanId).toBe(parent.id);
      expect(ctx.currentSpan).toBe(child);
    });

    it('endSpan pops the stack', () => {
      const ctx = new RequestContext();
      ctx.startSpan('outer');
      ctx.startSpan('inner');
      const ended = ctx.endSpan('ok');
      expect(ended?.name).toBe('inner');
      expect(ended?.status).toBe('ok');
      expect(ctx.currentSpan?.name).toBe('outer');
    });

    it('endSpan returns undefined when no spans', () => {
      const ctx = new RequestContext();
      expect(ctx.endSpan()).toBeUndefined();
    });

    it('completed spans appear in toJSON', () => {
      const ctx = new RequestContext();
      ctx.startSpan('op');
      ctx.endSpan('ok');
      const json = ctx.toJSON();
      expect(json.spans).toHaveLength(1);
      expect((json.spans as any[])[0].name).toBe('op');
    });
  });

  describe('getTraceHeaders', () => {
    it('returns x-request-id and x-trace-id', () => {
      const ctx = new RequestContext();
      const headers = ctx.getTraceHeaders();
      expect(headers['x-request-id']).toBe(ctx.requestId);
      expect(headers['x-trace-id']).toBe(ctx.traceId);
    });

    it('includes x-span-id when a span is active', () => {
      const ctx = new RequestContext();
      const span = ctx.startSpan('op');
      const headers = ctx.getTraceHeaders();
      expect(headers['x-span-id']).toBe(span.id);
    });

    it('excludes x-span-id when no span is active', () => {
      const ctx = new RequestContext();
      const headers = ctx.getTraceHeaders();
      expect(headers['x-span-id']).toBeUndefined();
    });
  });

  describe('runWithContext / getContext', () => {
    it('getContext returns null outside a context', () => {
      expect(getContext()).toBeNull();
    });

    it('runWithContext propagates context', () => {
      const ctx = new RequestContext();
      runWithContext(ctx, () => {
        const retrieved = getContext();
        expect(retrieved).toBe(ctx);
        expect(retrieved?.requestId).toBe(ctx.requestId);
      });
    });

    it('getContext returns null after runWithContext completes', () => {
      const ctx = new RequestContext();
      runWithContext(ctx, () => {});
      expect(getContext()).toBeNull();
    });

    it('runWithContext supports nested contexts', () => {
      const outer = new RequestContext();
      const inner = new RequestContext();

      runWithContext(outer, () => {
        expect(getContext()).toBe(outer);
        runWithContext(inner, () => {
          expect(getContext()).toBe(inner);
        });
        expect(getContext()).toBe(outer);
      });
    });

    it('propagates through async callbacks', async () => {
      const ctx = new RequestContext();
      await new Promise<void>((resolve) => {
        runWithContext(ctx, () => {
          setTimeout(() => {
            expect(getContext()).toBe(ctx);
            resolve();
          }, 0);
        });
      });
    });
  });

  describe('createChildContext', () => {
    it('shares trace ID with parent', () => {
      const parent = new RequestContext();
      const child = createChildContext(parent);
      expect(child.traceId).toBe(parent.traceId);
    });

    it('has a different request ID than parent', () => {
      const parent = new RequestContext();
      const child = createChildContext(parent);
      expect(child.requestId).not.toBe(parent.requestId);
    });
  });

  describe('withSpan', () => {
    it('auto-ends span on success', async () => {
      const ctx = new RequestContext();

      await runWithContext(ctx, async () => {
        const result = await withSpan('test-op', (span) => {
          expect(span.name).toBe('test-op');
          return 42;
        });
        expect(result).toBe(42);
      });

      const json = ctx.toJSON();
      expect(json.spans).toHaveLength(1);
      expect((json.spans as any[])[0].status).toBe('ok');
    });

    it('auto-ends span with error status on throw', async () => {
      const ctx = new RequestContext();

      await expect(
        runWithContext(ctx, () =>
          withSpan('fail-op', () => {
            throw new Error('boom');
          }),
        ),
      ).rejects.toThrow('boom');

      const json = ctx.toJSON();
      expect(json.spans).toHaveLength(1);
      expect((json.spans as any[])[0].status).toBe('error');
    });

    it('works outside a context (creates standalone span)', async () => {
      const result = await withSpan('standalone', (span) => {
        expect(span.name).toBe('standalone');
        return 'ok';
      });
      expect(result).toBe('ok');
    });

    it('handles async functions', async () => {
      const ctx = new RequestContext();

      await runWithContext(ctx, () =>
        withSpan('async-op', async (span) => {
          await new Promise((r) => setTimeout(r, 5));
          span.setAttribute('async', true);
          return 'done';
        }),
      );

      const json = ctx.toJSON();
      expect(json.spans).toHaveLength(1);
      expect((json.spans as any[])[0].status).toBe('ok');
      expect((json.spans as any[])[0].attributes).toEqual({ async: true });
    });
  });

  describe('RequestContext.toJSON', () => {
    it('includes tags when set', () => {
      const ctx = new RequestContext();
      ctx.addTag('important');
      ctx.addTag('v2');
      const json = ctx.toJSON();
      expect(json.tags).toEqual(['important', 'v2']);
    });

    it('omits tags when empty', () => {
      const ctx = new RequestContext();
      const json = ctx.toJSON();
      expect(json.tags).toBeUndefined();
    });

    it('includes metadata when set', () => {
      const ctx = new RequestContext();
      ctx.setMetadata('userId', 'u123');
      const json = ctx.toJSON();
      expect(json.metadata).toEqual({ userId: 'u123' });
    });

    it('omits metadata when empty', () => {
      const ctx = new RequestContext();
      const json = ctx.toJSON();
      expect(json.metadata).toBeUndefined();
    });

    it('omits spans when none completed', () => {
      const ctx = new RequestContext();
      const json = ctx.toJSON();
      expect(json.spans).toBeUndefined();
    });
  });
});
