/**
 * Lightweight in-process metrics collector for StateSet Response CLI.
 *
 * Zero external dependencies. Provides counters, histograms, gauges,
 * token usage aggregation, and MCP connection lifecycle tracking.
 */

const MAX_HISTOGRAM_SAMPLES = 10_000;
const MAX_CONNECTION_EVENTS = 100;

export interface TokenUsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface ConnectionEvent {
  type: 'connect' | 'disconnect' | 'error';
  timestamp: string;
  durationMs?: number;
  error?: string;
}

export interface ToolBreakdownEntry {
  name: string;
  calls: number;
  errors: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface MetricsSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  tokenUsage: TokenUsageSummary;
  connectionEvents: ConnectionEvent[];
  toolBreakdown: ToolBreakdownEntry[];
  histogramSummaries: Record<string, { count: number; p50: number; p95: number; p99: number }>;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

export class MetricsCollector {
  private counters = new Map<string, number>();
  private histograms = new Map<string, number[]>();
  private gauges = new Map<string, number>();
  private tokenUsage: TokenUsageSummary = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
  private connectionEvents: ConnectionEvent[] = [];

  increment(name: string, delta = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + delta);
  }

  histogram(name: string, value: number): void {
    let samples = this.histograms.get(name);
    if (!samples) {
      samples = [];
      this.histograms.set(name, samples);
    }
    if (samples.length >= MAX_HISTOGRAM_SAMPLES) {
      samples.shift();
    }
    samples.push(value);
  }

  gauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  recordToolCall(name: string, durationMs: number, isError: boolean): void {
    this.increment(`tool.calls.${name}`);
    if (isError) {
      this.increment(`tool.errors.${name}`);
    }
    this.histogram(`tool.duration.${name}`, durationMs);
  }

  recordTokenUsage(usage: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  }): void {
    this.tokenUsage.inputTokens += usage.input_tokens ?? 0;
    this.tokenUsage.outputTokens += usage.output_tokens ?? 0;
    this.tokenUsage.cacheCreationInputTokens += usage.cache_creation_input_tokens ?? 0;
    this.tokenUsage.cacheReadInputTokens += usage.cache_read_input_tokens ?? 0;
  }

  recordConnectionEvent(event: Omit<ConnectionEvent, 'timestamp'>): void {
    if (this.connectionEvents.length >= MAX_CONNECTION_EVENTS) {
      this.connectionEvents.shift();
    }
    this.connectionEvents.push({
      ...event,
      timestamp: new Date().toISOString(),
    });
  }

  snapshot(): MetricsSnapshot {
    const counters: Record<string, number> = {};
    for (const [k, v] of this.counters) {
      counters[k] = v;
    }

    const gauges: Record<string, number> = {};
    for (const [k, v] of this.gauges) {
      gauges[k] = v;
    }

    const histogramSummaries: MetricsSnapshot['histogramSummaries'] = {};
    for (const [k, samples] of this.histograms) {
      const sorted = [...samples].sort((a, b) => a - b);
      histogramSummaries[k] = {
        count: sorted.length,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
      };
    }

    // Build tool breakdown from per-tool counters/histograms
    const toolNames = new Set<string>();
    for (const key of this.counters.keys()) {
      const match = key.match(/^tool\.calls\.(.+)$/);
      if (match) toolNames.add(match[1]);
    }

    const toolBreakdown: ToolBreakdownEntry[] = [];
    for (const name of toolNames) {
      const calls = this.counters.get(`tool.calls.${name}`) ?? 0;
      const errors = this.counters.get(`tool.errors.${name}`) ?? 0;
      const samples = this.histograms.get(`tool.duration.${name}`);
      const sorted = samples ? [...samples].sort((a, b) => a - b) : [];
      toolBreakdown.push({
        name,
        calls,
        errors,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        p99Ms: percentile(sorted, 99),
      });
    }
    toolBreakdown.sort((a, b) => b.calls - a.calls);

    return {
      counters,
      gauges,
      tokenUsage: { ...this.tokenUsage },
      connectionEvents: [...this.connectionEvents],
      toolBreakdown,
      histogramSummaries,
    };
  }

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
    this.tokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    };
    this.connectionEvents = [];
  }

  toJSON(): MetricsSnapshot {
    return this.snapshot();
  }
}

/** Singleton instance used across the CLI process. */
export const metrics = new MetricsCollector();
