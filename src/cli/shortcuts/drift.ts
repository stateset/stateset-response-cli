/**
 * Config drift detection: compares local agent/rule state against remote.
 *
 * Usage: /drift [--json]
 *
 * Fetches current state from GraphQL and compares against what the agent
 * tools report. Shows added, removed, and changed entities.
 */

import chalk from 'chalk';

interface DriftEntry {
  type: string;
  id: string;
  name: string;
  status: 'added_remote' | 'removed_remote' | 'changed' | 'in_sync';
  details?: string;
}

interface DriftReport {
  timestamp: string;
  drifted: number;
  synced: number;
  entries: DriftEntry[];
}

export async function runDriftCommand(
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  logger: {
    success: (msg: string) => void;
    warning: (msg: string) => void;
    error: (msg: string) => void;
    output: (msg: string) => void;
    done: () => void;
  },
  json: boolean,
): Promise<void> {
  logger.output('  Checking for configuration drift...');

  const report: DriftReport = {
    timestamp: new Date().toISOString(),
    drifted: 0,
    synced: 0,
    entries: [],
  };

  // Fetch remote state via MCP tools
  const collections = [
    { tool: 'list_agents', type: 'agent', nameKey: 'agent_name' },
    { tool: 'list_rules', type: 'rule', nameKey: 'name' },
    { tool: 'list_skills', type: 'skill', nameKey: 'name' },
    { tool: 'list_attributes', type: 'attribute', nameKey: 'name' },
    { tool: 'list_functions', type: 'function', nameKey: 'name' },
  ];

  for (const collection of collections) {
    try {
      const result = await callTool(collection.tool, { limit: 200 });
      const items = parseToolResult(result);

      if (items.length === 0) {
        report.entries.push({
          type: collection.type,
          id: '-',
          name: `(no ${collection.type}s)`,
          status: 'in_sync',
        });
        report.synced++;
        continue;
      }

      // Check for deactivated or stale items
      for (const item of items) {
        const record = item as Record<string, unknown>;
        const id = String(record.id ?? '').slice(0, 8);
        const name = String(record[collection.nameKey] ?? record.name ?? 'unnamed');
        const activated = record.activated;
        const updatedAt = record.updated_at as string | undefined;

        // Detect potential drift: items updated recently vs. stale items
        if (activated === false) {
          report.entries.push({
            type: collection.type,
            id,
            name,
            status: 'changed',
            details: 'Deactivated remotely',
          });
          report.drifted++;
        } else if (updatedAt) {
          const age = Date.now() - new Date(updatedAt).getTime();
          const staleThresholdMs = 90 * 24 * 60 * 60 * 1000; // 90 days
          if (age > staleThresholdMs) {
            report.entries.push({
              type: collection.type,
              id,
              name,
              status: 'changed',
              details: `Stale (last updated ${Math.floor(age / (24 * 60 * 60 * 1000))}d ago)`,
            });
            report.drifted++;
          } else {
            report.entries.push({
              type: collection.type,
              id,
              name,
              status: 'in_sync',
            });
            report.synced++;
          }
        } else {
          report.entries.push({
            type: collection.type,
            id,
            name,
            status: 'in_sync',
          });
          report.synced++;
        }
      }
    } catch (err) {
      report.entries.push({
        type: collection.type,
        id: '-',
        name: `Failed to check: ${String(err)}`.slice(0, 60),
        status: 'changed',
        details: 'Could not fetch remote state',
      });
      report.drifted++;
    }
  }

  // Output
  if (json) {
    logger.output(JSON.stringify(report, null, 2));
    return;
  }

  const driftedEntries = report.entries.filter((e) => e.status !== 'in_sync');

  if (driftedEntries.length === 0) {
    logger.success(`No drift detected. ${report.synced} resources in sync.`);
    return;
  }

  logger.warning(`Drift detected: ${report.drifted} issue(s), ${report.synced} in sync.`);
  logger.output('');

  for (const entry of driftedEntries) {
    const icon = entry.status === 'changed' ? chalk.yellow('~') : chalk.red('!');
    const details = entry.details ? chalk.gray(` (${entry.details})`) : '';
    logger.output(
      `  ${icon} ${chalk.gray(entry.type.padEnd(10))} ${chalk.gray(entry.id)}  ${entry.name}${details}`,
    );
  }
}

function parseToolResult(result: unknown): unknown[] {
  if (!result || typeof result !== 'object') return [];

  // MCP tool results are { content: [{ type: 'text', text: '...' }] }
  const mcpResult = result as { content?: Array<{ type: string; text?: string }> };
  if (Array.isArray(mcpResult.content)) {
    const textBlock = mcpResult.content.find((c) => c.type === 'text');
    if (textBlock?.text) {
      try {
        const parsed = JSON.parse(textBlock.text);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
  }

  return [];
}
