/**
 * Historical token/cost trends from persistent session metrics.
 *
 * Reads saved metrics from ~/.stateset/metrics/*.json and aggregates
 * them into daily/weekly summaries with cost projections.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { calculateCost, formatUsd } from './pricing.js';
import { readJsonFile } from '../utils/file-read.js';

interface SessionMetricsRecord {
  sessionId: string;
  savedAt: string;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
  counters: Record<string, number>;
  toolBreakdown?: Array<{ tool: string; calls: number; errors: number; avgMs: number }>;
}

export interface DailyAggregate {
  date: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  toolCalls: number;
}

export interface TrendsSummary {
  totalSessions: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  dailyBreakdown: DailyAggregate[];
  topSessionsByCost: Array<{ sessionId: string; date: string; cost: number; tokens: number }>;
  avgCostPerSession: number;
  avgTokensPerSession: number;
  projectedMonthlyCost: number | null;
}

function getMetricsDir(): string {
  const stateDir = process.env.STATESET_STATE_DIR || path.join(os.homedir(), '.stateset');
  return path.join(stateDir, 'metrics');
}

function loadAllMetrics(): SessionMetricsRecord[] {
  const dir = getMetricsDir();
  if (!fs.existsSync(dir)) return [];

  const records: SessionMetricsRecord[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }

  for (const filename of entries) {
    try {
      const parsed = readJsonFile(path.join(dir, filename), {
        label: 'session metrics file',
        expectObject: true,
      }) as SessionMetricsRecord;
      if (parsed.sessionId && parsed.savedAt && parsed.tokenUsage) {
        records.push(parsed);
      }
    } catch {
      // Skip corrupted files
    }
  }

  return records.sort((a, b) => new Date(a.savedAt).getTime() - new Date(b.savedAt).getTime());
}

/**
 * Aggregate all saved session metrics into trends.
 */
export function computeTrends(days?: number): TrendsSummary {
  let records = loadAllMetrics();

  if (days !== undefined && days > 0) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    records = records.filter((r) => new Date(r.savedAt).getTime() >= cutoff);
  }

  if (records.length === 0) {
    return {
      totalSessions: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      dailyBreakdown: [],
      topSessionsByCost: [],
      avgCostPerSession: 0,
      avgTokensPerSession: 0,
      projectedMonthlyCost: null,
    };
  }

  const dailyMap = new Map<string, DailyAggregate>();
  const sessionCosts: Array<{
    sessionId: string;
    date: string;
    cost: number;
    tokens: number;
  }> = [];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;

  for (const record of records) {
    const date = record.savedAt.slice(0, 10); // YYYY-MM-DD
    const usage = record.tokenUsage;
    const cost = calculateCost(usage, 'claude-sonnet-4-6');
    const totalTokens = usage.inputTokens + usage.outputTokens;
    const toolCalls = record.toolBreakdown?.reduce((sum, t) => sum + t.calls, 0) ?? 0;

    totalInputTokens += usage.inputTokens;
    totalOutputTokens += usage.outputTokens;
    totalCost += cost.totalCost;

    sessionCosts.push({
      sessionId: record.sessionId,
      date,
      cost: cost.totalCost,
      tokens: totalTokens,
    });

    const existing = dailyMap.get(date);
    if (existing) {
      existing.sessions++;
      existing.inputTokens += usage.inputTokens;
      existing.outputTokens += usage.outputTokens;
      existing.totalTokens += totalTokens;
      existing.estimatedCost += cost.totalCost;
      existing.toolCalls += toolCalls;
    } else {
      dailyMap.set(date, {
        date,
        sessions: 1,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens,
        estimatedCost: cost.totalCost,
        toolCalls,
      });
    }
  }

  const dailyBreakdown = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  // Monthly projection based on recent daily average
  let projectedMonthlyCost: number | null = null;
  if (dailyBreakdown.length >= 2) {
    const recentDays = dailyBreakdown.slice(-7);
    const avgDailyCost =
      recentDays.reduce((sum, d) => sum + d.estimatedCost, 0) / recentDays.length;
    projectedMonthlyCost = avgDailyCost * 30;
  }

  // Top sessions by cost
  const topSessionsByCost = sessionCosts.sort((a, b) => b.cost - a.cost).slice(0, 10);

  return {
    totalSessions: records.length,
    totalInputTokens,
    totalOutputTokens,
    totalCost,
    dailyBreakdown,
    topSessionsByCost,
    avgCostPerSession: totalCost / records.length,
    avgTokensPerSession: (totalInputTokens + totalOutputTokens) / records.length,
    projectedMonthlyCost,
  };
}

/**
 * Format trends summary for display.
 */
export function formatTrendsSummary(summary: TrendsSummary): string {
  const lines: string[] = [];

  lines.push(`Sessions:        ${summary.totalSessions}`);
  lines.push(
    `Total tokens:    ${(summary.totalInputTokens + summary.totalOutputTokens).toLocaleString()} (${summary.totalInputTokens.toLocaleString()} in / ${summary.totalOutputTokens.toLocaleString()} out)`,
  );
  lines.push(`Total cost:      ${formatUsd(summary.totalCost)}`);
  lines.push(`Avg cost/session: ${formatUsd(summary.avgCostPerSession)}`);
  lines.push(`Avg tokens/session: ${Math.round(summary.avgTokensPerSession).toLocaleString()}`);

  if (summary.projectedMonthlyCost !== null) {
    lines.push(
      `Monthly projection: ~${formatUsd(summary.projectedMonthlyCost)} (based on last 7 days)`,
    );
  }

  if (summary.dailyBreakdown.length > 0) {
    lines.push('');
    lines.push('Daily breakdown (recent):');
    for (const day of summary.dailyBreakdown.slice(-14)) {
      const bar = '█'.repeat(
        Math.min(20, Math.round((day.estimatedCost / (summary.totalCost || 1)) * 100)),
      );
      lines.push(
        `  ${day.date}  ${String(day.sessions).padStart(3)} sessions  ${formatUsd(day.estimatedCost).padStart(8)}  ${bar}`,
      );
    }
  }

  return lines.join('\n');
}
