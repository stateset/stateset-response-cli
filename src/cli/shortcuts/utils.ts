import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { configExists, getRuntimeContext } from '../../config.js';
import { StateSetAgent } from '../../agent.js';
import { exportOrg, importOrg, type ImportResult, type OrgExport } from '../../export-import.js';
import { readJsonFile } from '../../utils/file-read.js';
import { getErrorMessage } from '../../lib/errors.js';
import {
  formatError,
  formatBytes,
  formatSuccess,
  formatWarning,
  formatToolResult,
  formatTable,
  printAuthHelp,
} from '../../utils/display.js';
import { parseToggleValue } from '../utils.js';
import { resolveSafeOutputPath } from '../utils.js';
import type { ChatContext } from '../types.js';
import type {
  AnyPayload,
  ShortcutLogger,
  ShortcutRunner,
  TopLevelOptions,
  WatchOptions,
  ParsedDateRange,
  SnapshotInfo,
  SnapshotReadResult,
  SnapshotPathResult,
  SnapshotDiffRow,
  DiffSummary,
  StateSetBundleManifest,
  StateSetResourceField,
} from './types.js';
import {
  DEFAULT_LIST_LIMIT,
  DEFAULT_LIST_OFFSET,
  DEFAULT_SNAPSHOT_DIR,
  DEFAULT_SNAPSHOT_PREFIX,
  DEFAULT_STATESET_DIR,
  DEFAULT_STATESET_BUNDLE_FILE,
  DEFAULT_STATESET_CONFIG_FILE,
  STATESET_RESOURCE_MAP,
  SNAPSHOT_RESOURCE_FIELDS,
} from './types.js';

export function parseDateInput(rawInput: string | undefined): number | undefined {
  if (!rawInput) return undefined;
  const input = rawInput.trim();
  if (!input) return undefined;

  const lower = input.toLowerCase();
  const now = Date.now();
  if (['now', 'today', 'current'].includes(lower)) {
    return now;
  }

  const relativeMatch = /^([+-]?\d+)\s*([smhdw])$/i.exec(input);
  if (relativeMatch) {
    const amount = Number.parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2].toLowerCase();
    if (!Number.isFinite(amount)) return undefined;
    const multiplier = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
      w: 604_800_000,
    } as const;
    return now + amount * multiplier[unit as keyof typeof multiplier];
  }

  const parsed = Date.parse(input);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return parsed;
}

export function nowSuffix(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function ensureSnapshotDir(): string {
  fs.mkdirSync(DEFAULT_SNAPSHOT_DIR, { recursive: true });
  return DEFAULT_SNAPSHOT_DIR;
}

export function defaultSnapshotName(label?: string): string {
  const suffix = nowSuffix();
  return `${DEFAULT_SNAPSHOT_PREFIX}${label ? `-${label}` : ''}-${suffix}.json`;
}

export function resolveSafeOutputJsonPath(
  rawPath: string | undefined,
  defaultName: string,
): string {
  const target = (rawPath || '').trim();
  if (!target) {
    const fallback = path.join(process.cwd(), defaultName);
    return resolveSafeOutputPath(fallback, { label: 'Export path' });
  }

  const candidate = path.resolve(target);
  if (target.endsWith(path.sep) || target.endsWith('/')) {
    return resolveSafeOutputPath(path.join(candidate, defaultName), { label: 'Export path' });
  }

  try {
    if (fs.existsSync(candidate) && fs.lstatSync(candidate).isDirectory()) {
      return resolveSafeOutputPath(path.join(candidate, defaultName), { label: 'Export path' });
    }
  } catch {
    // ignore and continue with direct path resolution
  }

  if (path.extname(candidate)) {
    return resolveSafeOutputPath(candidate, { label: 'Export path' });
  }

  return resolveSafeOutputPath(path.join(candidate, defaultName), { label: 'Export path' });
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`;
}

export function buildSlashLogger(ctx: ChatContext): ShortcutLogger {
  return {
    success: (message) => console.log(formatSuccess(message)),
    warning: (message) => console.log(formatWarning(message)),
    error: (message) => console.error(formatError(message)),
    output: (text) => console.log(text),
    done: () => {
      ctx.rl.prompt();
    },
  };
}

export function buildTopLevelLogger(): ShortcutLogger {
  return {
    success: (message) => console.log(formatSuccess(message)),
    warning: (message) => console.log(formatWarning(message)),
    error: (message) => console.error(formatError(message)),
    output: (text) => console.log(text),
    done: () => {
      // no-op for top-level commands
    },
  };
}

export function toLines(tokens: string[]): string[] {
  return tokens.map((token) => token.trim()).filter(Boolean);
}

export function parseOptionLike(value: string): [string, string | null] {
  const separator = value.indexOf('=');
  if (separator === -1) return [value, null];
  return [value.slice(0, separator), value.slice(separator + 1)];
}

export function parseCommandArgs(tokens: string[]) {
  const options: Record<string, string> = {};
  const positionals: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (!token.startsWith('--')) {
      positionals.push(token);
      i += 1;
      continue;
    }
    const [keyRaw, inlineValue] = parseOptionLike(token);
    const key = keyRaw.replace(/^--/, '');
    if (key === 'json' || key === 'help' || key === 'yes') {
      options[key] = 'true';
      i += 1;
      continue;
    }
    const value =
      inlineValue !== null ? inlineValue : i + 1 < tokens.length ? tokens[i + 1] : undefined;
    if (value === undefined) {
      throw new Error(`Missing value for option --${key}.`);
    }
    options[key] = inlineValue !== null ? inlineValue : value;
    i += inlineValue === null ? 2 : 1;
  }
  return { options, positionals };
}

export function parsePeriodRangeAsIso(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (!/^\d+[smhdw]$/i.test(raw.trim())) return undefined;
  const parsed = parseDateInput(`-${raw.trim()}`);
  if (parsed === undefined) return undefined;
  return new Date(parsed).toISOString();
}

export function parseTopLevelOptionsFromSlashArgs(options: Record<string, string>): WatchOptions {
  const fromOptions = options.from;
  const toOptions = options.to;
  const sinceValue = options.since;
  const periodValue = options.period;
  const includeSecretsValue = options.includeSecrets || options['include-secrets'];
  const dryRunValue = options.dryRun || options['dry-run'];
  const yesValue = options.yes;
  const strictValue = options.strict;
  const outValue = options.out;
  const scheduleValue = options.schedule;
  const approveValue = options.approve;
  const intervalValue = options.interval;
  const onceValue = options.once;
  const fromFromPeriod = periodValue ? parsePeriodRangeAsIso(periodValue) : undefined;

  return {
    json: options.json === 'true',
    from: fromOptions || sinceValue || fromFromPeriod,
    since: sinceValue,
    period: fromFromPeriod || periodValue,
    to: toOptions,
    schedule: scheduleValue,
    approve: approveValue,
    dryRun: parseToggleValue(dryRunValue),
    yes: parseToggleValue(yesValue),
    strict: parseToggleValue(strictValue),
    out: outValue,
    includeSecrets: parseToggleValue(includeSecretsValue),
    interval: intervalValue,
    once: parseToggleValue(onceValue),
  };
}

export function toPositiveInteger(
  input: string | undefined,
  fallback: number,
  max: number,
): number {
  if (!input) return fallback;
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  if (Number.isInteger(parsed)) return Math.min(parsed, max);
  return fallback;
}

export function toNonNegativeInteger(
  input: string | undefined,
  fallback: number,
  max: number,
): number {
  if (!input) return fallback;
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  if (Number.isInteger(parsed)) return Math.min(parsed, max);
  return fallback;
}

export function parseListArgs(tokens: string[]) {
  const { options, positionals } = parseCommandArgs(tokens);
  return {
    limit: toPositiveInteger(options.limit, DEFAULT_LIST_LIMIT, 1000),
    offset: toNonNegativeInteger(options.offset, DEFAULT_LIST_OFFSET, 100000),
    options,
    positionals,
  };
}

export function parseDateRange(
  fromInput: string | undefined,
  toInput: string | undefined,
): ParsedDateRange {
  const result: ParsedDateRange = {
    warnings: [],
  };

  if (fromInput) {
    const fromTime = parseDateInput(fromInput);
    if (fromTime === undefined) {
      result.warnings.push(`Ignoring invalid --from date: ${fromInput}`);
    } else {
      result.from = fromTime;
    }
  }

  if (toInput) {
    const toTime = parseDateInput(toInput);
    if (toTime === undefined) {
      result.warnings.push(`Ignoring invalid --to date: ${toInput}`);
    } else {
      result.to = toTime;
    }
  }

  if (result.from !== undefined && result.to !== undefined && result.from > result.to) {
    result.warnings.push('--from is after --to; range will not be applied');
    result.from = undefined;
    result.to = undefined;
  }

  return result;
}

export function isInDateRange(value: unknown, from?: number, to?: number): boolean {
  if (from === undefined && to === undefined) return true;
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  if (from !== undefined && parsed < from) return false;
  if (to !== undefined && parsed > to) return false;
  return true;
}

export function printPayload(
  logger: ShortcutLogger,
  label: string,
  payload: AnyPayload,
  asJson: boolean,
): void {
  logger.success(label);
  if (asJson) {
    logger.output(JSON.stringify(payload, (k, v) => (typeof v === 'bigint' ? String(v) : v), 2));
    return;
  }

  if (typeof payload === 'string') {
    logger.output(formatToolResult(payload));
    return;
  }

  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      logger.output(chalk.gray('  (empty)'));
      return;
    }

    const rows: Array<Record<string, string>> = [];
    const columns = new Set<string>();
    for (const item of payload) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const row: Record<string, string> = {};
        for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
          row[key] = typeof value === 'string' ? value : JSON.stringify(value);
          columns.add(key);
        }
        rows.push(row);
      } else {
        rows.push({ value: JSON.stringify(item) });
        columns.add('value');
      }
    }
    logger.output(formatTable(rows, Array.from(columns)));
    return;
  }

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    logger.output(formatToolResult(JSON.stringify(payload, null, 2)));
    return;
  }

  logger.output(formatToolResult(String(payload ?? '')));
}

export function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function asStringRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function extractAggregateCount(payload: unknown, collectionName: string): number {
  const root = asStringRecord(payload);
  const collection = asStringRecord(root[collectionName]);
  const aggregate = asStringRecord(collection.aggregate);
  const fromCollection = aggregate.count;
  if (typeof fromCollection === 'number' && Number.isFinite(fromCollection)) {
    return fromCollection;
  }
  const fallbackAggregate = asStringRecord(root.aggregate);
  const fallbackCount = fallbackAggregate.count;
  return typeof fallbackCount === 'number' && Number.isFinite(fallbackCount) ? fallbackCount : 0;
}

export function asRecordArray(payload: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(payload)) return [];
  return payload.filter(
    (entry): entry is Record<string, unknown> =>
      entry !== null && typeof entry === 'object' && !Array.isArray(entry),
  );
}

export function toDisplayValue(value: unknown): string {
  if (value === undefined || value === null) return '-';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

export function parsePositiveIntegerOption(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) return undefined;
  return value;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function listSnapshotInfos(): SnapshotInfo[] {
  const dir = ensureSnapshotDir();
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const snapshots = entries
    .filter((entry) => entry.isFile())
    .filter((entry) => entry.name.endsWith('.json'))
    .map((entry) => {
      const fullPath = path.join(dir, entry.name);
      const info = fs.statSync(fullPath);
      const id = entry.name.replace(/\.json$/i, '');
      return {
        id,
        file: entry.name,
        path: fullPath,
        size: info.size,
        modifiedAt: info.mtimeMs,
      } as SnapshotInfo;
    })
    .filter(
      (entry) => entry.id.startsWith(DEFAULT_SNAPSHOT_PREFIX) || entry.id.includes('snapshot'),
    )
    .sort((a, b) => b.modifiedAt - a.modifiedAt);

  return snapshots;
}

export function resolveSnapshotPath(reference?: string): string | null {
  const snapshots = listSnapshotInfos();
  if (snapshots.length === 0) {
    return null;
  }

  if (!reference) {
    return snapshots[0].path;
  }

  const trimmed = reference.trim();
  if (!trimmed) return snapshots[0].path;

  const resolved = path.resolve(trimmed);
  if (fs.existsSync(resolved) && fs.lstatSync(resolved).isFile()) {
    return resolved;
  }

  const normalized = path
    .basename(trimmed)
    .replace(/\.json$/i, '')
    .toLowerCase();
  const exact = snapshots.find(
    (entry) =>
      entry.id.toLowerCase() === normalized ||
      path.basename(entry.path).toLowerCase() === `${normalized}.json` ||
      entry.file.toLowerCase() === `${normalized}.json`,
  );
  if (exact) return exact.path;

  const startsWith = snapshots.filter((entry) => entry.id.toLowerCase().startsWith(normalized));
  if (startsWith.length === 1) return startsWith[0].path;
  if (startsWith.length > 1) {
    throw new Error(`Snapshot reference "${reference}" is ambiguous.`);
  }

  const contains = snapshots.filter((entry) => entry.id.toLowerCase().includes(normalized));
  if (contains.length === 1) return contains[0].path;

  return null;
}

export function readSnapshot(pathOrRef: string): OrgExport {
  const snapshotPath = resolveSnapshotPath(pathOrRef);
  if (!snapshotPath) {
    throw new Error(`Snapshot not found: ${pathOrRef}`);
  }
  const parsed = readJsonFile(snapshotPath, {
    label: 'snapshot file',
    expectObject: true,
  }) as OrgExport;
  if (!parsed || typeof parsed !== 'object' || !parsed.version || !parsed.orgId) {
    throw new Error(`Invalid snapshot format: ${pathOrRef}`);
  }
  return parsed;
}

export function extractEntityRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === 'object' && !Array.isArray(item),
  );
}

export function extractEntityId(item: Record<string, unknown>, index: number): string {
  if (typeof item.id === 'string') return item.id;
  if (typeof item.uuid === 'string') return item.uuid;
  if (typeof item.agent_name === 'string') return `agent:${item.agent_name}`;
  if (typeof item.rule_name === 'string') return `rule:${item.rule_name}`;
  if (typeof item.name === 'string') return `name:${item.name}`;
  return `index:${index}`;
}

export function buildDiffRows(before: OrgExport, after: OrgExport): SnapshotDiffRow[] {
  return SNAPSHOT_RESOURCE_FIELDS.map((field) => {
    const beforeRows = extractEntityRows(before[field]);
    const afterRows = extractEntityRows(after[field]);

    const beforeMap = new Map<string, string>();
    for (let i = 0; i < beforeRows.length; i++) {
      const row = beforeRows[i];
      if (!row) continue;
      beforeMap.set(extractEntityId(row, i), stableStringify(row));
    }

    const afterMap = new Map<string, string>();
    for (let i = 0; i < afterRows.length; i++) {
      const row = afterRows[i];
      if (!row) continue;
      afterMap.set(extractEntityId(row, i), stableStringify(row));
    }

    const fromSet = new Set(beforeMap.keys());
    const toSet = new Set(afterMap.keys());

    let added = 0;
    let removed = 0;
    let changed = 0;

    for (const key of toSet) {
      if (!fromSet.has(key)) {
        added += 1;
        continue;
      }
      if (beforeMap.get(key) !== afterMap.get(key)) {
        changed += 1;
      }
    }

    for (const key of fromSet) {
      if (!toSet.has(key)) {
        removed += 1;
      }
    }

    return {
      collection: field,
      from: beforeRows.length,
      to: afterRows.length,
      added,
      removed,
      changed,
    };
  });
}

export function buildDiffSummary(
  before: OrgExport,
  after: OrgExport,
  beforeRef: string,
  afterRef: string,
): DiffSummary {
  return {
    from: beforeRef,
    to: afterRef,
    rows: buildDiffRows(before, after),
  };
}

export function resolveStateSetDir(rawDir?: string): string {
  const target = path.resolve(rawDir || DEFAULT_STATESET_DIR);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

export function normalizeStateSetSource(rawSource?: string): string {
  const fallback = DEFAULT_STATESET_DIR;
  const trimmed = (rawSource || '').trim();
  if (!trimmed) {
    return fallback;
  }
  return path.resolve(trimmed);
}

export function coerceResourceArray(field: string, value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${field}: expected an array.`);
  }
  return value;
}

export function coerceOrgExportPayload(payload: unknown): OrgExport {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid state set payload: not an object.');
  }

  const base = payload as Record<string, unknown>;
  const version =
    typeof base.version === 'string' && base.version.trim().length > 0 ? base.version : '1.0.0';
  const orgId =
    typeof base.orgId === 'string' && base.orgId.trim().length > 0 ? base.orgId : 'unknown';
  const exportedAt =
    typeof base.exportedAt === 'string' && base.exportedAt.trim().length > 0
      ? base.exportedAt
      : new Date().toISOString();

  const exportData: OrgExport = {
    version,
    orgId,
    exportedAt,
    agents: coerceResourceArray('agents', base.agents ?? []),
    rules: coerceResourceArray('rules', base.rules ?? []),
    skills: coerceResourceArray('skills', base.skills ?? []),
    attributes: coerceResourceArray('attributes', base.attributes ?? []),
    functions: coerceResourceArray('functions', base.functions ?? []),
    examples: coerceResourceArray('examples', base.examples ?? []),
    evals: coerceResourceArray('evals', base.evals ?? []),
    datasets: coerceResourceArray('datasets', base.datasets ?? []),
    agentSettings: coerceResourceArray(
      'agentSettings',
      base.agentSettings ?? base.agent_settings ?? [],
    ),
  };

  return exportData;
}

export function readStateSetBundle(source: string): OrgExport {
  const sourcePath = path.resolve(source);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`StateSet source not found: ${source}`);
  }
  const stats = fs.lstatSync(sourcePath);

  if (stats.isFile()) {
    try {
      const parsed = readJsonFile(sourcePath, {
        label: 'state set file',
        expectObject: true,
      }) as unknown;
      return coerceOrgExportPayload(parsed);
    } catch (error) {
      throw new Error(`Invalid state set file ${sourcePath}: ${getErrorMessage(error)}`);
    }
  }

  if (!stats.isDirectory()) {
    throw new Error(`StateSet source must be a file or directory: ${sourcePath}`);
  }

  const manifestPath = path.join(sourcePath, DEFAULT_STATESET_BUNDLE_FILE);
  if (fs.existsSync(manifestPath)) {
    try {
      const manifestParsed = readJsonFile(manifestPath, {
        label: 'state set manifest',
        expectObject: true,
      }) as unknown;
      if (manifestParsed && typeof manifestParsed === 'object') {
        const candidate = manifestParsed as Record<string, unknown>;
        if (candidate.version && candidate.orgId && Array.isArray(candidate.agents)) {
          return coerceOrgExportPayload(candidate);
        }
      }
    } catch {
      // fall through to directory decomposition
    }
  }

  const output: OrgExport = {
    version: '1.0.0',
    orgId: 'unknown',
    exportedAt: new Date().toISOString(),
    agents: [],
    rules: [],
    skills: [],
    attributes: [],
    functions: [],
    examples: [],
    evals: [],
    datasets: [],
    agentSettings: [],
  };

  const configPath = path.join(sourcePath, DEFAULT_STATESET_CONFIG_FILE);
  if (fs.existsSync(configPath)) {
    try {
      const config = readJsonFile(configPath, {
        label: 'state set config',
        expectObject: true,
      }) as StateSetBundleManifest;
      if (config.version) {
        output.version = config.version;
      }
      if (config.orgId) {
        output.orgId = config.orgId;
      }
      if (config.exportedAt) {
        output.exportedAt = config.exportedAt;
      }
    } catch {
      // intentionally ignore malformed metadata and continue from file fragments
    }
  }

  for (const [field, filename] of STATESET_RESOURCE_MAP) {
    const resourcePath = path.join(sourcePath, filename);
    if (!fs.existsSync(resourcePath)) {
      continue;
    }
    const parsed = readJsonFile(resourcePath, {
      label: `state set resource ${filename}`,
      expectArray: true,
    }) as unknown[];
    (output as Record<StateSetResourceField, unknown[]>)[field] = parsed;
  }

  return output;
}

export function writeStateSetBundle(targetDir: string, payload: OrgExport): void {
  const dir = resolveStateSetDir(targetDir);
  fs.writeFileSync(
    path.join(dir, DEFAULT_STATESET_BUNDLE_FILE),
    JSON.stringify(payload, null, 2),
    'utf-8',
  );

  const manifest: Record<string, unknown> = {
    version: payload.version,
    orgId: payload.orgId,
    exportedAt: payload.exportedAt,
    generatedAt: new Date().toISOString(),
    resources: Object.fromEntries(
      STATESET_RESOURCE_MAP.map(([field]) => [
        field,
        Array.isArray(payload[field]) ? payload[field].length : 0,
      ]),
    ),
  };

  fs.writeFileSync(
    path.join(dir, DEFAULT_STATESET_CONFIG_FILE),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );

  for (const [field, filename] of STATESET_RESOURCE_MAP) {
    fs.writeFileSync(path.join(dir, filename), JSON.stringify(payload[field], null, 2), 'utf-8');
  }
}

export function summarizeStateSetPayload(payload: OrgExport): Record<string, number> {
  return {
    agents: payload.agents.length,
    rules: payload.rules.length,
    skills: payload.skills.length,
    attributes: payload.attributes.length,
    functions: payload.functions.length,
    examples: payload.examples.length,
    evals: payload.evals.length,
    datasets: payload.datasets.length,
    agentSettings: payload.agentSettings.length,
  };
}

export function writeTempStateSetBundle(payload: OrgExport, prefix: string): string {
  const outputPath = path.join(
    ensureSnapshotDir(),
    `${prefix}-${nowSuffix()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf-8');
  return outputPath;
}

export function createTempStateSetPath(prefix: string): string {
  return path.join(
    ensureSnapshotDir(),
    `${prefix}-${nowSuffix()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
}

export function readStateSetFingerprint(sourceDir: string): string {
  const dirStat = fs.statSync(sourceDir);
  if (!dirStat.isDirectory()) {
    return 'not-a-directory';
  }
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
  if (jsonFiles.length === 0) {
    return 'empty';
  }
  const parts = jsonFiles.map((filename) => {
    const resourcePath = path.join(sourceDir, filename);
    const stat = fs.statSync(resourcePath);
    return `${filename}:${stat.size}:${stat.mtimeMs}`;
  });
  return parts.join('|');
}

export function normalizeSnapshotRef(reference?: string): string {
  return (reference || '').trim();
}

export function isCurrentSnapshotReference(reference: string): boolean {
  const normalized = reference.toLowerCase();
  return normalized === 'current' || normalized === 'live' || normalized === 'remote';
}

export function isLatestSnapshotReference(reference: string): boolean {
  return reference.toLowerCase() === 'latest';
}

export function parseDiffRefs(
  args: string[],
  from?: string,
  to?: string,
): { from?: string; to?: string } {
  const fromRef = normalizeSnapshotRef(from);
  const toRef = normalizeSnapshotRef(to);
  if (fromRef && toRef) {
    return { from: fromRef, to: toRef };
  }
  if (!fromRef && !toRef) {
    if (args.length >= 2) return { from: args[0], to: args[1] };
    if (args.length === 1) return { from: 'latest', to: args[0] };
    return { from: 'latest', to: 'current' };
  }
  return { from: fromRef || 'latest', to: toRef || 'current' };
}

export async function resolveCurrentSnapshotPath(includeSecrets = false): Promise<string> {
  const tmpDir = ensureSnapshotDir();
  const tmpFile = path.join(tmpDir, `tmp-current-${nowSuffix()}.json`);
  try {
    await exportOrg(tmpFile, { includeSecrets });
  } catch (error) {
    if (fs.existsSync(tmpFile)) {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // ignore
      }
    }
    throw error;
  }
  return tmpFile;
}

export async function resolveSnapshotSourceForRead(
  reference?: string,
  includeSecrets = false,
): Promise<SnapshotReadResult> {
  const requested = normalizeSnapshotRef(reference);
  if (!requested || isCurrentSnapshotReference(requested)) {
    const tmpFile = await resolveCurrentSnapshotPath(includeSecrets);
    const cleanup = () => {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // ignore
      }
    };
    const payload = readSnapshot(tmpFile);
    return { payload, source: 'current', cleanup };
  }

  if (isLatestSnapshotReference(requested)) {
    const latest = resolveSnapshotPath();
    if (!latest) {
      throw new Error('No snapshots available. Run `response snapshot create` first.');
    }
    return { payload: readSnapshot(latest), source: path.basename(latest) };
  }

  const exactPath = path.resolve(requested);
  if (fs.existsSync(exactPath) && fs.lstatSync(exactPath).isFile()) {
    return { payload: readSnapshot(exactPath), source: path.basename(exactPath) };
  }

  const resolved = resolveSnapshotPath(requested);
  if (!resolved) {
    throw new Error(`Snapshot not found: ${requested}`);
  }
  return { payload: readSnapshot(resolved), source: path.basename(resolved) };
}

export async function resolveSnapshotSourceForImport(
  reference?: string,
  includeSecrets = false,
): Promise<SnapshotPathResult> {
  const requested = normalizeSnapshotRef(reference);

  if (!requested || isLatestSnapshotReference(requested)) {
    const latest = resolveSnapshotPath();
    if (!latest) {
      throw new Error('No snapshots available. Run `response snapshot create` first.');
    }
    return { path: latest, source: path.basename(latest) };
  }

  if (isCurrentSnapshotReference(requested)) {
    const pathForImport = await resolveCurrentSnapshotPath(includeSecrets);
    const cleanup = () => {
      try {
        fs.unlinkSync(pathForImport);
      } catch {
        // ignore
      }
    };
    await exportOrg(pathForImport, { includeSecrets });
    return { path: pathForImport, source: 'current', cleanup };
  }

  const exactPath = path.resolve(requested);
  if (fs.existsSync(exactPath) && fs.lstatSync(exactPath).isFile()) {
    return { path: exactPath, source: path.basename(exactPath) };
  }

  const resolved = resolveSnapshotPath(requested);
  if (!resolved) {
    throw new Error(`Snapshot not found: ${requested}`);
  }
  return { path: resolved, source: path.basename(resolved) };
}

export function formatImportCounts(result: ImportResult): string {
  const lines = [
    ['agents', 'agents'],
    ['rules', 'rules'],
    ['skills', 'skills'],
    ['attributes', 'attributes'],
    ['functions', 'functions'],
    ['examples', 'examples'],
    ['evals', 'evals'],
    ['datasets', 'datasets'],
    ['datasetEntries', 'dataset entries'],
    ['agentSettings', 'agent settings'],
  ] as const;

  const stats = lines
    .map(([key, label]) => ({
      key,
      label,
      value: result[key as keyof ImportResult],
    }))
    .filter((entry) => Number(entry.value) > 0)
    .map((entry) => `${entry.value} ${entry.label}`);

  return stats.length ? stats.join(', ') : 'nothing';
}

export async function runImportCommandWithPreview(
  sourceRef: string | undefined,
  logger: ShortcutLogger,
  actionLabel: string,
  options: TopLevelOptions = {},
): Promise<void> {
  const resolved = await resolveSnapshotSourceForImport(sourceRef, Boolean(options.includeSecrets));
  try {
    const preview = await importOrg(resolved.path, { dryRun: true, strict: options.strict });
    logger.success(`${actionLabel} preview: ${formatImportCounts(preview)}`);
    if (preview.skipped > 0) {
      logger.warning(`Preview skipped: ${preview.skipped}`);
    }
    if (preview.failures.length > 0) {
      for (const failure of preview.failures.slice(0, 3)) {
        logger.warning(`Preview failure [${failure.entity}]: ${failure.reason}`);
      }
    }
    if (options.dryRun) {
      logger.success('Dry-run complete.');
      return;
    }
    if (!options.yes) {
      logger.warning('Use --yes to apply this change.');
      return;
    }
    const result = await importOrg(resolved.path, { strict: options.strict });
    logger.success(`${actionLabel} complete: ${formatImportCounts(result)}`);
    if (result.skipped > 0) {
      logger.warning(`Skipped: ${result.skipped}`);
    }
    if (result.failures.length > 0) {
      const shown = result.failures.slice(0, 5);
      logger.warning('Failures:');
      logger.output(
        shown.map((entry) => `  - ${entry.entity}[${entry.index}] ${entry.reason}`).join('\n'),
      );
    }
  } finally {
    if (resolved.cleanup) {
      resolved.cleanup();
    }
  }
}

export async function withAgentRunner<T>(fn: (runner: ShortcutRunner) => Promise<T>): Promise<T> {
  if (!configExists()) {
    printAuthHelp();
    process.exit(1);
  }

  const { anthropicApiKey } = getRuntimeContext();
  const agent = new StateSetAgent(anthropicApiKey);
  await agent.connect();
  try {
    return await fn({
      callTool: async <T = AnyPayload>(toolName: string, args: Record<string, unknown> = {}) =>
        agent.callTool<T>(toolName, args),
    });
  } finally {
    await agent.disconnect();
  }
}

export function addCommonJsonOption(command: import('commander').Command, name: string): void {
  command.option('--json', `Output ${name} as JSON`);
}

export async function runPlaceholder(name: string, logger: ShortcutLogger): Promise<void> {
  logger.warning(
    `${name} is not implemented yet in shortcut mode. This is tracked in the roadmap.`,
  );
}

export { formatError, formatBytes, formatToolResult, formatTable, formatSuccess, formatWarning };
export { parseToggleValue };
export { resolveSafeOutputPath };
export { exportOrg, importOrg };
export type { ImportResult, OrgExport };
export type { ChatContext };
