import fs from 'node:fs';
import path from 'node:path';
import { getSessionsDir, getStateSetDir } from '../../session.js';
import type { ShortcutLogger } from './types.js';
import {
  buildTopLevelLogger,
  formatToolResult,
  parsePositiveIntegerOption,
  sleep,
} from './utils.js';

interface ActivityEvent {
  key: string;
  ts: string;
  source: string;
  session?: string;
  message: string;
  raw: Record<string, unknown>;
}

function readJsonLines(filePath: string): Record<string, unknown>[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content
      .split(/\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry && typeof entry === 'object');
  } catch {
    return [];
  }
}

function normalizeEventMessage(entry: Record<string, unknown>, source: string): string {
  if (source === 'session-log') {
    return `${String(entry.role || 'unknown')}: ${String(entry.text || '').trim()}`;
  }
  if (source === 'tool-audit') {
    if (entry.type === 'tool_result') {
      return `${String(entry.name || '')} result ${entry.isError === true ? 'error' : 'ok'}`;
    }
    return `${String(entry.name || '')} call ${String(entry.decision || 'allow')}`;
  }
  return `${String(entry.name || entry.event || 'event')} ${String(entry.reason || '').trim()}`.trim();
}

function collectActivityEvents(sessionFilter?: string): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const sessionsDir = getSessionsDir();
  if (fs.existsSync(sessionsDir)) {
    let sessions: fs.Dirent[] = [];
    try {
      sessions = fs.readdirSync(sessionsDir, { withFileTypes: true });
    } catch {
      sessions = [];
    }

    for (const session of sessions) {
      if (!session.isDirectory()) {
        continue;
      }
      if (sessionFilter && session.name !== sessionFilter) {
        continue;
      }
      const sessionDir = path.join(sessionsDir, session.name);
      for (const [filename, source] of [
        ['log.jsonl', 'session-log'],
        ['tool-audit.jsonl', 'tool-audit'],
      ] as const) {
        const rows = readJsonLines(path.join(sessionDir, filename));
        for (const entry of rows) {
          const ts = String(entry.ts || '');
          events.push({
            key: `${source}:${session.name}:${ts}:${JSON.stringify(entry)}`,
            ts,
            source,
            session: session.name,
            message: normalizeEventMessage(entry, source),
            raw: entry,
          });
        }
      }
    }
  }

  const integrationPath = path.join(getStateSetDir(), 'integration-telemetry.jsonl');
  for (const entry of readJsonLines(integrationPath)) {
    const ts = String(entry.ts || '');
    events.push({
      key: `integration:${ts}:${JSON.stringify(entry)}`,
      ts,
      source: 'integration',
      message: normalizeEventMessage(entry, 'integration'),
      raw: entry,
    });
  }

  return events.sort((a, b) => Date.parse(a.ts || '0') - Date.parse(b.ts || '0'));
}

function matchesFilter(event: ActivityEvent, filter?: string): boolean {
  if (!filter) {
    return true;
  }
  const haystack =
    `${event.source} ${event.session || ''} ${event.message} ${JSON.stringify(event.raw)}`.toLowerCase();
  return haystack.includes(filter.toLowerCase());
}

function renderEvent(event: ActivityEvent): string {
  const session = event.session ? `[${event.session}] ` : '';
  return `${event.ts || '-'} ${session}${event.source} ${event.message}`.trim();
}

export async function runLogsCommand(
  args: string[],
  logger: ShortcutLogger,
  options: {
    json?: boolean;
    watch?: boolean;
    filter?: string;
    limit?: string;
    interval?: string;
    count?: string;
    session?: string;
  } = {},
): Promise<void> {
  const filter = options.filter || '';
  const limit = parsePositiveIntegerOption(options.limit) ?? 20;
  const intervalSeconds = parsePositiveIntegerOption(options.interval) ?? 2;
  const maxEvents = parsePositiveIntegerOption(options.count);
  const sessionFilter = options.session;

  const outputEvents = (events: ActivityEvent[]) => {
    const filtered = events.filter((event) => matchesFilter(event, filter));
    const recent = filtered.slice(-limit);
    if (options.json) {
      logger.output(JSON.stringify({ events: recent }, null, 2));
      return recent.length;
    }
    if (recent.length === 0) {
      logger.warning('No matching activity found.');
      return 0;
    }
    for (const event of recent) {
      logger.output(formatToolResult(renderEvent(event)));
    }
    return recent.length;
  };

  if (options.watch !== true) {
    outputEvents(collectActivityEvents(sessionFilter));
    return;
  }

  const seen = new Set(
    collectActivityEvents(sessionFilter)
      .filter((event) => matchesFilter(event, filter))
      .map((event) => event.key),
  );
  let emitted = 0;
  while (true) {
    const events = collectActivityEvents(sessionFilter).filter((event) =>
      matchesFilter(event, filter),
    );
    const next = events.filter((event) => !seen.has(event.key));
    for (const event of next) {
      seen.add(event.key);
      if (options.json) {
        logger.output(JSON.stringify(event, null, 2));
      } else {
        logger.output(formatToolResult(renderEvent(event)));
      }
      emitted += 1;
      if (maxEvents && emitted >= maxEvents) {
        return;
      }
    }
    await sleep(intervalSeconds * 1000);
  }
}

export async function runTopLevelLogs(
  args: string[] = [],
  options: {
    json?: boolean;
    watch?: boolean;
    filter?: string;
    limit?: string;
    interval?: string;
    count?: string;
    session?: string;
  } = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await runLogsCommand(args, logger, options);
}
