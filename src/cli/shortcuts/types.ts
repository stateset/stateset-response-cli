import path from 'node:path';
import type { ToolCallPayload } from '../../agent.js';
import type { OrgExport } from '../../export-import.js';

export type AnyPayload =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null
  | undefined;

export interface ShortcutLogger {
  success: (message: string) => void;
  warning: (message: string) => void;
  error: (message: string) => void;
  output: (text: string) => void;
  done: () => void;
}

export interface ShortcutRunner {
  callTool: <T = AnyPayload>(
    toolName: string,
    args?: Record<string, unknown>,
  ) => Promise<ToolCallPayload<T>>;
}

export type TopLevelOptions = {
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

export type WatchOptions = TopLevelOptions & {
  interval?: string;
  once?: boolean;
};

export type DeploymentCommandOptions = {
  json?: boolean;
  mode?: string;
  status?: string;
  limit?: number | string;
};

export type SnapshotDiffRow = {
  collection: string;
  from: number;
  to: number;
  added: number;
  removed: number;
  changed: number;
};

export type AnalyticsRows = {
  metric: string;
  value: string;
};

export interface DiffSummary {
  from: string;
  to: string;
  rows: SnapshotDiffRow[];
}

export type ParsedDateRange = {
  from?: number;
  to?: number;
  warnings: string[];
};

export interface SnapshotInfo {
  id: string;
  file: string;
  path: string;
  size: number;
  modifiedAt: number;
}

export type MonitorSnapshot = {
  generatedAt: string;
  scope: string;
  metrics: Array<{ metric: string; value: string }>;
  recentChannels: Array<Record<string, string>>;
  recentWebhookLogs: Array<Record<string, string>>;
};

export interface SnapshotReadResult {
  payload: OrgExport;
  source: string;
  cleanup?: () => void;
}

export interface SnapshotPathResult {
  path: string;
  source: string;
  cleanup?: () => void;
}

export interface StateSetBundleManifest {
  version?: string;
  orgId?: string;
  exportedAt?: string;
}

export const STATESET_RESOURCE_MAP = [
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

export type StateSetResourceField = (typeof STATESET_RESOURCE_MAP)[number][0];

export const DEFAULT_STATESET_DIR = path.resolve(process.cwd(), '.stateset');
export const DEFAULT_STATESET_BUNDLE_FILE = 'snapshot.json';
export const DEFAULT_STATESET_CONFIG_FILE = 'config.json';
export const DEFAULT_STATESET_DIR_OPTIONS = [
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

export const DEFAULT_LIST_LIMIT = 50;
export const DEFAULT_LIST_OFFSET = 0;
export const DEFAULT_SNAPSHOT_DIR = path.resolve(process.cwd(), '.stateset', 'snapshots');
export const DEFAULT_SNAPSHOT_PREFIX = 'snapshot';
export const SNAPSHOT_RESOURCE_FIELDS = [
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
