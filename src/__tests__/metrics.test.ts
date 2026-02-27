import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector } from '../lib/metrics.js';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  describe('increment', () => {
    it('accumulates correctly', () => {
      collector.increment('chat.messages');
      collector.increment('chat.messages');
      collector.increment('chat.messages', 3);

      const snap = collector.snapshot();
      expect(snap.counters['chat.messages']).toBe(5);
    });

    it('defaults to delta of 1', () => {
      collector.increment('sessions.started');
      expect(collector.snapshot().counters['sessions.started']).toBe(1);
    });
  });

  describe('histogram', () => {
    it('records values and computes correct percentiles', () => {
      // Add 100 values: 1..100
      for (let i = 1; i <= 100; i++) {
        collector.histogram('request.duration', i);
      }

      const snap = collector.snapshot();
      const summary = snap.histogramSummaries['request.duration'];
      expect(summary.count).toBe(100);
      expect(summary.p50).toBe(50);
      expect(summary.p95).toBe(95);
      expect(summary.p99).toBe(99);
    });

    it('handles single value', () => {
      collector.histogram('single', 42);
      const snap = collector.snapshot();
      expect(snap.histogramSummaries['single'].p50).toBe(42);
      expect(snap.histogramSummaries['single'].p95).toBe(42);
      expect(snap.histogramSummaries['single'].p99).toBe(42);
    });

    it('evicts oldest samples on overflow', () => {
      // Fill to capacity + 1
      for (let i = 0; i < 10_001; i++) {
        collector.histogram('overflow', i);
      }

      const snap = collector.snapshot();
      expect(snap.histogramSummaries['overflow'].count).toBe(10_000);
      // Oldest (0) should have been evicted, so min is 1
      // p50 should be around 5001
      expect(snap.histogramSummaries['overflow'].p50).toBeGreaterThanOrEqual(5000);
    });
  });

  describe('gauge', () => {
    it('sets and overwrites gauge values', () => {
      collector.gauge('session.historyLength', 10);
      collector.gauge('session.historyLength', 24);

      expect(collector.snapshot().gauges['session.historyLength']).toBe(24);
    });
  });

  describe('recordToolCall', () => {
    it('updates per-tool counters and histograms', () => {
      collector.recordToolCall('list_agents', 142, false);
      collector.recordToolCall('list_agents', 200, false);
      collector.recordToolCall('list_agents', 50, true);

      const snap = collector.snapshot();
      expect(snap.counters['tool.calls.list_agents']).toBe(3);
      expect(snap.counters['tool.errors.list_agents']).toBe(1);
      expect(snap.histogramSummaries['tool.duration.list_agents'].count).toBe(3);
    });

    it('appears in toolBreakdown sorted by call count', () => {
      collector.recordToolCall('tool_a', 100, false);
      collector.recordToolCall('tool_b', 100, false);
      collector.recordToolCall('tool_b', 100, false);

      const snap = collector.snapshot();
      expect(snap.toolBreakdown[0].name).toBe('tool_b');
      expect(snap.toolBreakdown[0].calls).toBe(2);
      expect(snap.toolBreakdown[1].name).toBe('tool_a');
      expect(snap.toolBreakdown[1].calls).toBe(1);
    });
  });

  describe('recordTokenUsage', () => {
    it('aggregates across multiple calls', () => {
      collector.recordTokenUsage({ input_tokens: 100, output_tokens: 50 });
      collector.recordTokenUsage({
        input_tokens: 200,
        output_tokens: 150,
        cache_creation_input_tokens: 30,
        cache_read_input_tokens: 20,
      });

      const snap = collector.snapshot();
      expect(snap.tokenUsage.inputTokens).toBe(300);
      expect(snap.tokenUsage.outputTokens).toBe(200);
      expect(snap.tokenUsage.cacheCreationInputTokens).toBe(30);
      expect(snap.tokenUsage.cacheReadInputTokens).toBe(20);
    });

    it('handles missing fields gracefully', () => {
      collector.recordTokenUsage({});
      const snap = collector.snapshot();
      expect(snap.tokenUsage.inputTokens).toBe(0);
      expect(snap.tokenUsage.outputTokens).toBe(0);
    });
  });

  describe('recordConnectionEvent', () => {
    it('appends events with timestamp', () => {
      collector.recordConnectionEvent({ type: 'connect', durationMs: 150 });
      collector.recordConnectionEvent({ type: 'disconnect' });

      const snap = collector.snapshot();
      expect(snap.connectionEvents).toHaveLength(2);
      expect(snap.connectionEvents[0].type).toBe('connect');
      expect(snap.connectionEvents[0].durationMs).toBe(150);
      expect(snap.connectionEvents[0].timestamp).toBeTruthy();
      expect(snap.connectionEvents[1].type).toBe('disconnect');
    });

    it('respects cap of 100 events', () => {
      for (let i = 0; i < 105; i++) {
        collector.recordConnectionEvent({ type: 'connect' });
      }

      const snap = collector.snapshot();
      expect(snap.connectionEvents).toHaveLength(100);
    });
  });

  describe('snapshot', () => {
    it('returns well-formed MetricsSnapshot with toolBreakdown', () => {
      collector.increment('chat.messages');
      collector.gauge('active.sessions', 2);
      collector.recordToolCall('search_kb', 300, false);
      collector.recordTokenUsage({ input_tokens: 500, output_tokens: 200 });
      collector.recordConnectionEvent({ type: 'connect', durationMs: 100 });

      const snap = collector.snapshot();
      expect(snap.counters).toBeDefined();
      expect(snap.gauges).toBeDefined();
      expect(snap.tokenUsage).toBeDefined();
      expect(snap.connectionEvents).toBeDefined();
      expect(snap.toolBreakdown).toBeDefined();
      expect(snap.histogramSummaries).toBeDefined();
      expect(snap.toolBreakdown[0].name).toBe('search_kb');
    });
  });

  describe('reset', () => {
    it('clears all state', () => {
      collector.increment('chat.messages', 10);
      collector.histogram('request.duration', 100);
      collector.gauge('active', 5);
      collector.recordTokenUsage({ input_tokens: 1000, output_tokens: 500 });
      collector.recordConnectionEvent({ type: 'connect' });
      collector.recordToolCall('test_tool', 50, false);

      collector.reset();

      const snap = collector.snapshot();
      expect(Object.keys(snap.counters)).toHaveLength(0);
      expect(Object.keys(snap.gauges)).toHaveLength(0);
      expect(Object.keys(snap.histogramSummaries)).toHaveLength(0);
      expect(snap.tokenUsage.inputTokens).toBe(0);
      expect(snap.tokenUsage.outputTokens).toBe(0);
      expect(snap.connectionEvents).toHaveLength(0);
      expect(snap.toolBreakdown).toHaveLength(0);
    });
  });

  describe('toJSON', () => {
    it('returns snapshot for JSON serialization', () => {
      collector.increment('test', 1);
      const json = collector.toJSON();
      expect(json.counters['test']).toBe(1);
      expect(JSON.stringify(json)).toBeTruthy();
    });
  });
});
