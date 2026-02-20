import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { configExists, getRuntimeContext } from '../config.js';
import { StateSetAgent } from '../agent.js';
import { exportOrg, importOrg, type ImportResult, type OrgExport } from '../export-import.js';
import type { ToolCallPayload } from '../agent.js';
import {
  formatError,
  formatBytes,
  formatSuccess,
  formatWarning,
  formatToolResult,
  formatTable,
  printAuthHelp,
} from '../utils/display.js';
import {
  createAlert,
  createDeployment,
  createWebhook,
  deleteAlert,
  deleteDeployment,
  deleteWebhook,
  getDeployment,
  getWebhook,
  listDeployments,
  listAlerts,
  listWebhookLogs,
  listWebhooks,
  loadOperationsStore,
  updateDeployment,
  pushWebhookLog,
} from './operations-store.js';
import type { ChatContext } from './types.js';
import { parseToggleValue } from './utils.js';
import { resolveSafeOutputPath } from './utils.js';

type AnyPayload =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null
  | undefined;

interface ShortcutLogger {
  success: (message: string) => void;
  warning: (message: string) => void;
  error: (message: string) => void;
  output: (text: string) => void;
  done: () => void;
}

interface ShortcutRunner {
  callTool: <T = AnyPayload>(
    toolName: string,
    args?: Record<string, unknown>,
  ) => Promise<ToolCallPayload<T>>;
}

type TopLevelOptions = {
  json?: boolean;
  agent?: string;
  from?: string;
  to?: string;
  since?: string;
  period?: string;
  dryRun?: boolean;
  yes?: boolean;
  strict?: boolean;
  out?: string;
  includeSecrets?: boolean;
  approve?: string;
  schedule?: string;
};

type WatchOptions = TopLevelOptions & {
  interval?: string;
  once?: boolean;
};

type DeploymentCommandOptions = {
  json?: boolean;
  mode?: string;
  status?: string;
  limit?: number | string;
};

const DEFAULT_STATESET_DIR = path.resolve(process.cwd(), '.stateset');
const DEFAULT_STATESET_BUNDLE_FILE = 'snapshot.json';
const DEFAULT_STATESET_CONFIG_FILE = 'config.json';
const DEFAULT_STATESET_DIR_OPTIONS = [
  'agents.json',
  'rules.json',
  'skills.json',
  'attributes.json',
  'functions.json',
  'examples.json',
  'evals.json',
  'datasets.json',
  'agent-settings.json',
];
const STATESET_RESOURCE_MAP = [
  ['agents', 'agents.json'],
  ['rules', 'rules.json'],
  ['skills', 'skills.json'],
  ['attributes', 'attributes.json'],
  ['functions', 'functions.json'],
  ['examples', 'examples.json'],
  ['evals', 'evals.json'],
  ['datasets', 'datasets.json'],
  ['agentSettings', 'agent-settings.json'],
] as const;

type StateSetResourceField = (typeof STATESET_RESOURCE_MAP)[number][0];

const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_LIST_OFFSET = 0;
const DEFAULT_SNAPSHOT_DIR = path.resolve(process.cwd(), '.stateset', 'snapshots');
const DEFAULT_SNAPSHOT_PREFIX = 'snapshot';
const SNAPSHOT_RESOURCE_FIELDS = [
  'agents',
  'rules',
  'skills',
  'attributes',
  'functions',
  'examples',
  'evals',
  'datasets',
  'agentSettings',
] as const;

interface SnapshotInfo {
  id: string;
  file: string;
  path: string;
  size: number;
  modifiedAt: number;
}

type SnapshotDiffRow = {
  collection: string;
  from: number;
  to: number;
  added: number;
  removed: number;
  changed: number;
};

type AnalyticsRows = {
  metric: string;
  value: string;
};

interface DiffSummary {
  from: string;
  to: string;
  rows: SnapshotDiffRow[];
}

type ParsedDateRange = {
  from?: number;
  to?: number;
  warnings: string[];
};

function parseDateInput(rawInput: string | undefined): number | undefined {
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

function nowSuffix(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureSnapshotDir(): string {
  fs.mkdirSync(DEFAULT_SNAPSHOT_DIR, { recursive: true });
  return DEFAULT_SNAPSHOT_DIR;
}

function defaultSnapshotName(label?: string): string {
  const suffix = nowSuffix();
  return `${DEFAULT_SNAPSHOT_PREFIX}${label ? `-${label}` : ''}-${suffix}.json`;
}

function resolveSafeOutputJsonPath(rawPath: string | undefined, defaultName: string): string {
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

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`;
}

function buildSlashLogger(ctx: ChatContext): ShortcutLogger {
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

function buildTopLevelLogger(): ShortcutLogger {
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

function toLines(tokens: string[]): string[] {
  return tokens.map((token) => token.trim()).filter(Boolean);
}

function parseOptionLike(value: string): [string, string | null] {
  const separator = value.indexOf('=');
  if (separator === -1) return [value, null];
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function parseCommandArgs(tokens: string[]) {
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

function parseTopLevelOptionsFromSlashArgs(options: Record<string, string>): WatchOptions {
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

function toPositiveInteger(input: string | undefined, fallback: number, max: number): number {
  if (!input) return fallback;
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  if (Number.isInteger(parsed)) return Math.min(parsed, max);
  return fallback;
}

function toNonNegativeInteger(input: string | undefined, fallback: number, max: number): number {
  if (!input) return fallback;
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  if (Number.isInteger(parsed)) return Math.min(parsed, max);
  return fallback;
}

function parseListArgs(tokens: string[]) {
  const { options, positionals } = parseCommandArgs(tokens);
  return {
    limit: toPositiveInteger(options.limit, DEFAULT_LIST_LIMIT, 1000),
    offset: toNonNegativeInteger(options.offset, DEFAULT_LIST_OFFSET, 100000),
    options,
    positionals,
  };
}

function parseDateRange(
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

function isInDateRange(value: unknown, from?: number, to?: number): boolean {
  if (from === undefined && to === undefined) return true;
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  if (from !== undefined && parsed < from) return false;
  if (to !== undefined && parsed > to) return false;
  return true;
}

function parsePeriodRangeAsIso(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (!/^\d+[smhdw]$/i.test(raw.trim())) return undefined;
  const parsed = parseDateInput(`-${raw.trim()}`);
  if (parsed === undefined) return undefined;
  return new Date(parsed).toISOString();
}

function printPayload(
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

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function asStringRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function extractAggregateCount(payload: unknown, collectionName: string): number {
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

function asRecordArray(payload: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(payload)) return [];
  return payload.filter(
    (entry): entry is Record<string, unknown> =>
      entry !== null && typeof entry === 'object' && !Array.isArray(entry),
  );
}

function toDisplayValue(value: unknown): string {
  if (value === undefined || value === null) return '-';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function parsePositiveIntegerOption(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) return undefined;
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

type MonitorSnapshot = {
  generatedAt: string;
  scope: string;
  metrics: Array<{ metric: string; value: string }>;
  recentChannels: Array<Record<string, string>>;
  recentWebhookLogs: Array<Record<string, string>>;
};

function listSnapshotInfos(): SnapshotInfo[] {
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

function resolveSnapshotPath(reference?: string): string | null {
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

function readSnapshot(pathOrRef: string): OrgExport {
  const snapshotPath = resolveSnapshotPath(pathOrRef);
  if (!snapshotPath) {
    throw new Error(`Snapshot not found: ${pathOrRef}`);
  }
  const raw = fs.readFileSync(snapshotPath, 'utf-8');
  const parsed = JSON.parse(raw) as OrgExport;
  if (!parsed || typeof parsed !== 'object' || !parsed.version || !parsed.orgId) {
    throw new Error(`Invalid snapshot format: ${pathOrRef}`);
  }
  return parsed;
}

function extractEntityRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === 'object' && !Array.isArray(item),
  );
}

function extractEntityId(item: Record<string, unknown>, index: number): string {
  if (typeof item.id === 'string') return item.id;
  if (typeof item.uuid === 'string') return item.uuid;
  if (typeof item.agent_name === 'string') return `agent:${item.agent_name}`;
  if (typeof item.rule_name === 'string') return `rule:${item.rule_name}`;
  if (typeof item.name === 'string') return `name:${item.name}`;
  return `index:${index}`;
}

function buildDiffRows(before: OrgExport, after: OrgExport): SnapshotDiffRow[] {
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

function buildDiffSummary(
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

interface SnapshotReadResult {
  payload: OrgExport;
  source: string;
  cleanup?: () => void;
}

interface SnapshotPathResult {
  path: string;
  source: string;
  cleanup?: () => void;
}

interface StateSetBundleManifest {
  version?: string;
  orgId?: string;
  exportedAt?: string;
}

function resolveStateSetDir(rawDir?: string): string {
  const target = path.resolve(rawDir || DEFAULT_STATESET_DIR);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function normalizeStateSetSource(rawSource?: string): string {
  const fallback = DEFAULT_STATESET_DIR;
  const trimmed = (rawSource || '').trim();
  if (!trimmed) {
    return fallback;
  }
  return path.resolve(trimmed);
}

function coerceResourceArray(field: string, value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${field}: expected an array.`);
  }
  return value;
}

function coerceOrgExportPayload(payload: unknown): OrgExport {
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

function readStateSetBundle(source: string): OrgExport {
  const sourcePath = path.resolve(source);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`StateSet source not found: ${source}`);
  }
  const stats = fs.lstatSync(sourcePath);

  if (stats.isFile()) {
    const raw = fs.readFileSync(sourcePath, 'utf-8');
    try {
      const parsed = JSON.parse(raw) as unknown;
      return coerceOrgExportPayload(parsed);
    } catch (error) {
      throw new Error(
        `Invalid state set file ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (!stats.isDirectory()) {
    throw new Error(`StateSet source must be a file or directory: ${sourcePath}`);
  }

  const manifestPath = path.join(sourcePath, DEFAULT_STATESET_BUNDLE_FILE);
  if (fs.existsSync(manifestPath)) {
    const manifestRaw = fs.readFileSync(manifestPath, 'utf-8');
    try {
      const manifestParsed = JSON.parse(manifestRaw) as unknown;
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
    const configRaw = fs.readFileSync(configPath, 'utf-8');
    try {
      const config = JSON.parse(configRaw) as StateSetBundleManifest;
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
    const resourceRaw = fs.readFileSync(resourcePath, 'utf-8');
    const parsed = JSON.parse(resourceRaw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(`Invalid state file ${filename}: expected an array.`);
    }
    (output as Record<StateSetResourceField, unknown[]>)[field] = parsed;
  }

  return output;
}

function writeStateSetBundle(targetDir: string, payload: OrgExport): void {
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

function summarizeStateSetPayload(payload: OrgExport): Record<string, number> {
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

function writeTempStateSetBundle(payload: OrgExport, prefix: string): string {
  const outputPath = path.join(
    ensureSnapshotDir(),
    `${prefix}-${nowSuffix()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf-8');
  return outputPath;
}

function createTempStateSetPath(prefix: string): string {
  return path.join(
    ensureSnapshotDir(),
    `${prefix}-${nowSuffix()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
}

function readStateSetFingerprint(sourceDir: string): string {
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

function normalizeSnapshotRef(reference?: string): string {
  return (reference || '').trim();
}

function isCurrentSnapshotReference(reference: string): boolean {
  const normalized = reference.toLowerCase();
  return normalized === 'current' || normalized === 'live' || normalized === 'remote';
}

function isLatestSnapshotReference(reference: string): boolean {
  return reference.toLowerCase() === 'latest';
}

function parseDiffRefs(args: string[], from?: string, to?: string): { from?: string; to?: string } {
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

async function resolveCurrentSnapshotPath(includeSecrets = false): Promise<string> {
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

async function resolveSnapshotSourceForRead(
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

async function resolveSnapshotSourceForImport(
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

function formatImportCounts(result: ImportResult): string {
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

async function runRulesCommand(
  tokens: string[],
  runner: ShortcutRunner,
  logger: ShortcutLogger,
  json = false,
): Promise<void> {
  const raw = toLines(tokens);
  const { limit, offset, options, positionals } = parseListArgs(raw);
  const action = positionals[0]?.toLowerCase() || null;

  if (!action) {
    const result = await runner.callTool('list_rules', { limit, offset });
    printPayload(logger, 'Rules', result.payload, json);
    if (result.isError) {
      logger.warning('Note: some rules may not be available.');
    }
    return;
  }

  if (action === 'list') {
    const result = await runner.callTool('list_rules', { limit, offset });
    printPayload(logger, 'Rules', result.payload, json);
    return;
  }

  if (action === 'agent') {
    const agentId = positionals[1];
    if (!agentId) {
      logger.warning('Usage: /rules agent <agent-id> [limit]');
      return;
    }
    const result = await runner.callTool('get_agent_rules', {
      agent_id: agentId,
      limit,
      offset,
    });
    printPayload(logger, `Rules for agent ${agentId}`, result.payload, json);
    return;
  }

  if (action === 'create') {
    const createName =
      options.name || options.title || options.rule || options.rule_name || positionals[1] || '';
    const createType = options.type || options.rule_type || positionals[2] || '';
    if (!createName || !createType) {
      logger.warning('Usage: /rules create --name <name> --type <type> [--agent <agent-id>]');
      return;
    }
    const activatedRaw = options.active ?? options.enabled ?? options.activate;
    let activated: boolean | undefined;
    if (activatedRaw) {
      const parsed = parseToggleValue(activatedRaw);
      if (parsed === undefined) {
        logger.warning('Invalid --active value; use on|off');
        return;
      }
      activated = parsed;
    }

    const result = await runner.callTool('create_rule', {
      rule_name: createName,
      rule_type: createType,
      description: options.description,
      agent_id: options.agent || options.agent_id || undefined,
      activated,
      shared: parseToggleValue(options.shared),
      conditions: {},
      actions: [],
      metadata: {},
    });
    printPayload(logger, 'Created rule', result.payload, json);
    return;
  }

  if (action === 'toggle') {
    const ruleId = positionals[1];
    if (!ruleId) {
      logger.warning('Usage: /rules toggle <rule-id> [on|off]');
      return;
    }
    let nextState: boolean | undefined;
    if (positionals[2]) {
      nextState = parseToggleValue(positionals[2]);
      if (nextState === undefined) {
        logger.warning('Usage: /rules toggle <rule-id> [on|off]');
        return;
      }
    } else {
      const list = await runner.callTool<unknown[]>('list_rules', { limit: 1000, offset: 0 });
      const rows = list.payload as unknown[];
      const target = rows.find((entry) => asStringRecord(entry).id === ruleId);
      const current = asStringRecord(target).activated;
      if (typeof current === 'boolean') {
        nextState = !current;
      } else {
        logger.warning('Cannot determine current rule state. Use /rules toggle <id> on|off');
        return;
      }
    }
    const result = await runner.callTool('update_rule', {
      id: ruleId,
      activated: nextState,
    });
    printPayload(logger, `Rule ${ruleId} toggled`, result.payload, json);
    return;
  }

  if (action === 'delete') {
    const ruleId = positionals[1];
    if (!ruleId) {
      logger.warning('Usage: /rules delete <rule-id>');
      return;
    }
    const result = await runner.callTool('delete_rule', { id: ruleId });
    printPayload(logger, `Deleted rule ${ruleId}`, result.payload, json);
    return;
  }

  if (action === 'get') {
    const ruleId = positionals[1];
    if (!ruleId) {
      logger.warning('Usage: /rules get <rule-id>');
      return;
    }
    const list = await runner.callTool<unknown[]>('list_rules', { limit: 1000, offset: 0 });
    const rows = list.payload as unknown[];
    const target = rows.find((entry) => asStringRecord(entry).id === ruleId);
    if (!target) {
      logger.warning(`Rule "${ruleId}" not found. Use /rules list to browse IDs.`);
      return;
    }
    printPayload(logger, `Rule ${ruleId}`, target, json);
    return;
  }

  if (action === 'import') {
    const file = positionals[1];
    if (!file) {
      logger.warning('Usage: /rules import <file>');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(path.resolve(file), 'utf-8'));
    } catch (error) {
      logger.error(
        `Unable to read rules import file: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    const rulesPayload = Array.isArray(parsed)
      ? parsed
      : Array.isArray(asStringRecord(parsed).rules)
        ? (asStringRecord(parsed).rules as unknown[])
        : [];
    if (!Array.isArray(rulesPayload) || rulesPayload.length === 0) {
      logger.warning('Import file must contain an array of rules or an object with a rules field.');
      return;
    }
    const result = await runner.callTool('import_rules', { rules: rulesPayload });
    printPayload(logger, `Imported ${rulesPayload.length} rule(s)`, result.payload, json);
    return;
  }

  if (action === 'export') {
    const outputFile = positionals[1];
    const result = await runner.callTool('list_rules', { limit: 1000, offset: 0 });
    if (outputFile) {
      try {
        const outputPath = resolveSafeOutputPath(outputFile, { label: 'Rules export path' });
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(result.payload, null, 2), 'utf-8');
        logger.success(`Rules exported to ${outputPath}`);
      } catch (error) {
        logger.error(
          `Failed to write export file: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else {
      printPayload(logger, 'Rules export', result.payload, json);
    }
    return;
  }

  const targetId = action;
  const list = await runner.callTool<unknown[]>('list_rules', { limit: 1000, offset: 0 });
  const rows = list.payload as unknown[];
  const target = rows.find((entry) => asStringRecord(entry).id === targetId);
  if (!target) {
    logger.warning(`Rule "${targetId}" not found. Use /rules list to browse IDs.`);
    return;
  }
  printPayload(logger, `Rule ${targetId}`, target, json);
}

async function runKnowledgeBaseCommand(
  tokens: string[],
  runner: ShortcutRunner,
  logger: ShortcutLogger,
  json = false,
): Promise<void> {
  const raw = toLines(tokens);
  const { options, positionals } = parseCommandArgs(raw);
  const action = positionals[0]?.toLowerCase() || 'list';

  if (action === 'search') {
    const query = stripQuotes(positionals.slice(1).join(' '));
    if (!query) {
      logger.warning('Usage: /kb search <query> [--top_k 5]');
      return;
    }
    const result = await runner.callTool('kb_search', {
      question: query,
      top_k: toPositiveInteger(options.top_k || options.limit, 5, 50),
      score_threshold: options.score_threshold ? Number(options.score_threshold) : undefined,
    });
    printPayload(logger, `KB search: ${query}`, result.payload, json);
    return;
  }

  if (action === 'add') {
    const source = stripQuotes(positionals.slice(1).join(' '));
    if (!source) {
      logger.warning('Usage: /kb add <file-path|url|text>');
      return;
    }
    let knowledge = '';
    if (source.startsWith('http://') || source.startsWith('https://')) {
      try {
        const response = await fetch(source);
        knowledge = await response.text();
      } catch (error) {
        logger.error(
          `Unable to fetch URL: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
    } else if (fs.existsSync(source)) {
      knowledge = fs.readFileSync(source, 'utf-8');
    } else {
      knowledge = source;
    }
    const result = await runner.callTool('kb_upsert', {
      knowledge,
      metadata: {
        source: positionals.slice(1).join(' '),
      },
    });
    printPayload(logger, 'KB added', result.payload, json);
    return;
  }

  if (action === 'delete') {
    const ids = positionals.slice(1);
    if (ids.length === 0) {
      logger.warning('Usage: /kb delete <id> [id...]');
      return;
    }
    const result = await runner.callTool('kb_delete', { ids });
    printPayload(logger, `KB delete`, result.payload, json);
    return;
  }

  if (action === 'info') {
    const result = await runner.callTool('kb_get_collection_info', {});
    printPayload(logger, 'KB info', result.payload, json);
    return;
  }

  if (action === 'scroll') {
    const cursor = positionals[1];
    const limit = toPositiveInteger(options.limit, 10, 200);
    const result = await runner.callTool('kb_scroll', {
      limit,
      offset: cursor,
    });
    printPayload(logger, 'KB entries', result.payload, json);
    return;
  }

  if (action === 'list') {
    const limit = toPositiveInteger(options.limit, 10, 200);
    const cursor = options.offset;
    const result = await runner.callTool('kb_scroll', {
      limit,
      offset: cursor,
    });
    printPayload(logger, 'KB entries', result.payload, json);
    return;
  }

  logger.warning(`Unknown KB command "${action}".`);
}

async function runAgentsCommand(
  tokens: string[],
  runner: ShortcutRunner,
  logger: ShortcutLogger,
  json = false,
): Promise<void> {
  const raw = toLines(tokens);
  const { options, positionals } = parseCommandArgs(raw);
  const { limit, offset } = parseListArgs(raw);
  const action = positionals[0]?.toLowerCase() || null;

  if (!action || action === 'list') {
    const result = await runner.callTool('list_agents', { limit, offset });
    printPayload(logger, 'Agents', result.payload, json);
    return;
  }

  if (action === 'create') {
    const name = stripQuotes(options.name || positionals[1] || '');
    const type = stripQuotes(options.type || positionals[2] || '');
    if (!name || !type) {
      logger.warning('Usage: /agents create --name <name> --type <type>');
      return;
    }
    const result = await runner.callTool('create_agent', {
      agent_name: name,
      agent_type: type,
      description: options.description,
      role: options.role,
      goal: options.goal,
      instructions: options.instructions,
      activated: parseToggleValue(options.active || '') ?? true,
      voice_model: options.voice_model,
      voice_model_id: options.voice_model_id,
      voice_model_provider: options.voice_model_provider,
    });
    printPayload(logger, 'Agent created', result.payload, json);
    return;
  }

  if (action === 'switch') {
    const agentId = positionals[1];
    if (!agentId) {
      logger.warning('Usage: /agents switch <agent-id>');
      return;
    }
    process.env.STATESET_ACTIVE_AGENT_ID = agentId;
    logger.warning(
      'Agent context is stored only for this process. Use /agents create with default channel binding for persistence.',
    );
    logger.success(`Active agent for this session set to ${agentId}`);
    return;
  }

  if (action === 'get') {
    const agentId = positionals[1];
    if (!agentId) {
      logger.warning('Usage: /agents get <agent-id>');
      return;
    }
    const result = await runner.callTool('get_agent', { agent_id: agentId });
    printPayload(logger, `Agent ${agentId}`, result.payload, json);
    return;
  }

  if (action === 'export') {
    const agentId = positionals[1];
    if (!agentId) {
      logger.warning('Usage: /agents export <agent-id> [file]');
      return;
    }
    const outputFile = positionals[2];
    const result = await runner.callTool('export_agent', { agent_id: agentId });
    if (outputFile) {
      try {
        const outputPath = resolveSafeOutputPath(outputFile, { label: 'Agent export path' });
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(result.payload, null, 2), 'utf-8');
        logger.success(`Agent exported to ${outputPath}`);
      } catch (error) {
        logger.error(
          `Failed to write export file: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else {
      printPayload(logger, `Agent ${agentId}`, result.payload, json);
    }
    return;
  }

  if (action === 'import') {
    const sourceFile = positionals[1];
    if (!sourceFile) {
      logger.warning('Usage: /agents import <file>');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(path.resolve(sourceFile), 'utf-8'));
    } catch (error) {
      logger.error(
        `Unable to read import file: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    const payload = asStringRecord(parsed);
    const agent = asStringRecord(payload.agent || payload) as Record<string, unknown>;
    if (!agent.agent_name || !agent.agent_type) {
      logger.warning('Import file must contain agent_name and agent_type.');
      return;
    }
    const result = await runner.callTool('create_agent', {
      agent_name: String(agent.agent_name),
      agent_type: String(agent.agent_type),
      description: agent.description ? String(agent.description) : undefined,
      role: agent.role ? String(agent.role) : undefined,
      goal: agent.goal ? String(agent.goal) : undefined,
      instructions: agent.instructions ? String(agent.instructions) : undefined,
      voice_model: agent.voice_model ? String(agent.voice_model) : undefined,
      voice_model_id: agent.voice_model_id ? String(agent.voice_model_id) : undefined,
      voice_model_provider: agent.voice_model_provider
        ? String(agent.voice_model_provider)
        : undefined,
      activated: typeof agent.activated === 'boolean' ? (agent.activated as boolean) : true,
    });
    printPayload(logger, 'Agent imported', result.payload, json);
    return;
  }

  if (action === 'bootstrap') {
    const agentId = positionals[1];
    if (!agentId) {
      logger.warning('Usage: /agents bootstrap <agent-id>');
      return;
    }
    const result = await runner.callTool('bootstrap_agent', { agent_id: agentId });
    printPayload(logger, `Agent bootstrap ${agentId}`, result.payload, json);
    return;
  }

  const agentId = action;
  if (!agentId) {
    const result = await runner.callTool('list_agents', { limit, offset });
    printPayload(logger, 'Agents', result.payload, json);
    return;
  }
  const result = await runner.callTool('get_agent', { agent_id: agentId });
  printPayload(logger, `Agent ${agentId}`, result.payload, json);
}

async function runChannelsCommand(
  tokens: string[],
  runner: ShortcutRunner,
  logger: ShortcutLogger,
  json = false,
): Promise<void> {
  const raw = toLines(tokens);
  const { options, positionals } = parseCommandArgs(raw);
  const action = positionals[0]?.toLowerCase() || null;

  if (!action || action === 'list') {
    const limit = toPositiveInteger(options.limit, DEFAULT_LIST_LIMIT, 1000);
    const offset = toPositiveInteger(options.offset, DEFAULT_LIST_OFFSET, 100000);
    const result = await runner.callTool('list_channels', {
      limit,
      offset,
      status: options.status,
      agent_id: options.agent_id || options.agent,
      escalated: parseToggleValue(options.escalated || '') ?? undefined,
    });
    printPayload(logger, 'Channels', result.payload, json);
    return;
  }

  if (action === 'create') {
    const name = stripQuotes(options.name || positionals[1] || '');
    if (!name) {
      logger.warning('Usage: /channels create --name <name> [--agent <agent-id>]');
      return;
    }
    const result = await runner.callTool('create_channel', {
      name,
      agent_id: options.agent || options.agent_id,
      model: options.model,
      user_id: options.user || options.user_id,
      channel: options.channel || options.type,
      response_system_prompt: options.prompt,
    });
    printPayload(logger, 'Channel created', result.payload, json);
    return;
  }

  if (action === 'messages') {
    const channelId = positionals[1];
    if (!channelId) {
      logger.warning('Usage: /channels messages <uuid> [limit=50]');
      return;
    }
    const result = await runner.callTool('get_channel_with_messages', {
      uuid: channelId,
      message_limit: toPositiveInteger(options.limit, 100, 500),
    });
    printPayload(logger, `Channel ${channelId}`, result.payload, json);
    return;
  }

  const channelId = action;
  const result = await runner.callTool('get_channel', { uuid: channelId });
  printPayload(logger, `Channel ${channelId}`, result.payload, json);
}

async function runConvosCommand(
  tokens: string[],
  runner: ShortcutRunner,
  logger: ShortcutLogger,
  json = false,
): Promise<void> {
  const raw = toLines(tokens);
  const { options, positionals } = parseCommandArgs(raw);
  const action = positionals[0]?.toLowerCase() || 'recent';

  if (action === 'recent' || action === 'list') {
    const limit = toPositiveInteger(options.limit, DEFAULT_LIST_LIMIT, 200);
    const offset = toPositiveInteger(options.offset, DEFAULT_LIST_OFFSET, 100000);
    const result = await runner.callTool('list_channels', { limit, offset });
    printPayload(logger, 'Recent conversations', result.payload, json);
    return;
  }

  if (action === 'search') {
    const query = stripQuotes(positionals.slice(1).join(' '));
    if (!query) {
      logger.warning('Usage: /convos search <query>');
      return;
    }
    const result = await runner.callTool('search_messages', {
      query,
      limit: toPositiveInteger(options.limit, 20, 200),
    });
    printPayload(logger, `Conversations matching: ${query}`, result.payload, json);
    return;
  }

  if (action === 'get') {
    const conversationId = positionals[1];
    if (!conversationId) {
      logger.warning('Usage: /convos get <conversation-id>');
      return;
    }
    const limit = toPositiveInteger(options.limit, 100, 1000);
    const result = await runner.callTool('get_channel_with_messages', {
      uuid: conversationId,
      message_limit: limit,
    });
    if (json) {
      logger.output(JSON.stringify(result.payload, null, 2));
      return;
    }
    printPayload(logger, `Conversation ${conversationId}`, result.payload, json);
    return;
  }

  if (action === 'count') {
    const channelId = options.channel_id || options.channel;
    const result = await runner.callTool('get_message_count', {
      chat_id: channelId || undefined,
    });
    printPayload(logger, 'Conversation message count', result.payload, json);
    return;
  }

  if (action === 'export') {
    const conversationId = positionals[1];
    if (!conversationId) {
      logger.warning('Usage: /convos export <conversation-id> [out]');
      return;
    }
    const outputFile = positionals[2];
    const limit = toPositiveInteger(options.limit, 1000, 2000);
    const result = await runner.callTool('get_channel_with_messages', {
      uuid: conversationId,
      message_limit: limit,
    });
    if (outputFile) {
      try {
        const outputPath = resolveSafeOutputJsonPath(
          outputFile,
          `conversation-${conversationId}.json`,
        );
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(result.payload, null, 2), 'utf-8');
        logger.success(`Conversation exported to ${outputPath}`);
      } catch (error) {
        logger.error(
          `Failed to export conversation: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return;
    }
    printPayload(logger, `Conversation ${conversationId}`, result.payload, json);
    return;
  }

  if (action === 'replay') {
    const conversationId = positionals[1];
    if (!conversationId) {
      logger.warning('Usage: /convos replay <conversation-id> [--limit N]');
      return;
    }
    const limit = toPositiveInteger(options.limit, 500, 2000);
    const result = await runner.callTool('get_channel_with_messages', {
      uuid: conversationId,
      message_limit: limit,
    });
    if (json) {
      logger.output(JSON.stringify(result.payload, null, 2));
      return;
    }
    const payload = asStringRecord(result.payload);
    const channelId = toDisplayValue(payload.uuid || payload.id || conversationId);
    const createdAt = toDisplayValue(payload.created_at || payload.createdAt);
    const status = toDisplayValue(payload.status);
    const agentInfo = asStringRecord(payload.agent);
    const agent = toDisplayValue(
      agentInfo.agent_name || agentInfo.id || agentInfo.name || payload.agent_id || '-',
    );
    const messages = asRecordArray(payload.messages);
    logger.output(chalk.bold(`Conversation ${channelId}`));
    logger.output(formatToolResult(`Status: ${status} | Agent: ${agent} | Created: ${createdAt}`));
    if (messages.length === 0) {
      logger.output(chalk.gray('  (no messages)'));
      return;
    }
    for (const message of messages.slice(0, limit)) {
      const sender = toDisplayValue(
        message.username ||
          (typeof message.fromAgent === 'boolean' && message.fromAgent
            ? 'agent'
            : message.from || message.from_id || 'unknown'),
      );
      const stamp = toDisplayValue(message.timestamp || message.created_at);
      const body = toDisplayValue(message.body);
      const fromAgent = message.fromAgent === true;
      const speaker = fromAgent ? 'agent' : sender;
      logger.output(
        formatToolResult(`${chalk.gray(stamp)} ${chalk.green(`[${speaker}]`)} ${body}`),
      );
    }
    return;
  }

  if (action === 'tag') {
    const conversationId = positionals[1];
    const mode = positionals[2]?.toLowerCase();
    const tags = positionals
      .slice(3)
      .filter(Boolean)
      .map((tag) => tag.trim());
    if (!conversationId || !mode || tags.length === 0) {
      logger.warning('Usage: /convos tag <conversation-id> <add|remove|set> <tag> [tag...]');
      return;
    }
    const channelResult = await runner.callTool('get_channel', { uuid: conversationId });
    const channel = asStringRecord(channelResult.payload);
    const existingTags = Array.isArray(channel.tags)
      ? channel.tags.filter((entry): entry is string => typeof entry === 'string')
      : [];
    const existingNormalized = new Set(
      existingTags.map((tag) => tag.toLowerCase().trim()).filter(Boolean),
    );
    const normalizedTags = tags.map((tag) => tag.toLowerCase().trim()).filter(Boolean);

    let nextTags: string[] = [];
    if (mode === 'add') {
      const merged = new Set(existingNormalized);
      for (const tag of normalizedTags) merged.add(tag);
      nextTags = Array.from(merged);
    } else if (mode === 'remove') {
      nextTags = existingTags.filter((tag) => !normalizedTags.includes(tag.toLowerCase().trim()));
    } else if (mode === 'set') {
      nextTags = Array.from(new Set(normalizedTags));
    } else {
      logger.warning('Tag action must be add, remove, or set.');
      return;
    }

    const result = await runner.callTool('update_channel', {
      uuid: conversationId,
      tags: nextTags,
    });
    printPayload(logger, `Conversation ${conversationId} tags`, result.payload, json);
    return;
  }

  const conversationId = action;
  const result = await runner.callTool('get_channel_with_messages', {
    uuid: conversationId,
    message_limit: toPositiveInteger(options.limit, 100, 1000),
  });
  printPayload(logger, `Conversation ${conversationId}`, result.payload, json);
}

async function runMessagesCommand(
  tokens: string[],
  runner: ShortcutRunner,
  logger: ShortcutLogger,
  json = false,
): Promise<void> {
  const raw = toLines(tokens);
  const { options, positionals } = parseCommandArgs(raw);
  const { limit, offset } = parseListArgs(raw);
  const action = positionals[0]?.toLowerCase() || 'list';

  if (action === 'list') {
    const chatId = options.chat_id || options.chat || options.channel || options.channel_id;
    if (!chatId) {
      logger.warning('Usage: /messages list --chat <chat-id> [--limit N] [--offset N]');
      return;
    }
    const result = await runner.callTool('list_messages', {
      chat_id: chatId,
      limit,
      offset,
    });
    printPayload(logger, `Messages for ${chatId}`, result.payload, json);
    return;
  }

  if (action === 'get') {
    const messageId = positionals[1];
    if (!messageId) {
      logger.warning('Usage: /messages get <message-id>');
      return;
    }
    const result = await runner.callTool('get_message', { id: messageId });
    printPayload(logger, `Message ${messageId}`, result.payload, json);
    return;
  }

  if (action === 'search') {
    const query = stripQuotes(positionals.slice(1).join(' '));
    if (!query) {
      logger.warning('Usage: /messages search <query> [--chat <chat-id>]');
      return;
    }
    const result = await runner.callTool('search_messages', {
      query,
      chat_id: options.chat_id || options.chat || options.channel || options.channel_id,
      from_agent: parseToggleValue(options.from_agent || options.fromAgent),
      limit: toPositiveInteger(options.limit, 20, 200),
    });
    printPayload(logger, `Messages matching: ${query}`, result.payload, json);
    return;
  }

  if (action === 'count') {
    const chatId = options.chat_id || options.chat || options.channel || options.channel_id;
    const result = await runner.callTool('get_message_count', {
      chat_id: chatId,
    });
    printPayload(logger, 'Message count', result.payload, json);
    return;
  }

  if (action === 'create') {
    const hasChatOption =
      options.chat_id !== undefined ||
      options.chat !== undefined ||
      options.channel !== undefined ||
      options.channel_id !== undefined;
    const chatId = hasChatOption
      ? options.chat_id || options.chat || options.channel || options.channel_id
      : positionals[1];
    const body = hasChatOption
      ? stripQuotes(positionals.slice(1).join(' '))
      : stripQuotes(positionals.slice(2).join(' '));

    if (!chatId || !body) {
      logger.warning('Usage: /messages create <chat-id> <body> [--username <name>] [--from <id>]');
      return;
    }

    const result = await runner.callTool('create_message', {
      chat_id: chatId,
      body,
      username: options.username || options.user,
      from:
        options.from ||
        options.sender ||
        options.fromAgent ||
        options.from_agent ||
        options.user ||
        undefined,
      user_id: options.user_id,
      fromAgent: parseToggleValue(options.from_agent || options.fromAgent),
      agent_id: options.agent_id || options.agent,
      command_used: options.command || options.command_used,
    });
    printPayload(logger, 'Message created', result.payload, json);
    return;
  }

  if (action === 'delete') {
    const messageId = positionals[1];
    if (!messageId) {
      logger.warning('Usage: /messages delete <message-id>');
      return;
    }
    const result = await runner.callTool('delete_message', { id: messageId });
    printPayload(logger, `Message ${messageId} deleted`, result.payload, json);
    return;
  }

  if (action === 'annotate') {
    const messageId = positionals[1];
    const args = positionals.slice(2);
    if (!messageId || args.length === 0) {
      logger.warning('Usage: /messages annotate <message-id> <key>=<value> [key2=value2 ...]');
      return;
    }
    const existingResult = await runner.callTool('get_message', { id: messageId });
    const existing = asStringRecord(existingResult.payload);
    const existingMetadata = asStringRecord(existing.metadata);
    const nextMetadata: Record<string, unknown> = { ...existingMetadata };
    let added = 0;
    for (const raw of args) {
      const eq = raw.indexOf('=');
      if (eq <= 0) {
        logger.warning(`Invalid annotation "${raw}". Use key=value format.`);
        return;
      }
      const key = raw.slice(0, eq).trim();
      const value = raw.slice(eq + 1);
      if (!key) {
        logger.warning(`Invalid annotation "${raw}". Use key=value format.`);
        return;
      }
      nextMetadata[key] = value;
      added += 1;
    }
    const result = await runner.callTool('update_message', {
      id: messageId,
      metadata: nextMetadata,
    });
    logger.success(`Added ${added} annotation(s) to ${messageId}`);
    printPayload(logger, `Message ${messageId}`, result.payload, json);
    return;
  }

  const messageId = action;
  const result = await runner.callTool('get_message', { id: messageId });
  printPayload(logger, `Message ${messageId}`, result.payload, json);
}

async function runResponsesCommand(
  tokens: string[],
  runner: ShortcutRunner,
  logger: ShortcutLogger,
  json = false,
): Promise<void> {
  const raw = toLines(tokens);
  const { options, positionals } = parseCommandArgs(raw);
  const { limit, offset } = parseListArgs(raw);
  const action = positionals[0]?.toLowerCase() || 'list';

  if (action === 'list' || action === 'recent') {
    const result = await runner.callTool('list_responses', {
      limit,
      offset,
      channel: options.channel,
      rating: options.rating,
    });
    printPayload(logger, 'Responses', result.payload, json);
    return;
  }

  if (action === 'search') {
    const query = stripQuotes(positionals.slice(1).join(' '));
    if (!query) {
      logger.warning('Usage: /responses search <query> [--limit N]');
      return;
    }
    const result = await runner.callTool('search_responses', {
      query,
      limit: toPositiveInteger(options.limit, 20, 200),
    });
    printPayload(logger, `Responses matching: ${query}`, result.payload, json);
    return;
  }

  if (action === 'count') {
    const result = await runner.callTool('get_response_count', {});
    printPayload(logger, 'Response count', result.payload, json);
    return;
  }

  if (action === 'get') {
    const responseId = positionals[1];
    if (!responseId) {
      logger.warning('Usage: /responses get <response-id>');
      return;
    }
    const result = await runner.callTool('get_response', { id: responseId });
    printPayload(logger, `Response ${responseId}`, result.payload, json);
    return;
  }

  if (action === 'rate') {
    const responseId = positionals[1];
    const rating = positionals[2] || options.rating;
    if (!responseId || !rating) {
      logger.warning('Usage: /responses rate <response-id> <rating>');
      return;
    }
    const result = await runner.callTool('bulk_update_response_ratings', {
      response_ids: [responseId],
      rating,
    });
    printPayload(logger, `Response ${responseId} rating`, result.payload, json);
    return;
  }

  const responseId = action;
  const result = await runner.callTool('get_response', { id: responseId });
  printPayload(logger, `Response ${responseId}`, result.payload, json);
}

async function runStatusCommand(
  runner: ShortcutRunner,
  logger: ShortcutLogger,
  json = false,
): Promise<void> {
  const [
    agentsResult,
    rulesResult,
    channelCountResult,
    responseCountResult,
    messageCountResult,
    kbInfoResult,
  ] = await Promise.all([
    runner.callTool('list_agents', { limit: 1000 }),
    runner.callTool('list_rules', { limit: 1000 }),
    runner.callTool('get_channel_count', {}),
    runner.callTool('get_response_count', {}),
    runner.callTool('get_message_count', {}),
    runner.callTool('kb_get_collection_info', {}),
  ]);

  const agentCount = Array.isArray(agentsResult.payload) ? agentsResult.payload.length : 0;
  const ruleCount = Array.isArray(rulesResult.payload) ? rulesResult.payload.length : 0;
  const channelCount = extractAggregateCount(
    channelCountResult.payload,
    'channel_thread_aggregate',
  );
  const responseCount = extractAggregateCount(responseCountResult.payload, 'responses_aggregate');
  const messageCount = extractAggregateCount(messageCountResult.payload, 'message_aggregate');
  const kbCollection = asStringRecord(kbInfoResult.payload).collection;
  const kbPoints = asStringRecord(asStringRecord(kbInfoResult.payload).info).points_count;
  const rows = [
    { metric: 'Agents', value: String(agentCount) },
    { metric: 'Rules', value: String(ruleCount) },
    { metric: 'Channels', value: String(channelCount) },
    { metric: 'Messages', value: String(messageCount) },
    { metric: 'Responses', value: String(responseCount) },
    {
      metric: 'KB Collection',
      value: `${kbCollection ?? 'unknown'} (${kbPoints ?? 0} points)`,
    },
  ];
  logger.success('Current platform status');
  if (json) {
    logger.output(
      JSON.stringify({ metrics: rows }, (k, v) => (typeof v === 'bigint' ? String(v) : v), 2),
    );
  } else {
    logger.output(formatTable(rows, ['metric', 'value']));
  }
}

async function runAnalyticsCommand(
  tokens: string[],
  runner: ShortcutRunner,
  logger: ShortcutLogger,
  json = false,
): Promise<void> {
  const raw = toLines(tokens);
  const { options, positionals: initialPositionals } = parseCommandArgs(raw);
  const knownActions = new Set([
    'summary',
    'stats',
    'agents',
    'conversations',
    'conversation',
    'responses',
  ]);
  let positionals = [...initialPositionals];
  let fromInput = options.from || options.since;
  const toInput = options.to;
  let action = positionals[0]?.toLowerCase() || 'summary';

  if (!fromInput && !toInput && !knownActions.has(action)) {
    const durationFrom = parsePeriodRangeAsIso(action);
    if (durationFrom) {
      fromInput = durationFrom;
      action = 'summary';
      positionals = positionals.slice(1);
    }
  } else if (!fromInput && !toInput && knownActions.has(action) && positionals[1]) {
    const durationFrom = parsePeriodRangeAsIso(positionals[1]);
    if (durationFrom) {
      fromInput = durationFrom;
      positionals = positionals.slice(1);
    }
  }

  const dateRange = parseDateRange(fromInput, toInput);
  if (dateRange.warnings.length > 0) {
    for (const warning of dateRange.warnings) {
      logger.warning(warning);
    }
  }
  const dateSupported = dateRange.from !== undefined || dateRange.to !== undefined;

  if (action === 'summary' || action === 'stats') {
    const [agentsResult, rulesResult, channelCountResult, responseCountResult, messageCountResult] =
      await Promise.all([
        runner.callTool('list_agents', { limit: 1000 }),
        runner.callTool('list_rules', { limit: 1000 }),
        runner.callTool('get_channel_count', {}),
        runner.callTool('get_response_count', {}),
        runner.callTool('get_message_count', {}),
      ]);
    const agentCount = Array.isArray(agentsResult.payload) ? agentsResult.payload.length : 0;
    const ruleCount = Array.isArray(rulesResult.payload) ? rulesResult.payload.length : 0;
    const channelCount = extractAggregateCount(
      channelCountResult.payload,
      'channel_thread_aggregate',
    );
    const responseCount = extractAggregateCount(responseCountResult.payload, 'responses_aggregate');
    const messageCount = extractAggregateCount(messageCountResult.payload, 'message_aggregate');
    const rows: AnalyticsRows[] = [
      { metric: 'Agents', value: String(agentCount) },
      { metric: 'Rules', value: String(ruleCount) },
      { metric: 'Channels', value: String(channelCount) },
      { metric: 'Responses', value: String(responseCount) },
      { metric: 'Messages', value: String(messageCount) },
    ];
    if (dateSupported) {
      rows.push({ metric: 'Date range filtering', value: 'summary metrics are aggregate-only' });
    }
    if (json) {
      logger.output(JSON.stringify({ analytics: rows }, null, 2));
    } else {
      logger.success('Analytics summary');
      logger.output(formatTable(rows, ['metric', 'value']));
    }
    return;
  }

  if (action === 'agents') {
    const agentData = await runner.callTool<unknown[]>('list_agents', {
      limit: toPositiveInteger(options.limit, 25, 200),
    });
    const agents = Array.isArray(agentData.payload) ? agentData.payload : [];
    if (agents.length === 0) {
      logger.warning('No agents found.');
      return;
    }
    const rows = await Promise.all(
      agents.map(async (entry) => {
        const agent = asStringRecord(entry);
        const agentId = String(agent.id ?? '');
        const [rulesResult, channelsResult] = await Promise.all([
          runner.callTool<unknown[]>('get_agent_rules', {
            agent_id: agentId,
            limit: 10000,
            offset: 0,
          }),
          runner.callTool<unknown[]>('list_channels', {
            agent_id: agentId,
            limit: 5000,
            offset: 0,
          }),
        ]);
        const channels = Array.isArray(channelsResult.payload) ? channelsResult.payload : [];
        const filteredChannels =
          dateRange.from !== undefined || dateRange.to !== undefined
            ? channels.filter((channel) =>
                isInDateRange(asStringRecord(channel).created_at, dateRange.from, dateRange.to),
              )
            : channels;
        return {
          agent: String(agent.agent_name || agent.name || agent.id || ''),
          id: agentId,
          rules: String(Array.isArray(rulesResult.payload) ? rulesResult.payload.length : 0),
          conversations: String(filteredChannels.length),
        };
      }),
    );
    if (json) {
      logger.output(JSON.stringify({ agents: rows }, null, 2));
      return;
    }
    logger.output(formatTable(rows, ['agent', 'id', 'rules', 'conversations']));
    return;
  }

  if (action === 'conversations' || action === 'conversation' || action === 'channels') {
    const limit = toPositiveInteger(options.limit, 20, 500);
    const offset = toNonNegativeInteger(options.offset, DEFAULT_LIST_OFFSET, 100000);
    const result = await runner.callTool<unknown[]>('list_channels', { limit, offset });
    const items = Array.isArray(result.payload) ? result.payload : [];
    const filteredItems =
      dateRange.from !== undefined || dateRange.to !== undefined
        ? items.filter((item) =>
            isInDateRange(asStringRecord(item).created_at, dateRange.from, dateRange.to),
          )
        : items;
    if (json) {
      logger.output(JSON.stringify({ conversations: filteredItems }, null, 2));
      return;
    }
    printPayload(
      logger,
      `Recent conversations${dateSupported ? ' (filtered by date)' : ''}`,
      filteredItems,
      false,
    );
    return;
  }

  if (action === 'responses') {
    const limit = toPositiveInteger(options.limit, 20, 500);
    const offset = toNonNegativeInteger(options.offset, DEFAULT_LIST_OFFSET, 100000);
    const result = await runner.callTool<unknown[]>('list_responses', { limit, offset });
    const items = Array.isArray(result.payload) ? result.payload : [];
    const filteredItems =
      dateRange.from !== undefined || dateRange.to !== undefined
        ? items.filter((item) =>
            isInDateRange(asStringRecord(item).created_date, dateRange.from, dateRange.to),
          )
        : items;
    if (json) {
      logger.output(JSON.stringify({ responses: filteredItems }, null, 2));
      return;
    }
    printPayload(
      logger,
      `Recent responses${dateSupported ? ' (filtered by date)' : ''}`,
      filteredItems,
      false,
    );
    return;
  }

  logger.warning(`Unknown analytics command "${action}".`);
}

async function runDiffCommand(
  tokens: string[],
  logger: ShortcutLogger,
  options: TopLevelOptions = {},
): Promise<void> {
  const parsed = parseCommandArgs(tokens);
  const fromTo = parseDiffRefs(parsed.positionals, options.from, options.to);
  const fromRef = fromTo.from;
  const toRef = fromTo.to;

  if (!fromRef || !toRef) {
    logger.warning('Usage: /diff [from] [to] [--from ref --to ref]');
    return;
  }

  let fromSource: SnapshotReadResult | null = null;
  let toSource: SnapshotReadResult | null = null;

  try {
    fromSource = await resolveSnapshotSourceForRead(fromRef, Boolean(options.includeSecrets));
    toSource = await resolveSnapshotSourceForRead(toRef, Boolean(options.includeSecrets));
    const summary = buildDiffSummary(
      fromSource.payload,
      toSource.payload,
      fromSource.source,
      toSource.source,
    );
    const rows = summary.rows.map((row) => ({
      collection: row.collection,
      from: String(row.from),
      to: String(row.to),
      added: String(row.added),
      removed: String(row.removed),
      changed: String(row.changed),
    }));
    const totals = summary.rows.reduce(
      (acc, row) => {
        acc.added += row.added;
        acc.removed += row.removed;
        acc.changed += row.changed;
        return acc;
      },
      { added: 0, removed: 0, changed: 0 },
    );

    if (options.json || parsed.options.json === 'true') {
      logger.output(
        JSON.stringify(
          {
            from: summary.from,
            to: summary.to,
            totals,
            rows: summary.rows,
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(`Diff: ${summary.from} -> ${summary.to}`);
    logger.output(formatTable(rows, ['collection', 'from', 'to', 'added', 'removed', 'changed']));
    logger.output('');
    logger.output(
      formatToolResult(
        `Added: ${totals.added}  Removed: ${totals.removed}  Changed: ${totals.changed}`,
      ),
    );
  } finally {
    if (fromSource?.cleanup) {
      fromSource.cleanup();
    }
    if (toSource?.cleanup) {
      toSource.cleanup();
    }
  }
}

async function runImportCommandWithPreview(
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

async function runBulkCommand(
  tokens: string[],
  logger: ShortcutLogger,
  options: TopLevelOptions = {},
): Promise<void> {
  const parsed = parseCommandArgs(tokens);
  const action = (parsed.positionals[0] || 'export').toLowerCase();
  const target = parsed.positionals[1];

  if (action === 'export') {
    const output = options.out || target || undefined;
    const outputPath = resolveSafeOutputJsonPath(output, `stateset-export-${nowSuffix()}.json`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const data = await exportOrg(outputPath, { includeSecrets: options.includeSecrets });
    const rows = [
      ['agents', data.agents.length],
      ['rules', data.rules.length],
      ['skills', data.skills.length],
      ['attributes', data.attributes.length],
      ['functions', data.functions.length],
      ['examples', data.examples.length],
      ['evals', data.evals.length],
      ['datasets', data.datasets.length],
      ['agent settings', data.agentSettings.length],
    ] as const;
    if (options.json) {
      logger.output(
        JSON.stringify(
          {
            path: outputPath,
            counts: rows.map(([label, count]) => ({ label, count })),
          },
          null,
          2,
        ),
      );
      return;
    }
    logger.success(`Bulk export written to ${outputPath}`);
    logger.output(`Exported: ${rows.map(([label, count]) => `${count} ${label}`).join(', ')}`);
    return;
  }

  if (action === 'import') {
    if (!target) {
      logger.warning('Usage: bulk import <file|directory>');
      return;
    }
    if (!fs.existsSync(target)) {
      logger.error(`Import source not found: ${target}`);
      return;
    }
    let importSource = target;
    try {
      const stats = fs.lstatSync(target);
      if (stats.isDirectory()) {
        const candidates = fs
          .readdirSync(target, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name)
          .filter((name) => name.toLowerCase().endsWith('.json'));
        if (candidates.length === 0) {
          logger.error(`No .json files found in directory: ${target}`);
          return;
        }
        const prioritized = candidates.find((file) => file.startsWith('stateset-export'));
        const chosen = prioritized || candidates.sort().reverse()[0];
        importSource = path.join(target, chosen);
        logger.warning(`Bulk import using file in directory: ${importSource}`);
      } else if (!stats.isFile()) {
        logger.error(`Import source is not a file: ${target}`);
        return;
      }
    } catch (error) {
      logger.error(
        `Unable to inspect import source: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    if (!fs.existsSync(importSource) || !fs.lstatSync(importSource).isFile()) {
      logger.error(`Import source not found: ${importSource}`);
      return;
    }
    await runImportCommandWithPreview(importSource, logger, 'Bulk import', options);
    return;
  }

  logger.warning(`Unknown bulk action "${action}".`);
}

async function runTestCommand(
  tokens: string[],
  logger: ShortcutLogger,
  json = false,
  agentId?: string,
): Promise<void> {
  const input = stripQuotes(tokens.join(' '));
  if (!input) {
    logger.warning('Usage: /test "<message>" [--agent <id>]');
    return;
  }

  const previousAgentId = process.env.STATESET_ACTIVE_AGENT_ID;
  if (agentId) {
    process.env.STATESET_ACTIVE_AGENT_ID = agentId;
  }

  const { anthropicApiKey } = getRuntimeContext();
  const testAgent = new StateSetAgent(anthropicApiKey);
  await testAgent.connect();
  try {
    const response = await testAgent.chat(input);
    if (json) {
      logger.output(JSON.stringify({ response }, null, 2));
    } else {
      logger.output(formatToolResult(response || ''));
    }
  } finally {
    await testAgent.disconnect();
    if (agentId) {
      if (previousAgentId === undefined) {
        delete process.env.STATESET_ACTIVE_AGENT_ID;
      } else {
        process.env.STATESET_ACTIVE_AGENT_ID = previousAgentId;
      }
    }
  }
}

async function runPlaceholder(name: string, logger: ShortcutLogger): Promise<void> {
  logger.warning(
    `${name} is not implemented yet in shortcut mode. This is tracked in the roadmap.`,
  );
}

function normalizeDeploymentMode(rawMode: string | undefined): string | undefined {
  const normalized = (rawMode || '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'rollback' || normalized === 'deploy') return normalized;
  return undefined;
}

function normalizeDeploymentStatus(rawStatus: string | undefined): string | undefined {
  const normalized = (rawStatus || '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (
    normalized === 'scheduled' ||
    normalized === 'approved' ||
    normalized === 'applied' ||
    normalized === 'failed' ||
    normalized === 'cancelled'
  ) {
    return normalized;
  }
  return undefined;
}

function summarizeDeploymentsForStatus(
  deployments: ReturnType<typeof listDeployments>,
): Record<string, number> {
  return deployments.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.status] = (acc[entry.status] || 0) + 1;
    return acc;
  }, {});
}

async function runDeploymentsCommand(
  tokens: string[],
  logger: ShortcutLogger,
  json = false,
  options: DeploymentCommandOptions = {},
): Promise<void> {
  const raw = toLines(tokens);
  const parsed = parseCommandArgs(raw);
  const action = (parsed.positionals[0] || 'list').toLowerCase();
  const firstArg = parsed.positionals[1];
  const modeFilter = options.mode || normalizeDeploymentMode(parsed.options.mode);
  const statusFilter = options.status || normalizeDeploymentStatus(parsed.options.status);
  const limit = toPositiveInteger(
    parsed.options.limit || (options.limit === undefined ? undefined : String(options.limit)),
    50,
    200,
  );

  if (parsed.options.mode && !modeFilter) {
    logger.warning(`Unknown deployment mode: ${parsed.options.mode}. Use deploy|rollback.`);
    return;
  }
  if (parsed.options.status && !statusFilter) {
    logger.warning('Unknown deployment status. Use scheduled|approved|applied|failed|cancelled.');
    return;
  }

  if (action === 'list') {
    const listRef = firstArg;
    const rows = listDeployments(listRef);
    const filtered = rows.filter((entry) => {
      if (modeFilter && entry.mode !== modeFilter) return false;
      if (statusFilter && entry.status !== statusFilter) return false;
      return true;
    });

    if (filtered.length === 0) {
      logger.warning('No deployments found.');
      return;
    }

    const rowsToShow = filtered.slice(0, limit);
    if (json) {
      logger.output(
        JSON.stringify(
          {
            count: rowsToShow.length,
            total: filtered.length,
            deployments: rowsToShow,
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.output(
      formatTable(
        rowsToShow.map((entry) => ({
          id: entry.id,
          mode: entry.mode,
          status: entry.status,
          source: entry.source,
          scheduledFor: entry.scheduledFor || '-',
          updatedAt: entry.updatedAt,
        })),
        ['id', 'mode', 'status', 'source', 'scheduledFor', 'updatedAt'],
      ),
    );
    return;
  }

  if (action === 'get') {
    const targetRef = firstArg;
    if (!targetRef) {
      logger.warning('Usage: /deployments get <deployment-id>');
      return;
    }
    try {
      const deployment = getDeployment(targetRef);
      printPayload(logger, `Deployment ${deployment.id}`, deployment, json);
    } catch (error) {
      logger.warning(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (action === 'cancel') {
    const targetRef = firstArg;
    if (!targetRef) {
      logger.warning('Usage: /deployments cancel <deployment-id>');
      return;
    }
    try {
      const deployment = getDeployment(targetRef);
      if (deployment.status === 'applied') {
        logger.warning(
          `Deployment ${deployment.id} has already been applied and cannot be cancelled.`,
        );
        return;
      }
      if (deployment.status === 'cancelled') {
        logger.warning(`Deployment ${deployment.id} is already cancelled.`);
        return;
      }
      const updated = updateDeployment(targetRef, { status: 'cancelled' });
      logger.success(`Deployment ${updated.id} cancelled.`);
    } catch (error) {
      logger.warning(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (action === 'delete') {
    const targetRef = firstArg;
    if (!targetRef) {
      logger.warning('Usage: /deployments delete <deployment-id>');
      return;
    }
    try {
      const removed = deleteDeployment(targetRef);
      if (json) {
        logger.output(JSON.stringify({ removed }, null, 2));
      } else {
        logger.success(`Deployment ${removed.id} deleted.`);
      }
    } catch (error) {
      logger.warning(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (action === 'status') {
    const rows = listDeployments();
    const statusSummary = summarizeDeploymentsForStatus(rows);
    const modeSummary = rows.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.mode] = (acc[entry.mode] || 0) + 1;
      return acc;
    }, {});
    const summary = {
      total: rows.length,
      byMode: modeSummary,
      byStatus: statusSummary,
    };
    if (json) {
      logger.output(JSON.stringify(summary, null, 2));
      return;
    }
    logger.output(formatToolResult(JSON.stringify(summary, null, 2)));
    return;
  }

  const lookupRef = parsed.positionals[0];
  try {
    const deployment = getDeployment(lookupRef);
    printPayload(logger, `Deployment ${deployment.id}`, deployment, json);
  } catch (error) {
    logger.warning(`Unknown deployments command "${action}".`);
    logger.warning('Available: list, get, status, cancel, delete');
  }
}

async function runWebhooksCommand(
  tokens: string[],
  logger: ShortcutLogger,
  json = false,
  runner?: ShortcutRunner,
): Promise<void> {
  const raw = toLines(tokens);
  const { options, positionals } = parseCommandArgs(raw);
  const action = positionals[0]?.toLowerCase() || 'list';
  const firstArg = positionals[1];
  const hasPositionalId = firstArg && !firstArg.startsWith('--');
  const webhookRef = options.id || (action !== 'create' && hasPositionalId ? firstArg : undefined);
  const limit = toPositiveInteger(options.limit, 20, 200);
  const rows = action === 'list' ? listWebhooks(webhookRef) : [];

  if (action === 'list') {
    if (rows.length === 0) {
      logger.warning('No webhooks configured.');
      return;
    }
    if (json) {
      logger.output(JSON.stringify({ webhooks: rows }, null, 2));
      return;
    }
    const tableRows = rows.map((entry) => ({
      id: entry.id,
      url: entry.url,
      events: entry.events.join(','),
      enabled: String(entry.enabled),
      updated: entry.updatedAt,
    }));
    logger.output(formatTable(tableRows, ['id', 'url', 'events', 'enabled', 'updated']));
    return;
  }

  if (action === 'get') {
    if (!webhookRef) {
      logger.warning('Usage: /webhooks get <webhook-id-or-url>');
      return;
    }
    try {
      const result = getWebhook(webhookRef);
      logger.output(JSON.stringify(result, null, 2));
    } catch (error) {
      logger.warning(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (action === 'create') {
    const eventSource = options.url || options.endpoint || options.webhook;
    const eventList = options.events || options.event;
    const url = hasPositionalId ? firstArg : eventSource;
    if (!url) {
      logger.warning(
        'Usage: /webhooks create <url> [--events event1,event2] [--enabled true|false]',
      );
      return;
    }
    try {
      const created = createWebhook({
        url,
        events: eventList,
        enabled: parseToggleValue(options.enabled) !== false,
      });
      if (runner) {
        await pushWebhookLog({
          webhookId: created.id,
          event: 'created',
          status: 'ok',
          statusMessage: 'created via CLI',
        });
      }
      logger.output(
        json
          ? JSON.stringify({ webhook: created }, null, 2)
          : formatToolResult(JSON.stringify({ webhook: created }, null, 2)),
      );
    } catch (error) {
      logger.warning(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (action === 'test') {
    if (!webhookRef) {
      logger.warning('Usage: /webhooks test <webhook-id>');
      return;
    }
    try {
      const target = getWebhook(webhookRef);
      if (runner) {
        // no remote dispatch yet; record an invocation for operational visibility
        await pushWebhookLog({
          webhookId: target.id,
          event: 'test',
          status: 'ok',
          statusMessage: 'synthetic test event',
          payload: { url: target.url, events: target.events },
        });
      }
      logger.output(
        json
          ? JSON.stringify({ webhook: target.id, status: 'ok', test: true }, null, 2)
          : formatToolResult(
              JSON.stringify({ webhook: target.id, status: 'ok', test: true }, null, 2),
            ),
      );
    } catch (error) {
      logger.warning(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (action === 'logs') {
    if (!webhookRef) {
      logger.warning('Usage: /webhooks logs <webhook-id>');
      return;
    }
    try {
      const target = getWebhook(webhookRef);
      const logs = listWebhookLogs(target.id, limit);
      if (json) {
        logger.output(JSON.stringify({ webhook: target.id, logs }, null, 2));
      } else {
        if (logs.length === 0) {
          logger.warning(`No logs for webhook "${target.id}".`);
          return;
        }
        logger.output(
          formatTable(
            logs.map((entry) => ({
              time: entry.createdAt,
              event: entry.event,
              status: entry.status,
              id: entry.id,
              message: entry.statusMessage ?? '',
            })),
            ['time', 'event', 'status', 'id', 'message'],
          ),
        );
      }
    } catch (error) {
      logger.warning(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (action === 'delete') {
    if (!webhookRef) {
      logger.warning('Usage: /webhooks delete <webhook-id>');
      return;
    }
    try {
      const removed = deleteWebhook(webhookRef);
      logger.output(
        json
          ? JSON.stringify({ removed }, null, 2)
          : formatToolResult(JSON.stringify({ removed }, null, 2)),
      );
    } catch (error) {
      logger.warning(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  logger.warning(`Unknown webhooks command "${action}".`);
  logger.output(formatToolResult('Available: list, create, test, logs, delete'));
}

async function runAlertsCommand(
  tokens: string[],
  logger: ShortcutLogger,
  json = false,
): Promise<void> {
  const raw = toLines(tokens);
  const { options, positionals } = parseCommandArgs(raw);
  const action = positionals[0]?.toLowerCase() || 'list';
  const alertId = positionals[1] || options.id;
  const metric = options.metric || positionals[1];
  const thresholdValue = options.threshold || options['threshold-value'];
  const channel = options.channel || options.notification_channel;

  if (action === 'list') {
    const alerts = listAlerts(alertId);
    if (alerts.length === 0) {
      logger.warning('No alerts configured.');
      return;
    }
    if (json) {
      logger.output(JSON.stringify({ alerts }, null, 2));
      return;
    }
    const rows = alerts.map((entry) => ({
      id: entry.id,
      metric: entry.metric,
      threshold: String(entry.threshold),
      channel: entry.channel || '-',
      enabled: String(entry.enabled),
      updated: entry.updatedAt,
    }));
    logger.output(
      formatTable(rows, ['id', 'metric', 'threshold', 'channel', 'enabled', 'updated']),
    );
    return;
  }

  if (action === 'get') {
    if (!alertId) {
      logger.warning('Usage: /alerts get <alert-id>');
      return;
    }
    const matches = listAlerts(alertId);
    if (matches.length === 0) {
      logger.warning(`No alert found for "${alertId}".`);
      return;
    }
    if (json) {
      logger.output(JSON.stringify({ alerts: matches }, null, 2));
      return;
    }
    const rows = matches.map((entry) => ({
      id: entry.id,
      metric: entry.metric,
      threshold: String(entry.threshold),
      channel: entry.channel || '-',
      enabled: String(entry.enabled),
      updated: entry.updatedAt,
    }));
    logger.output(
      formatTable(rows, ['id', 'metric', 'threshold', 'channel', 'enabled', 'updated']),
    );
    return;
  }

  if (action === 'create') {
    const rawThreshold = thresholdValue || positionals[2];
    const threshold = rawThreshold ? Number.parseFloat(String(rawThreshold)) : Number.NaN;
    if (!metric || !Number.isFinite(threshold)) {
      logger.warning(
        'Usage: /alerts create --metric <metric> --threshold <value> [--channel <name>]',
      );
      return;
    }
    try {
      const created = createAlert({
        metric,
        threshold,
        channel,
        enabled: parseToggleValue(options.enabled) !== false,
      });
      logger.output(
        json
          ? JSON.stringify({ alert: created }, null, 2)
          : formatToolResult(JSON.stringify({ alert: created }, null, 2)),
      );
    } catch (error) {
      logger.warning(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (action === 'delete') {
    if (!alertId) {
      logger.warning('Usage: /alerts delete <alert-id>');
      return;
    }
    try {
      const removed = deleteAlert(alertId);
      logger.output(
        json
          ? JSON.stringify({ removed }, null, 2)
          : formatToolResult(JSON.stringify({ removed }, null, 2)),
      );
    } catch (error) {
      logger.warning(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  logger.warning(`Unknown alerts command "${action}".`);
  logger.output(formatToolResult('Available: list, get, create, delete'));
}

async function collectMonitorSnapshot(
  runner: ShortcutRunner,
  options?: {
    agentId?: string;
    recentChannelsLimit?: number;
    recentWebhookLogLimit?: number;
  },
): Promise<MonitorSnapshot> {
  const agentId = options?.agentId?.trim();
  const recentChannelsLimit = options?.recentChannelsLimit ?? 5;
  const recentWebhookLogLimit = options?.recentWebhookLogLimit ?? 5;
  const isAgentScope = Boolean(agentId);
  const scopedFilter = agentId ? { agent_id: agentId } : {};
  const listLimit = 10000;

  const [
    agentsResult,
    rulesResult,
    responseCountResult,
    messageCountResult,
    kbInfoResult,
    channelScopeResult,
    openChannelsResult,
    needsAttentionChannelsResult,
    inProgressChannelsResult,
    recentChannelsResult,
  ] = await Promise.all([
    runner.callTool('list_agents', { limit: 1000 }),
    runner.callTool('list_rules', { limit: 1000 }),
    runner.callTool('get_response_count', {}),
    runner.callTool('get_message_count', {}),
    runner.callTool('kb_get_collection_info', {}),
    isAgentScope
      ? runner.callTool('list_channels', { ...scopedFilter, limit: listLimit })
      : runner.callTool('get_channel_count', {}),
    runner.callTool('list_channels', { ...scopedFilter, status: 'open', limit: 1000 }),
    runner.callTool('list_channels', {
      ...scopedFilter,
      status: 'needs_attention',
      limit: 1000,
    }),
    runner.callTool('list_channels', { ...scopedFilter, status: 'in_progress', limit: 1000 }),
    runner.callTool('list_channels', { ...scopedFilter, limit: recentChannelsLimit }),
  ]);

  const agents = asRecordArray(agentsResult.payload);
  const rules = asRecordArray(rulesResult.payload);
  const responseCount = extractAggregateCount(responseCountResult.payload, 'responses_aggregate');
  const messageCount = extractAggregateCount(messageCountResult.payload, 'message_aggregate');
  const channelRows = isAgentScope ? asRecordArray(channelScopeResult.payload) : [];
  const channelCount = isAgentScope
    ? channelRows.length
    : extractAggregateCount(channelScopeResult.payload, 'channel_thread_aggregate');
  const openChannels = asRecordArray(openChannelsResult.payload);
  const needsAttentionChannels = asRecordArray(needsAttentionChannelsResult.payload);
  const inProgressChannels = asRecordArray(inProgressChannelsResult.payload);
  const recentChannels = asRecordArray(recentChannelsResult.payload).slice(0, recentChannelsLimit);

  const kbInfo = asStringRecord(kbInfoResult.payload);
  const kbCollectionRaw = toDisplayValue(kbInfo.collection);
  const kbPointsRaw = asStringRecord(kbInfo.info).points_count;
  const kbPoints = toDisplayValue(kbPointsRaw);

  const operationsStore = loadOperationsStore();
  const enabledWebhookCount = operationsStore.webhooks.filter((webhook) => webhook.enabled).length;
  const recentWebhookLogs = operationsStore.webhookLogs
    .slice(0, recentWebhookLogLimit)
    .map((entry) => ({
      time: entry.createdAt,
      webhook: entry.webhookId,
      event: entry.event,
      status: entry.status,
      message: entry.statusMessage || '-',
    }));

  const metrics: Array<{ metric: string; value: string }> = [
    { metric: 'Scope', value: isAgentScope ? `agent:${agentId}` : 'organization' },
    { metric: 'Agents', value: String(agents.length) },
    { metric: 'Rules', value: String(rules.length) },
    { metric: 'Channels', value: String(channelCount) },
    { metric: 'Open channels', value: String(openChannels.length) },
    { metric: 'Needs attention', value: String(needsAttentionChannels.length) },
    { metric: 'In progress', value: String(inProgressChannels.length) },
    { metric: 'Messages', value: String(messageCount) },
    { metric: 'Responses', value: String(responseCount) },
    {
      metric: 'Webhook subscriptions',
      value: `${operationsStore.webhooks.length} (${enabledWebhookCount} enabled)`,
    },
    { metric: 'Alert rules', value: String(operationsStore.alerts.length) },
    { metric: 'KB', value: `${kbCollectionRaw} (${kbPoints} points)` },
  ];

  const recentChannelRows = recentChannels.map((channel) => {
    const recordAgent = asStringRecord(channel.agent);
    const agentName = toDisplayValue(
      recordAgent.agent_name || recordAgent.id || recordAgent.name || '-',
    );
    const channelId = toDisplayValue(channel.uuid || channel.id);
    const name = toDisplayValue(channel.name);
    return {
      id: channelId,
      name,
      status: toDisplayValue(channel.status),
      agent: agentName,
      created: toDisplayValue(channel.created_at),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    scope: isAgentScope ? `agent:${agentId}` : 'organization',
    metrics,
    recentChannels: recentChannelRows,
    recentWebhookLogs,
  };
}

function printMonitorSnapshot(
  logger: ShortcutLogger,
  snapshot: MonitorSnapshot,
  jsonMode: boolean,
  iteration = 1,
): void {
  if (jsonMode) {
    logger.output(JSON.stringify({ iteration, ...snapshot }));
    return;
  }

  logger.success(`Monitor snapshot ${iteration} (${snapshot.scope}) @ ${snapshot.generatedAt}`);
  logger.output(formatTable(snapshot.metrics, ['metric', 'value']));

  if (snapshot.recentChannels.length > 0) {
    logger.output(formatToolResult('Recent conversations'));
    logger.output(
      formatTable(snapshot.recentChannels, ['id', 'name', 'status', 'agent', 'created']),
    );
  } else {
    logger.output(chalk.gray('  Recent conversations: none'));
  }

  if (snapshot.recentWebhookLogs.length > 0) {
    logger.output(formatToolResult('Recent webhook events'));
    logger.output(
      formatTable(snapshot.recentWebhookLogs, ['time', 'webhook', 'event', 'status', 'message']),
    );
  } else {
    logger.output(chalk.gray('  Recent webhook events: none'));
  }
}

async function runMonitorCommand(
  tokens: string[],
  logger: ShortcutLogger,
  json = false,
  runner?: ShortcutRunner,
): Promise<void> {
  if (!runner) {
    logger.warning('Monitor requires authentication and an active tool runner.');
    return;
  }

  const raw = toLines(tokens);
  const { options, positionals } = parseCommandArgs(raw);
  const action = positionals[0]?.toLowerCase() || 'status';
  const agentId = options.agent || options.agent_id;
  const jsonMode = parseToggleValue(options.json) || json;
  const intervalSeconds = options.interval
    ? parsePositiveIntegerOption(String(options.interval))
    : undefined;
  const refreshSeconds = intervalSeconds === undefined ? 5 : intervalSeconds;
  if (options.interval && intervalSeconds === undefined) {
    logger.warning('Invalid --interval value. Expected a positive integer in seconds.');
    return;
  }

  const maxIterations = options.count
    ? parsePositiveIntegerOption(String(options.count))
    : undefined;
  if (options.count && maxIterations === undefined) {
    logger.warning('Invalid --count value. Expected a positive integer.');
    return;
  }

  const recentChannelLimit = toPositiveInteger(options.limit, 5, 50);
  const recentWebhookLogLimit = toPositiveInteger(
    options['webhook-logs'] ||
      options['webhook_logs'] ||
      options['webhook-log-limit'] ||
      options.webhookLogs ||
      options.webhook_log_limit ||
      options.webhookLogLimit,
    5,
    50,
  );

  if (action === 'status') {
    const snapshot = await collectMonitorSnapshot(runner, {
      agentId,
      recentChannelsLimit: recentChannelLimit,
      recentWebhookLogLimit,
    });
    printMonitorSnapshot(logger, snapshot, jsonMode);
    return;
  }

  if (action === 'live') {
    let iteration = 0;
    const loopLimit = maxIterations ?? Number.MAX_SAFE_INTEGER;
    while (iteration < loopLimit) {
      iteration += 1;
      const snapshot = await collectMonitorSnapshot(runner, {
        agentId,
        recentChannelsLimit: recentChannelLimit,
        recentWebhookLogLimit,
      });
      printMonitorSnapshot(logger, snapshot, jsonMode, iteration);
      if (iteration >= loopLimit) {
        return;
      }
      await sleep(refreshSeconds * 1000);
    }
    return;
  }

  logger.warning(`Unknown monitor action "${action}".`);
  logger.output(formatToolResult('Available: status|live'));
}

async function withAgentRunner<T>(fn: (runner: ShortcutRunner) => Promise<T>): Promise<T> {
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

export async function handleShortcutCommand(input: string, ctx: ChatContext) {
  const logger = buildSlashLogger(ctx);
  const trimmed = input.trim();
  const tokens = toLines(trimmed.split(/\s+/).slice(1));
  const command = trimmed.toLowerCase().split(/\s+/)[0];
  const parsedArgs = parseCommandArgs(tokens);
  const slashOptions = parseTopLevelOptionsFromSlashArgs(parsedArgs.options);

  try {
    if (command === '/rules') {
      await runRulesCommand(
        tokens,
        { callTool: ctx.agent.callTool.bind(ctx.agent) },
        logger,
        slashOptions.json,
      );
      logger.done();
      return { handled: true };
    }
    if (command === '/kb') {
      await runKnowledgeBaseCommand(
        tokens,
        { callTool: ctx.agent.callTool.bind(ctx.agent) },
        logger,
        slashOptions.json,
      );
      logger.done();
      return { handled: true };
    }
    if (command === '/agents') {
      await runAgentsCommand(
        tokens,
        { callTool: ctx.agent.callTool.bind(ctx.agent) },
        logger,
        slashOptions.json,
      );
      logger.done();
      return { handled: true };
    }
    if (command === '/channels') {
      await runChannelsCommand(
        tokens,
        { callTool: ctx.agent.callTool.bind(ctx.agent) },
        logger,
        slashOptions.json,
      );
      logger.done();
      return { handled: true };
    }
    if (command === '/convos') {
      await runConvosCommand(
        tokens,
        { callTool: ctx.agent.callTool.bind(ctx.agent) },
        logger,
        slashOptions.json,
      );
      logger.done();
      return { handled: true };
    }
    if (command === '/conversations') {
      await runConvosCommand(
        tokens,
        { callTool: ctx.agent.callTool.bind(ctx.agent) },
        logger,
        slashOptions.json,
      );
      logger.done();
      return { handled: true };
    }
    if (command === '/status') {
      await runStatusCommand(
        { callTool: ctx.agent.callTool.bind(ctx.agent) },
        logger,
        slashOptions.json,
      );
      logger.done();
      return { handled: true };
    }
    if (command === '/stats') {
      const forwarded = [...tokens];
      const periodFrom = parsedArgs.options.period
        ? parsePeriodRangeAsIso(parsedArgs.options.period)
        : undefined;
      if (parsedArgs.options.period && (parsedArgs.options.from || parsedArgs.options.since)) {
        logger.warning('Use either --from/--since or --period, not both.');
        logger.done();
        return { handled: true };
      }
      if (parsedArgs.options.period && !periodFrom) {
        logger.warning(`Invalid --period value: ${parsedArgs.options.period}`);
        logger.done();
        return { handled: true };
      }
      if (slashOptions.from) {
        forwarded.push('--from', slashOptions.from);
      }
      if (slashOptions.to) {
        forwarded.push('--to', slashOptions.to);
      }
      await runAnalyticsCommand(
        forwarded,
        { callTool: ctx.agent.callTool.bind(ctx.agent) },
        logger,
        slashOptions.json,
      );
      logger.done();
      return { handled: true };
    }
    if (command === '/analytics') {
      const forwarded = [...tokens];
      const periodFrom = parsedArgs.options.period
        ? parsePeriodRangeAsIso(parsedArgs.options.period)
        : undefined;
      if (parsedArgs.options.period && (parsedArgs.options.from || parsedArgs.options.since)) {
        logger.warning('Use either --from/--since or --period, not both.');
        logger.done();
        return { handled: true };
      }
      if (parsedArgs.options.period && !periodFrom) {
        logger.warning(`Invalid --period value: ${parsedArgs.options.period}`);
        logger.done();
        return { handled: true };
      }
      if (slashOptions.from) {
        forwarded.push('--from', slashOptions.from);
      }
      if (slashOptions.to) {
        forwarded.push('--to', slashOptions.to);
      }
      await runAnalyticsCommand(
        forwarded,
        { callTool: ctx.agent.callTool.bind(ctx.agent) },
        logger,
        slashOptions.json,
      );
      logger.done();
      return { handled: true };
    }
    if (command === '/snapshot') {
      const actionArgs = parsedArgs.positionals;
      await runTopLevelSnapshot(actionArgs, slashOptions);
      logger.done();
      return { handled: true };
    }
    if (command === '/pull') {
      const targetArg = parsedArgs.positionals[0];
      const source = slashOptions.from || targetArg;
      await runTopLevelPull(source ? [source] : [], slashOptions);
      logger.done();
      return { handled: true };
    }
    if (command === '/push') {
      const sourceArg = slashOptions.from || parsedArgs.positionals[0];
      await runTopLevelPush(sourceArg ? [sourceArg] : [], slashOptions);
      logger.done();
      return { handled: true };
    }
    if (command === '/validate') {
      const sourceArg = slashOptions.from || parsedArgs.positionals[0];
      await runTopLevelValidate(sourceArg ? [sourceArg] : [], slashOptions);
      logger.done();
      return { handled: true };
    }
    if (command === '/watch') {
      const sourceArg = slashOptions.from || parsedArgs.positionals[0];
      await runTopLevelWatch(sourceArg ? [sourceArg] : [], {
        from: sourceArg,
        json: slashOptions.json,
        interval: parsedArgs.options.interval,
        once: slashOptions.once,
        dryRun: slashOptions.dryRun,
        strict: slashOptions.strict,
        includeSecrets: slashOptions.includeSecrets,
      });
      logger.done();
      return { handled: true };
    }
    if (command === '/bulk') {
      await runBulkCommand(tokens, logger, slashOptions);
      logger.done();
      return { handled: true };
    }
    if (command === '/test') {
      const tokenOptions = parsedArgs;
      const options = tokenOptions.options;
      const agentId = options.agent || options.agentId;
      const remaining = tokenOptions.positionals;
      await runTestCommand(remaining, logger, slashOptions.json, agentId);
      logger.done();
      return { handled: true };
    }
    if (command === '/diff') {
      await runDiffCommand(tokens, logger, slashOptions);
      logger.done();
      return { handled: true };
    }
    if (command === '/webhooks') {
      await runWebhooksCommand(tokens, logger, slashOptions.json, {
        callTool: ctx.agent.callTool.bind(ctx.agent),
      });
      logger.done();
      return { handled: true };
    }
    if (command === '/alerts') {
      await runAlertsCommand(tokens, logger, slashOptions.json);
      logger.done();
      return { handled: true };
    }
    if (command === '/monitor') {
      await runMonitorCommand(tokens, logger, slashOptions.json, {
        callTool: ctx.agent.callTool.bind(ctx.agent),
      });
      logger.done();
      return { handled: true };
    }
    if (command === '/deploy' || command === '/rollback') {
      const source = slashOptions.from || parsedArgs.positionals[0];
      const actionArgs = parsedArgs.positionals.slice(source ? 1 : 0);
      if (command === '/deploy') {
        await runTopLevelDeploy(actionArgs, {
          from: source,
          to: slashOptions.to,
          dryRun: slashOptions.dryRun,
          yes: slashOptions.yes,
          strict: slashOptions.strict,
          includeSecrets: slashOptions.includeSecrets,
          schedule: slashOptions.schedule,
          approve: slashOptions.approve,
        });
        logger.done();
        return { handled: true };
      }
      await runTopLevelRollback(actionArgs, {
        from: source,
        to: slashOptions.to,
        dryRun: slashOptions.dryRun,
        yes: slashOptions.yes,
        strict: slashOptions.strict,
        includeSecrets: slashOptions.includeSecrets,
        schedule: slashOptions.schedule,
        approve: slashOptions.approve,
      });
      logger.done();
      return { handled: true };
    }
    if (command === '/deployments') {
      await runDeploymentsCommand(tokens, logger, slashOptions.json, {
        mode: parsedArgs.options.mode,
        status: parsedArgs.options.status,
        limit: parsedArgs.options.limit,
      });
      logger.done();
      return { handled: true };
    }
    if (command === '/messages') {
      await runMessagesCommand(
        tokens,
        { callTool: ctx.agent.callTool.bind(ctx.agent) },
        logger,
        slashOptions.json,
      );
      logger.done();
      return { handled: true };
    }
    if (command === '/responses') {
      await runResponsesCommand(
        tokens,
        { callTool: ctx.agent.callTool.bind(ctx.agent) },
        logger,
        slashOptions.json,
      );
      logger.done();
      return { handled: true };
    }
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    logger.done();
    return { handled: true };
  }

  return { handled: false };
}

async function runTopLevelRules(args: string[] = [], options: TopLevelOptions = {}): Promise<void> {
  const logger = buildTopLevelLogger();
  await withAgentRunner(async (runner) => {
    await runRulesCommand(args, runner, logger, Boolean(options.json));
  });
}

async function runTopLevelKb(args: string[] = [], options: TopLevelOptions = {}): Promise<void> {
  const logger = buildTopLevelLogger();
  await withAgentRunner(async (runner) => {
    await runKnowledgeBaseCommand(args, runner, logger, Boolean(options.json));
  });
}

async function runTopLevelAgents(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await withAgentRunner(async (runner) => {
    await runAgentsCommand(args, runner, logger, Boolean(options.json));
  });
}

async function runTopLevelChannels(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await withAgentRunner(async (runner) => {
    await runChannelsCommand(args, runner, logger, Boolean(options.json));
  });
}

async function runTopLevelConvos(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await withAgentRunner(async (runner) => {
    await runConvosCommand(args, runner, logger, Boolean(options.json));
  });
}

async function runTopLevelMessages(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await withAgentRunner(async (runner) => {
    await runMessagesCommand(args, runner, logger, Boolean(options.json));
  });
}

async function runTopLevelResponses(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await withAgentRunner(async (runner) => {
    await runResponsesCommand(args, runner, logger, Boolean(options.json));
  });
}

async function runTopLevelStatus(options: TopLevelOptions = {}): Promise<void> {
  const logger = buildTopLevelLogger();
  await withAgentRunner(async (runner) => {
    await runStatusCommand(runner, logger, Boolean(options.json));
  });
}

async function runTopLevelStats(args: string[] = [], options: TopLevelOptions = {}): Promise<void> {
  const from = options.from || options.since;
  await runTopLevelAnalytics(args, {
    json: options.json,
    from,
    to: options.to,
  });
}

async function runTopLevelDiff(args: string[] = [], options: TopLevelOptions = {}): Promise<void> {
  const logger = buildTopLevelLogger();
  await runDiffCommand(args, logger, options);
}

async function runTopLevelAnalytics(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  const forwarded = [...args];
  if (options.from) {
    forwarded.push('--from', options.from);
  }
  if (options.to) {
    forwarded.push('--to', options.to);
  }
  await withAgentRunner(async (runner) => {
    await runAnalyticsCommand(forwarded, runner, logger, Boolean(options.json));
  });
}

async function runTopLevelDeploy(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await runTopLevelDeployment('deploy', args, options, logger);
}

async function runTopLevelRollback(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await runTopLevelDeployment('rollback', args, options, logger);
}

async function runTopLevelDeployments(
  args: string[] = [],
  options: DeploymentCommandOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await runDeploymentsCommand(args, logger, Boolean(options.json), options);
}

async function runTopLevelDeployment(
  mode: 'deploy' | 'rollback',
  args: string[] = [],
  options: TopLevelOptions = {},
  logger: ShortcutLogger,
): Promise<void> {
  const source = options.from || args[0];
  const label = mode === 'deploy' ? 'Deploy' : 'Rollback';

  if (options.schedule && options.approve) {
    logger.warning(`${label} cannot use both --schedule and --approve at once.`);
    return;
  }

  if (options.schedule) {
    if (!source) {
      logger.warning(`Usage: ${label.toLowerCase()} --schedule <datetime> <snapshot-ref>`);
      return;
    }
    const scheduledForMs = parseDateInput(options.schedule);
    if (scheduledForMs === undefined) {
      logger.warning(`Invalid schedule value: ${options.schedule}`);
      return;
    }
    const scheduledForIso = new Date(scheduledForMs).toISOString();
    const scheduled = createDeployment({
      mode,
      source,
      scheduledFor: scheduledForIso,
      dryRun: options.dryRun,
      strict: options.strict,
      includeSecrets: options.includeSecrets,
      yes: options.yes,
    });
    logger.success(
      `${label} scheduled with id ${scheduled.id} for ${scheduledForIso} from ${scheduled.source}`,
    );
    return;
  }

  if (options.approve) {
    const target = getDeployment(options.approve);
    if (target.mode !== mode) {
      logger.warning(`Deployment ${options.approve} is for ${target.mode}, not ${mode}.`);
      return;
    }
    if (!target.source) {
      logger.warning(`Deployment ${options.approve} has no source path.`);
      return;
    }
    if (target.status === 'applied') {
      logger.warning(`Deployment ${target.id} already applied.`);
      return;
    }
    const actionSource = source || target.source;
    updateDeployment(target.id, {
      source: actionSource,
      status: 'approved',
      approvedAt: new Date().toISOString(),
      dryRun: options.dryRun !== undefined ? options.dryRun : target.dryRun,
      strict: options.strict !== undefined ? options.strict : target.strict,
      includeSecrets:
        options.includeSecrets !== undefined ? options.includeSecrets : target.includeSecrets,
      yes: options.yes !== undefined ? options.yes : target.yes,
    });
    try {
      await runImportCommandWithPreview(actionSource, logger, label, {
        from: actionSource,
        dryRun: options.dryRun ?? target.dryRun,
        yes: true,
        strict: options.strict ?? target.strict,
        includeSecrets: options.includeSecrets ?? target.includeSecrets,
      });
      updateDeployment(target.id, {
        status: 'applied',
        appliedAt: new Date().toISOString(),
      });
    } catch (error) {
      updateDeployment(target.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    return;
  }

  if (!source) {
    if (mode === 'deploy') {
      logger.warning('Usage: deploy <snapshot-ref> [--dry-run] [--yes]');
    } else {
      logger.warning('Usage: rollback <snapshot-ref> [--dry-run] [--yes]');
    }
    return;
  }

  await runImportCommandWithPreview(source, logger, label, options);
}

async function runTopLevelSnapshot(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  const parsed = parseCommandArgs(args);
  const action = (parsed.positionals[0] || 'list').toLowerCase();
  const payload = parsed.positionals[1];

  if (action === 'list') {
    const snapshots = listSnapshotInfos();
    if (snapshots.length === 0) {
      logger.warning('No snapshots available.');
      return;
    }

    const filtered = payload
      ? snapshots.filter((entry) => {
          const normalized = payload.toLowerCase();
          return (
            entry.id.toLowerCase().includes(normalized) ||
            entry.file.toLowerCase().includes(normalized)
          );
        })
      : snapshots;
    if (filtered.length === 0) {
      logger.warning(`No snapshots matching "${payload}".`);
      return;
    }

    const rows = filtered.map((entry) => ({
      snapshot: entry.id,
      file: entry.file,
      size: formatBytes(entry.size),
      modified: new Date(entry.modifiedAt).toISOString(),
    }));

    if (options.json) {
      logger.output(
        JSON.stringify(
          {
            count: rows.length,
            snapshots: rows,
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.output(formatTable(rows, ['snapshot', 'size', 'modified']));
    return;
  }

  if (action === 'create') {
    const customName = payload;
    const filename = defaultSnapshotName(customName);
    const explicitOut = options.out;
    const outputPath = explicitOut
      ? resolveSafeOutputJsonPath(explicitOut, filename)
      : path.join(ensureSnapshotDir(), filename);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const data = await exportOrg(outputPath, { includeSecrets: options.includeSecrets });
    if (options.json) {
      logger.output(
        JSON.stringify(
          {
            action: 'create',
            path: outputPath,
            snapshot: path.basename(outputPath),
            counts: {
              agents: data.agents.length,
              rules: data.rules.length,
              skills: data.skills.length,
              attributes: data.attributes.length,
              functions: data.functions.length,
              examples: data.examples.length,
              evals: data.evals.length,
              datasets: data.datasets.length,
              agentSettings: data.agentSettings.length,
            },
          },
          null,
          2,
        ),
      );
      return;
    }
    logger.success(`Snapshot created: ${outputPath}`);
    return;
  }

  if (action === 'show') {
    const snapshotRef = payload || 'latest';
    const snapshotPath = resolveSnapshotPath(snapshotRef);
    if (!snapshotPath) {
      logger.error(`Snapshot not found: ${snapshotRef}`);
      return;
    }
    const data = readSnapshot(snapshotPath);
    if (options.json) {
      logger.output(JSON.stringify(data, null, 2));
      return;
    }
    printPayload(logger, `Snapshot: ${path.basename(snapshotPath)}`, data, false);
    return;
  }

  logger.warning(`Unknown snapshot action "${action}".`);
}

async function runTopLevelPull(args: string[] = [], options: TopLevelOptions = {}): Promise<void> {
  const logger = buildTopLevelLogger();
  const dirArg = args[0];
  const targetDir = resolveStateSetDir(dirArg);
  const tempExportPath = createTempStateSetPath('stateset-pull');
  try {
    const payload = await exportOrg(tempExportPath, { includeSecrets: options.includeSecrets });
    writeStateSetBundle(targetDir, payload);
    const counts = summarizeStateSetPayload(payload);
    const files = DEFAULT_STATESET_DIR_OPTIONS;
    if (options.json) {
      logger.output(
        JSON.stringify(
          {
            path: targetDir,
            source: path.basename(tempExportPath),
            exportedAt: payload.exportedAt,
            version: payload.version,
            orgId: payload.orgId,
            counts,
            files,
          },
          null,
          2,
        ),
      );
      return;
    }
    logger.success(`Pulled config from organization to ${targetDir}`);
    logger.output(
      `Wrote: ${counts.agents} agents, ${counts.rules} rules, ${counts.skills} skills, ${counts.attributes} attributes, ${counts.functions} functions, ${counts.examples} examples, ${counts.evals} evals, ${counts.datasets} datasets, ${counts.agentSettings} agent settings`,
    );
    logger.output(`Files: ${files.join(', ')}`);
    return;
  } finally {
    try {
      fs.unlinkSync(tempExportPath);
    } catch {
      // ignore
    }
  }
}

async function runTopLevelPush(args: string[] = [], options: TopLevelOptions = {}): Promise<void> {
  const logger = buildTopLevelLogger();
  const sourceArg = args[0] || options.from || DEFAULT_STATESET_DIR;

  const resolved = path.resolve(sourceArg);
  if (!fs.existsSync(resolved)) {
    logger.error(`StateSet source not found: ${resolved}`);
    return;
  }

  const stats = fs.lstatSync(resolved);
  let importPath = resolved;
  let tempImportPath: string | undefined;

  try {
    if (stats.isDirectory()) {
      const payload = readStateSetBundle(resolved);
      importPath = writeTempStateSetBundle(payload, 'stateset-push');
      tempImportPath = importPath;
      logger.output(`Prepared import file ${importPath} from ${resolved}`);
    } else if (!stats.isFile()) {
      logger.error(`StateSet source is neither file nor directory: ${resolved}`);
      return;
    }
    await runImportCommandWithPreview(importPath, logger, 'Push', options);
  } finally {
    if (tempImportPath) {
      try {
        fs.unlinkSync(tempImportPath);
      } catch {
        // ignore
      }
    }
  }
}

async function runTopLevelValidate(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  const sourceArg = args[0] || options.from;
  const source = normalizeStateSetSource(sourceArg);
  if (!fs.existsSync(source)) {
    logger.error(`StateSet source not found: ${source}`);
    return;
  }

  const warnings: string[] = [];
  const stats = fs.lstatSync(source);

  if (!stats.isFile() && !stats.isDirectory()) {
    throw new Error(`StateSet source must be a file or directory: ${source}`);
  }
  const payload: OrgExport = readStateSetBundle(source);

  if (stats.isDirectory()) {
    const configPath = path.join(source, DEFAULT_STATESET_CONFIG_FILE);
    const hasManifest = fs.existsSync(configPath);
    const hasBundle = fs.existsSync(path.join(source, DEFAULT_STATESET_BUNDLE_FILE));
    const filesPresent = DEFAULT_STATESET_DIR_OPTIONS.filter((file) =>
      fs.existsSync(path.join(source, file)),
    );
    if (filesPresent.length === 0 && !hasManifest && !hasBundle) {
      warnings.push(`No .stateset payload files found in ${source}.`);
    }
    if (options.strict && !hasManifest && !hasBundle && filesPresent.length === 0) {
      warnings.push(
        'Strict mode requires snapshot.json, config.json, or at least one resource file.',
      );
    }
    if (!hasManifest && !hasBundle) {
      warnings.push('No generated metadata file found (config.json or snapshot.json).');
    }
    if (!hasBundle && filesPresent.length < DEFAULT_STATESET_DIR_OPTIONS.length) {
      const missing = DEFAULT_STATESET_DIR_OPTIONS.filter(
        (file) => !fs.existsSync(path.join(source, file)),
      );
      warnings.push(
        `Missing resource files: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` (+${missing.length - 3} more)` : ''}`,
      );
    }
  }

  const counts = summarizeStateSetPayload(payload);
  if (options.json) {
    logger.output(
      JSON.stringify(
        {
          source,
          type: stats.isDirectory() ? 'directory' : 'file',
          valid: warnings.length === 0,
          strict: options.strict,
          counts,
          warnings,
        },
        null,
        2,
      ),
    );
    if (options.strict && warnings.length > 0) {
      throw new Error(`Validation failed: ${warnings.length} issue(s).`);
    }
    return;
  }

  if (warnings.length > 0) {
    for (const warning of warnings) {
      logger.warning(warning);
    }
    if (options.strict) {
      logger.error(`Validation failed with ${warnings.length} issue(s).`);
      throw new Error('Validation failed.');
    }
  } else {
    logger.success(`Validation passed for ${source}.`);
  }

  const rows = [
    ['agents', String(counts.agents)],
    ['rules', String(counts.rules)],
    ['skills', String(counts.skills)],
    ['attributes', String(counts.attributes)],
    ['functions', String(counts.functions)],
    ['examples', String(counts.examples)],
    ['evals', String(counts.evals)],
    ['datasets', String(counts.datasets)],
    ['agent settings', String(counts.agentSettings)],
  ] as const;
  logger.output(
    formatTable(
      rows.map(([name, value]) => ({ resource: name, count: value })),
      ['resource', 'count'],
    ),
  );
}

async function runTopLevelBulk(args: string[] = [], options: TopLevelOptions = {}): Promise<void> {
  const logger = buildTopLevelLogger();
  await runBulkCommand(args, logger, options);
}

async function runTopLevelWatch(args: string[] = [], options: WatchOptions = {}): Promise<void> {
  const logger = buildTopLevelLogger();
  const sourceArg = args[0] || options.from || DEFAULT_STATESET_DIR;
  const sourceDir = normalizeStateSetSource(sourceArg);

  if (!fs.existsSync(sourceDir)) {
    logger.error(`StateSet source not found: ${sourceDir}`);
    return;
  }

  const stats = fs.lstatSync(sourceDir);
  if (!stats.isDirectory()) {
    logger.error(`StateSet watch requires a directory: ${sourceDir}`);
    return;
  }

  const intervalSeconds = options.interval ? parsePositiveIntegerOption(options.interval) : 5;
  if (options.interval && intervalSeconds === undefined) {
    logger.warning('Invalid --interval value. Expected a positive integer in seconds.');
    return;
  }

  const once = options.once === true;
  const intervalMs = intervalSeconds * 1000;

  const watchLabel = `watch ${sourceDir}`;
  logger.success(
    `Starting ${watchLabel} every ${intervalSeconds}s (${once ? 'once' : 'continuous'} mode)`,
  );

  if (options.json) {
    logger.output(
      JSON.stringify(
        {
          event: 'watch.start',
          source: sourceDir,
          intervalSeconds,
          once,
        },
        null,
        2,
      ),
    );
  }

  const pushOptions: TopLevelOptions = {
    from: sourceDir,
    dryRun: options.dryRun,
    yes: true,
    strict: options.strict,
    includeSecrets: options.includeSecrets,
  };

  let previousFingerprint = '';
  let firstIteration = true;

  while (true) {
    let currentFingerprint = '';
    try {
      currentFingerprint = readStateSetFingerprint(sourceDir);
    } catch (error) {
      logger.warning(
        `Failed to read state-set fingerprint: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (once) {
        return;
      }
      await sleep(intervalMs);
      continue;
    }

    const changed = firstIteration || currentFingerprint !== previousFingerprint;
    firstIteration = false;
    previousFingerprint = currentFingerprint;

    if (!changed) {
      if (once) {
        if (options.dryRun) {
          logger.output(formatToolResult('No changes detected.'));
        }
      }
      if (once) {
        return;
      }
      await sleep(intervalMs);
      continue;
    }

    const timestamp = new Date().toISOString();
    if (options.json) {
      logger.output(
        JSON.stringify(
          {
            event: 'watch.change',
            source: sourceDir,
            timestamp,
            changed: true,
          },
          null,
          2,
        ),
      );
    } else {
      logger.output(formatToolResult(`Detected change in ${sourceDir} at ${timestamp}`));
    }

    try {
      await runTopLevelPush([], pushOptions);
    } catch (error) {
      logger.error(`Watch sync failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (once) {
      return;
    }

    await sleep(intervalMs);
  }
}

async function runTopLevelTest(args: string[] = [], options: TopLevelOptions = {}): Promise<void> {
  const logger = buildTopLevelLogger();
  await runTestCommand(args, logger, Boolean(options.json), options.agent);
}

async function runTopLevelWebhooks(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await runWebhooksCommand(args, logger, Boolean(options.json));
}

async function runTopLevelAlerts(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await runAlertsCommand(args, logger, Boolean(options.json));
}

async function runTopLevelMonitor(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await withAgentRunner(async (runner) => {
    await runMonitorCommand(args, logger, Boolean(options.json), runner);
  });
}

function addCommonJsonOption(command: Command, name: string): void {
  command.option('--json', `Output ${name} as JSON`);
}

export function registerShortcutTopLevelCommands(program: Command): void {
  const rules = program
    .command('rules')
    .description('Manage rules with direct MCP shortcuts')
    .argument('[args...]', 'Rules command: get|list|create|toggle|delete|import|export|agent|<id>')
    .action(async (args: string[], opts: { json?: boolean }) => {
      try {
        await runTopLevelRules(args, opts);
      } catch (error) {
        if (error instanceof Error) {
          console.error(formatError(error.message));
          process.exit(1);
        }
        throw error;
      }
    });
  addCommonJsonOption(rules, 'rules');

  const kb = program
    .command('kb')
    .description('Manage knowledge base entries')
    .argument('[args...]', 'KB command: search|add|delete|scroll|list|info')
    .action(async (args: string[], opts: { json?: boolean }) => {
      try {
        await runTopLevelKb(args, opts);
      } catch (error) {
        if (error instanceof Error) {
          console.error(formatError(error.message));
          process.exit(1);
        }
        throw error;
      }
    });
  addCommonJsonOption(kb, 'kb');

  const agents = program
    .command('agents')
    .description('Manage agents')
    .argument('[args...]', 'Agents command: create|get|switch|export|import|bootstrap|<id>')
    .action(async (args: string[], opts: { json?: boolean }) => {
      try {
        await runTopLevelAgents(args, opts);
      } catch (error) {
        if (error instanceof Error) {
          console.error(formatError(error.message));
          process.exit(1);
        }
        throw error;
      }
    });
  addCommonJsonOption(agents, 'agents');

  const channels = program
    .command('channels')
    .description('Manage response channels')
    .argument('[args...]', 'Channel command: list|create|messages|<id>')
    .action(async (args: string[], opts: { json?: boolean }) => {
      try {
        await runTopLevelChannels(args, opts);
      } catch (error) {
        if (error instanceof Error) {
          console.error(formatError(error.message));
          process.exit(1);
        }
        throw error;
      }
    });
  addCommonJsonOption(channels, 'channels');

  const convos = program
    .command('convos')
    .description('Manage conversation views')
    .argument('[args...]', 'Conversations command: get|recent|search|count|export|replay|tag|<id>')
    .action(async (args: string[], opts: { json?: boolean }) => {
      try {
        await runTopLevelConvos(args, opts);
      } catch (error) {
        if (error instanceof Error) {
          console.error(formatError(error.message));
          process.exit(1);
        }
        throw error;
      }
    });
  addCommonJsonOption(convos, 'conversations');

  const conversations = program
    .command('conversations')
    .description('Alias for convos')
    .argument('[args...]', 'Conversations command: get|recent|search|count|export|replay|tag|<id>')
    .option('--json', 'Output as JSON')
    .action(async (args: string[], opts: { json?: boolean }) => {
      try {
        await runTopLevelConvos(args, { json: opts.json });
      } catch (error) {
        if (error instanceof Error) {
          console.error(formatError(error.message));
          process.exit(1);
        }
        throw error;
      }
    });

  const status = program
    .command('status')
    .description('Show quick platform status')
    .option('--json', 'Output counts as JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        await runTopLevelStatus(opts);
      } catch (error) {
        if (error instanceof Error) {
          console.error(formatError(error.message));
          process.exit(1);
        }
        throw error;
      }
    });

  const stats = program
    .command('stats')
    .description('Show analytics summary')
    .argument('[args...]', 'Stats command: summary|agents|conversations|responses')
    .option('--period <duration>', 'Filter window (supports 7d, 30d, 90d, etc.)')
    .option('--since <date>', 'Alias for --from (supports 7d, 2026-01-01, etc.)')
    .option('--from <date>', 'Filter start date (not yet enforced)')
    .option('--to <date>', 'Filter end date (not yet enforced)')
    .option('--json', 'Output as JSON')
    .action(
      async (
        args: string[],
        opts: {
          from?: string;
          since?: string;
          to?: string;
          period?: string;
          json?: boolean;
        },
      ) => {
        const fromFromPeriod = parsePeriodRangeAsIso(opts.period);
        if (opts.period && !fromFromPeriod) {
          console.error(formatError(`Invalid --period value: ${opts.period}`));
          process.exit(1);
        }

        if (opts.from && opts.period) {
          console.error(formatError('Use either --from or --period, not both.'));
          process.exit(1);
        }

        try {
          await runTopLevelStats(args, {
            from: opts.from || fromFromPeriod || opts.since,
            since: opts.since,
            to: opts.to,
            json: opts.json,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exit(1);
          }
          throw error;
        }
      },
    );

  const messages = program
    .command('messages')
    .description('Inspect and manage messages')
    .argument('[args...]', 'Messages command: list|get|search|count|create|delete|annotate|<id>')
    .option('--json', 'Output as JSON')
    .action(async (args: string[], opts: { json?: boolean }) => {
      try {
        await runTopLevelMessages(args, { json: opts.json });
      } catch (error) {
        if (error instanceof Error) {
          console.error(formatError(error.message));
          process.exit(1);
        }
        throw error;
      }
    });

  const responses = program
    .command('responses')
    .description('Inspect and rate responses')
    .argument('[args...]', 'Responses command: list|search|count|get|rate|<id>')
    .option('--json', 'Output as JSON')
    .action(async (args: string[], opts: { json?: boolean }) => {
      try {
        await runTopLevelResponses(args, { json: opts.json });
      } catch (error) {
        if (error instanceof Error) {
          console.error(formatError(error.message));
          process.exit(1);
        }
        throw error;
      }
    });

  const test = program
    .command('test')
    .description('Test an agent-style response without writing to a conversation')
    .argument('[message...]', 'Message to evaluate')
    .option('--agent <agent-id>', 'Target agent ID')
    .option('--json', 'Output as JSON')
    .action(async (message: string[], opts: { agent?: string; json?: boolean }) => {
      try {
        await runTopLevelTest(message, { json: opts.json, agent: opts.agent });
      } catch (error) {
        if (error instanceof Error) {
          console.error(formatError(error.message));
          process.exit(1);
        }
        throw error;
      }
    });

  const analytics = program
    .command('analytics')
    .description('Show platform analytics')
    .argument('[args...]', 'analytics command: summary|agents|conversations|responses [options]')
    .option('--period <duration>', 'Filter window (supports 7d, 30d, 90d, etc.)')
    .option('--since <date>', 'Alias for --from (supports 7d, 2026-01-01, etc.)')
    .option('--from <date>', 'Filter start date (not yet enforced)')
    .option('--to <date>', 'Filter end date (not yet enforced)')
    .option('--json', 'Output as JSON')
    .action(
      async (
        args: string[],
        opts: {
          from?: string;
          since?: string;
          to?: string;
          period?: string;
          json?: boolean;
        },
      ) => {
        try {
          const tokens = [...args];
          const fromFromPeriod = parsePeriodRangeAsIso(opts.period);
          if (opts.period && !fromFromPeriod) {
            console.error(formatError(`Invalid --period value: ${opts.period}`));
            process.exit(1);
          }
          if (opts.from && opts.period) {
            console.error(formatError('Use either --from or --period, not both.'));
            process.exit(1);
          }
          const from = opts.from || fromFromPeriod || opts.since;
          if (from) {
            tokens.push('--from', from);
          }
          if (opts.to) {
            tokens.push('--to', opts.to);
          }
          await runTopLevelAnalytics(tokens, {
            json: opts.json,
            from,
            to: opts.to,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exit(1);
          }
          throw error;
        }
      },
    );

  const diff = program
    .command('diff')
    .description('Show configuration diff between snapshots')
    .argument('[refs...]', 'Diff refs: [from] [to]')
    .option('--from <snapshot>', 'Source snapshot')
    .option('--to <snapshot>', 'Target snapshot')
    .option('--json', 'Output diff as JSON')
    .option('--include-secrets', 'Include secrets when exporting current snapshot')
    .action(
      async (
        args: string[],
        opts: { from?: string; to?: string; json?: boolean; includeSecrets?: boolean },
      ) => {
        try {
          await runTopLevelDiff(args, {
            json: opts.json,
            from: opts.from,
            to: opts.to,
            includeSecrets: opts.includeSecrets,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exit(1);
          }
          throw error;
        }
      },
    );

  const webhooks = program
    .command('webhooks')
    .description('Manage webhook subscriptions')
    .argument('[args...]', 'Webhook command: list|create|test|logs|delete')
    .option('--json', 'Output as JSON')
    .action(async (args: string[], opts: { json?: boolean }) => {
      try {
        await runTopLevelWebhooks(args, { json: opts.json });
      } catch (error) {
        if (error instanceof Error) {
          console.error(formatError(error.message));
          process.exit(1);
        }
        throw error;
      }
    });

  const alerts = program
    .command('alerts')
    .description('Manage alert rules')
    .argument('[args...]', 'Alert command: list|create|delete')
    .option('--json', 'Output as JSON')
    .action(async (args: string[], opts: { json?: boolean }) => {
      try {
        await runTopLevelAlerts(args, { json: opts.json });
      } catch (error) {
        if (error instanceof Error) {
          console.error(formatError(error.message));
          process.exit(1);
        }
        throw error;
      }
    });

  const monitor = program
    .command('monitor')
    .description('Watch live platform state')
    .argument('[args...]', 'Monitor command: status|live')
    .option('--agent <agent-id>', 'Filter by agent ID')
    .option('--interval <seconds>', 'Polling interval for live mode')
    .option('--count <n>', 'Number of live snapshots to emit')
    .option('--json', 'Output as JSON')
    .action(
      async (
        args: string[],
        opts: { agent?: string; interval?: string; count?: string; json?: boolean },
      ) => {
        try {
          const forwarded = [...args];
          if (opts.agent) {
            forwarded.push('--agent', opts.agent);
          }
          if (opts.interval) {
            forwarded.push('--interval', opts.interval);
          }
          if (opts.count) {
            forwarded.push('--count', opts.count);
          }
          if (opts.json) {
            forwarded.push('--json');
          }
          await runTopLevelMonitor(forwarded, {
            json: opts.json,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exit(1);
          }
          throw error;
        }
      },
    );

  const deploy = program
    .command('deploy')
    .description('Push snapshot-backed config changes')
    .argument('[from]', 'Source snapshot file or alias')
    .option('--from <snapshot>', 'Source snapshot file or alias')
    .option('--approve <deployment-id>', 'Approve a scheduled deployment')
    .option('--schedule <datetime>', 'Schedule deployment execution')
    .option('--dry-run', 'Show changes only')
    .option('--yes', 'Apply changes without prompting')
    .option('--strict', 'Fail fast if any import item fails')
    .option('--include-secrets', 'Include secrets when exporting current snapshot')
    .action(
      async (
        source: string | undefined,
        opts: {
          from?: string;
          approve?: string;
          schedule?: string;
          dryRun?: boolean;
          yes?: boolean;
          strict?: boolean;
          includeSecrets?: boolean;
        },
      ) => {
        try {
          const sourceRef = opts.from || source;
          await runTopLevelDeploy(sourceRef ? [sourceRef] : [], {
            from: sourceRef,
            dryRun: opts.dryRun,
            yes: opts.yes,
            strict: opts.strict,
            includeSecrets: opts.includeSecrets,
            schedule: opts.schedule,
            approve: opts.approve,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exit(1);
          }
          throw error;
        }
      },
    );

  const rollback = program
    .command('rollback')
    .description('Rollback config changes from snapshot')
    .argument('[from]', 'Source snapshot file or alias')
    .option('--from <snapshot>', 'Source snapshot file or alias')
    .option('--approve <deployment-id>', 'Approve a scheduled rollback')
    .option('--schedule <datetime>', 'Schedule rollback execution')
    .option('--dry-run', 'Show changes only')
    .option('--yes', 'Apply changes without prompting')
    .option('--strict', 'Fail fast if any import item fails')
    .option('--include-secrets', 'Include secrets when exporting current snapshot')
    .action(
      async (
        source: string | undefined,
        opts: {
          from?: string;
          approve?: string;
          schedule?: string;
          dryRun?: boolean;
          yes?: boolean;
          strict?: boolean;
          includeSecrets?: boolean;
        },
      ) => {
        try {
          const sourceRef = opts.from || source;
          await runTopLevelRollback(sourceRef ? [sourceRef] : [], {
            from: sourceRef,
            dryRun: opts.dryRun,
            yes: opts.yes,
            strict: opts.strict,
            includeSecrets: opts.includeSecrets,
            schedule: opts.schedule,
            approve: opts.approve,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exit(1);
          }
          throw error;
        }
      },
    );

  const deployments = program
    .command('deployments')
    .description('Inspect deployment history')
    .argument('[args...]', 'Deployment command: list|get|status|cancel|delete|<id>')
    .option('--mode <mode>', 'Filter by mode (deploy|rollback)')
    .option('--status <status>', 'Filter by status (scheduled|approved|applied|failed|cancelled)')
    .option('--limit <n>', 'Max rows for list view')
    .option('--json', 'Output as JSON')
    .action(
      async (
        args: string[],
        opts: {
          mode?: string;
          status?: string;
          limit?: string;
          json?: boolean;
        },
      ) => {
        try {
          const parsedLimit = opts.limit ? parsePositiveIntegerOption(opts.limit) : undefined;
          if (opts.limit && parsedLimit === undefined) {
            console.error(formatError('Invalid --limit value. Expected a positive integer.'));
            process.exit(1);
          }
          await runTopLevelDeployments(args, {
            json: opts.json,
            mode: opts.mode,
            status: opts.status,
            limit: parsedLimit,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exit(1);
          }
          throw error;
        }
      },
    );

  const snapshot = program
    .command('snapshot')
    .description('Manage local snapshots')
    .argument('[args...]', 'snapshot command: list|create <name>|show <ref>')
    .option('--out <path>', 'Output path for create')
    .option('--json', 'Output as JSON')
    .option('--include-secrets', 'Include secrets in snapshot export')
    .action(
      async (args: string[], opts: { out?: string; json?: boolean; includeSecrets?: boolean }) => {
        try {
          await runTopLevelSnapshot(args, {
            out: opts.out,
            json: opts.json,
            includeSecrets: opts.includeSecrets,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exit(1);
          }
          throw error;
        }
      },
    );

  const pull = program
    .command('pull')
    .description('Pull organization config into a state-set directory')
    .argument('[dir]', 'Target directory (default .stateset)')
    .option('--json', 'Output as JSON')
    .option('--include-secrets', 'Include secrets in export')
    .action(
      async (dirArg: string | undefined, opts: { json?: boolean; includeSecrets?: boolean }) => {
        try {
          await runTopLevelPull(dirArg ? [dirArg] : [], {
            out: dirArg,
            json: opts.json,
            includeSecrets: opts.includeSecrets,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exit(1);
          }
          throw error;
        }
      },
    );

  const push = program
    .command('push')
    .description('Push state-set config into the active organization')
    .argument('[source]', 'Source file or directory (default .stateset)')
    .option('--from <source>', 'Source file or directory')
    .option('--dry-run', 'Preview import without applying')
    .option('--yes', 'Apply changes without prompting')
    .option('--strict', 'Fail fast if any import item fails')
    .action(
      async (
        sourceArg: string | undefined,
        opts: {
          from?: string;
          dryRun?: boolean;
          yes?: boolean;
          strict?: boolean;
        },
      ) => {
        try {
          const sourceRef = opts.from || sourceArg;
          await runTopLevelPush(sourceRef ? [sourceRef] : [], {
            from: sourceRef,
            dryRun: opts.dryRun,
            yes: opts.yes,
            strict: opts.strict,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exit(1);
          }
          throw error;
        }
      },
    );

  const validate = program
    .command('validate')
    .description('Validate a local state-set file or directory')
    .argument('[source]', 'Source file or directory (default .stateset)')
    .option('--from <source>', 'Source file or directory')
    .option('--strict', 'Fail on missing files or warnings')
    .option('--json', 'Output validation report as JSON')
    .action(
      async (
        sourceArg: string | undefined,
        opts: { from?: string; strict?: boolean; json?: boolean },
      ) => {
        try {
          const sourceRef = opts.from || sourceArg;
          await runTopLevelValidate(sourceRef ? [sourceRef] : [], {
            from: sourceRef,
            strict: opts.strict,
            json: opts.json,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exit(1);
          }
          throw error;
        }
      },
    );

  const watch = program
    .command('watch')
    .description('Watch a state-set directory and push changes automatically')
    .argument('[source]', 'Source state-set directory (default .stateset)')
    .option('--from <source>', 'Source state-set directory')
    .option('--interval <seconds>', 'Polling interval in seconds')
    .option('--once', 'Run a single sync and exit')
    .option('--dry-run', 'Preview sync operations without applying')
    .option('--strict', 'Fail fast if any import item fails')
    .option('--include-secrets', 'Include secrets in validation/export')
    .option('--json', 'Output watch events as JSON')
    .action(
      async (
        sourceArg: string | undefined,
        opts: {
          from?: string;
          interval?: string;
          once?: boolean;
          dryRun?: boolean;
          strict?: boolean;
          includeSecrets?: boolean;
          json?: boolean;
        },
      ) => {
        try {
          const sourceRef = opts.from || sourceArg;
          await runTopLevelWatch(sourceRef ? [sourceRef] : [], {
            from: sourceRef,
            interval: opts.interval,
            once: opts.once,
            dryRun: opts.dryRun,
            strict: opts.strict,
            includeSecrets: opts.includeSecrets,
            json: opts.json,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exit(1);
          }
          throw error;
        }
      },
    );

  const bulk = program
    .command('bulk')
    .description('Perform bulk import/export workflows')
    .argument('[args...]', 'bulk command: export [path] | import <file|directory>')
    .option('--out <path>', 'Output path for bulk export')
    .option('--json', 'Output as JSON')
    .option('--dry-run', 'Validate import without applying')
    .option('--yes', 'Apply import without prompting')
    .option('--strict', 'Fail fast if any import item fails')
    .option('--include-secrets', 'Include secrets when exporting')
    .action(
      async (
        args: string[],
        opts: {
          out?: string;
          json?: boolean;
          dryRun?: boolean;
          yes?: boolean;
          strict?: boolean;
          includeSecrets?: boolean;
        },
      ) => {
        try {
          await runTopLevelBulk(args, {
            out: opts.out,
            json: opts.json,
            dryRun: opts.dryRun,
            yes: opts.yes,
            strict: opts.strict,
            includeSecrets: opts.includeSecrets,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exit(1);
          }
          throw error;
        }
      },
    );

  const backup = program
    .command('backup')
    .description('Create a full organization backup')
    .argument('[out]', 'Backup destination path')
    .option('--out <path>', 'Alias for positional output path')
    .option('--include-secrets', 'Include secrets in backup')
    .action(
      async (
        outArg: string | undefined,
        opts: { out?: string; includeSecrets?: boolean; json?: boolean },
      ) => {
        try {
          const outputPath = outArg || opts.out;
          await runTopLevelBulk(['export', outputPath || ''], {
            out: outputPath,
            includeSecrets: opts.includeSecrets,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exit(1);
          }
          throw error;
        }
      },
    );

  const restore = program
    .command('restore')
    .description('Restore from organization backup')
    .argument('<source>', 'Backup source file or directory')
    .option('--json', 'Output as JSON')
    .option('--dry-run', 'Validate import without applying')
    .option('--yes', 'Apply import without prompting')
    .option('--strict', 'Fail fast if any import item fails')
    .option('--include-secrets', 'Include secrets when importing')
    .action(
      async (
        source: string,
        opts: {
          json?: boolean;
          dryRun?: boolean;
          yes?: boolean;
          strict?: boolean;
          includeSecrets?: boolean;
        },
      ) => {
        try {
          await runTopLevelBulk(['import', source], {
            out: undefined,
            dryRun: opts.dryRun,
            yes: opts.yes,
            strict: opts.strict,
            includeSecrets: opts.includeSecrets,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exit(1);
          }
          throw error;
        }
      },
    );
}
