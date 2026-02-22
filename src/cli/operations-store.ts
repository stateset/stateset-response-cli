import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getStateSetDir } from '../session.js';
import { readJsonFile } from '../utils/file-read.js';
import { getErrorMessage } from '../lib/errors.js';

const STORE_VERSION = 1;
const STORE_NAME = 'platform-operations.json';
const MAX_WEBHOOK_LOGS = 500;
const MAX_DEPLOYMENTS = 200;

export interface PlatformWebhook {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformWebhookLog {
  id: string;
  webhookId: string;
  event: string;
  status: 'ok' | 'error';
  statusMessage?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface PlatformAlert {
  id: string;
  metric: string;
  threshold: number;
  channel?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type DeploymentMode = 'deploy' | 'rollback';

export type DeploymentStatus = 'scheduled' | 'approved' | 'applied' | 'failed' | 'cancelled';

export interface PlatformDeployment {
  id: string;
  mode: DeploymentMode;
  source: string;
  status: DeploymentStatus;
  scheduledFor?: string;
  approvedAt?: string;
  appliedAt?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  dryRun?: boolean;
  strict?: boolean;
  includeSecrets?: boolean;
  yes?: boolean;
}

export interface PlatformOperationsStore {
  version: number;
  webhooks: PlatformWebhook[];
  webhookLogs: PlatformWebhookLog[];
  alerts: PlatformAlert[];
  deployments: PlatformDeployment[];
}

interface RawOperationsStore {
  version?: number;
  webhooks?: unknown;
  webhookLogs?: unknown;
  alerts?: unknown;
  deployments?: unknown;
}

function resolveStorePath(): string {
  return path.join(getStateSetDir(), STORE_NAME);
}

function normalizeWebhook(raw: unknown): PlatformWebhook | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) return null;
  if (typeof candidate.url !== 'string' || !candidate.url.trim()) return null;
  if (!Array.isArray(candidate.events)) return null;
  if (!candidate.events.every((value) => typeof value === 'string')) return null;
  const events = candidate.events
    .map((entry) => String(entry).trim().toLowerCase())
    .filter(Boolean);

  const enabled = Boolean(candidate.enabled);
  const createdAt = normalizeDate(candidate.createdAt) || new Date().toISOString();
  const updatedAt = normalizeDate(candidate.updatedAt) || new Date().toISOString();

  return {
    id: candidate.id.trim(),
    url: candidate.url.trim(),
    events,
    enabled,
    createdAt,
    updatedAt,
  };
}

function normalizeLog(raw: unknown): PlatformWebhookLog | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) return null;
  if (typeof candidate.webhookId !== 'string' || !candidate.webhookId.trim()) return null;
  if (typeof candidate.event !== 'string' || !candidate.event.trim()) return null;
  const status = candidate.status === 'error' ? 'error' : 'ok';
  const createdAt = normalizeDate(candidate.createdAt) || new Date().toISOString();

  const payload =
    candidate.payload && typeof candidate.payload === 'object'
      ? (candidate.payload as Record<string, unknown>)
      : undefined;

  return {
    id: candidate.id.trim(),
    webhookId: candidate.webhookId.trim(),
    event: candidate.event.trim(),
    status,
    statusMessage:
      typeof candidate.statusMessage === 'string' ? candidate.statusMessage : undefined,
    payload,
    createdAt,
  };
}

function normalizeAlert(raw: unknown): PlatformAlert | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) return null;
  if (typeof candidate.metric !== 'string' || !candidate.metric.trim()) return null;

  const threshold =
    typeof candidate.threshold === 'number' && Number.isFinite(candidate.threshold)
      ? candidate.threshold
      : Number.parseFloat(String(candidate.threshold));
  if (!Number.isFinite(threshold)) return null;

  const createdAt = normalizeDate(candidate.createdAt) || new Date().toISOString();
  const updatedAt = normalizeDate(candidate.updatedAt) || new Date().toISOString();

  return {
    id: candidate.id.trim(),
    metric: candidate.metric.trim(),
    threshold,
    channel:
      typeof candidate.channel === 'string' && candidate.channel.trim()
        ? candidate.channel.trim()
        : undefined,
    enabled: candidate.enabled === undefined ? true : Boolean(candidate.enabled),
    createdAt,
    updatedAt,
  };
}

function normalizeDeployment(raw: unknown): PlatformDeployment | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) return null;
  if (candidate.mode !== 'deploy' && candidate.mode !== 'rollback') return null;
  if (typeof candidate.source !== 'string' || !candidate.source.trim()) return null;

  const status =
    candidate.status === 'approved'
      ? ('approved' as const)
      : candidate.status === 'applied'
        ? ('applied' as const)
        : candidate.status === 'failed'
          ? ('failed' as const)
          : candidate.status === 'cancelled'
            ? ('cancelled' as const)
            : ('scheduled' as const);

  const createdAt = normalizeDate(candidate.createdAt) || new Date().toISOString();
  const updatedAt = normalizeDate(candidate.updatedAt) || createdAt;

  return {
    id: candidate.id.trim(),
    mode: candidate.mode,
    source: candidate.source.trim(),
    status,
    scheduledFor:
      typeof candidate.scheduledFor === 'string' && candidate.scheduledFor.trim()
        ? normalizeDate(candidate.scheduledFor) || undefined
        : undefined,
    approvedAt:
      typeof candidate.approvedAt === 'string' && candidate.approvedAt.trim()
        ? normalizeDate(candidate.approvedAt) || undefined
        : undefined,
    appliedAt:
      typeof candidate.appliedAt === 'string' && candidate.appliedAt.trim()
        ? normalizeDate(candidate.appliedAt) || undefined
        : undefined,
    createdAt,
    updatedAt,
    error: typeof candidate.error === 'string' ? candidate.error : undefined,
    dryRun: candidate.dryRun === true ? true : candidate.dryRun === false ? false : undefined,
    strict: candidate.strict === true ? true : candidate.strict === false ? false : undefined,
    includeSecrets:
      candidate.includeSecrets === true
        ? true
        : candidate.includeSecrets === false
          ? false
          : undefined,
    yes: candidate.yes === true ? true : candidate.yes === false ? false : undefined,
  };
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function loadRawStore(pathName: string): RawOperationsStore | null {
  if (!fs.existsSync(pathName)) return null;
  try {
    const raw = readJsonFile(pathName, {
      label: 'platform operations store',
      expectObject: true,
    }) as RawOperationsStore;
    return raw || null;
  } catch {
    return null;
  }
}

function sortByUpdatedDesc<T extends { updatedAt: string }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

function pruneLogRows(
  logs: PlatformWebhookLog[],
  keepLatest = MAX_WEBHOOK_LOGS,
): PlatformWebhookLog[] {
  const sorted = [...logs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return sorted.slice(0, keepLatest);
}

function readStore(pathName: string): PlatformOperationsStore {
  const fallback: PlatformOperationsStore = {
    version: STORE_VERSION,
    webhooks: [],
    webhookLogs: [],
    alerts: [],
    deployments: [],
  };

  const raw = loadRawStore(pathName);
  if (!raw || typeof raw !== 'object') {
    return fallback;
  }

  const webhooks = Array.isArray(raw.webhooks)
    ? (raw.webhooks.map(normalizeWebhook).filter(Boolean) as PlatformWebhook[])
    : [];
  const webhookLogs = Array.isArray(raw.webhookLogs)
    ? (raw.webhookLogs.map(normalizeLog).filter(Boolean) as PlatformWebhookLog[])
    : [];
  const alerts = Array.isArray(raw.alerts)
    ? (raw.alerts.map(normalizeAlert).filter(Boolean) as PlatformAlert[])
    : [];
  const deployments = Array.isArray(raw.deployments)
    ? (raw.deployments.map(normalizeDeployment).filter(Boolean) as PlatformDeployment[])
    : [];

  return {
    version:
      typeof raw.version === 'number' && Number.isFinite(raw.version) ? raw.version : STORE_VERSION,
    webhooks: sortByUpdatedDesc(webhooks),
    webhookLogs: pruneLogRows(webhookLogs),
    alerts: sortByUpdatedDesc(alerts),
    deployments: sortByUpdatedDesc(deployments),
  };
}

function writeStore(pathName: string, store: PlatformOperationsStore): void {
  try {
    const parent = path.dirname(pathName);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(pathName, JSON.stringify(store, null, 2), 'utf-8');
  } catch (error) {
    throw new Error(`Unable to persist platform operations state: ${getErrorMessage(error)}`);
  }
}

function generateId(prefix: string): string {
  return `${prefix}-${randomUUID ? randomUUID().slice(0, 8) : `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`}`;
}

function findWebhookMatch(store: PlatformOperationsStore, reference?: string): PlatformWebhook {
  if (!reference) {
    throw new Error('Webhook reference is required.');
  }

  const target = reference.toLowerCase().trim();
  const exact = store.webhooks.find(
    (candidate) => candidate.id.toLowerCase() === target || candidate.url.toLowerCase() === target,
  );
  if (exact) {
    return exact;
  }

  const matches = store.webhooks.filter(
    (candidate) =>
      candidate.id.toLowerCase().includes(target) || candidate.url.toLowerCase().includes(target),
  );

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length === 0) {
    throw new Error(`Webhook not found: ${reference}`);
  }

  throw new Error(`Webhook reference is ambiguous: ${reference}`);
}

function findAlertMatch(store: PlatformOperationsStore, reference?: string): PlatformAlert {
  if (!reference) {
    throw new Error('Alert reference is required.');
  }

  const target = reference.toLowerCase().trim();
  const exact = store.alerts.find((candidate) => candidate.id.toLowerCase() === target);
  if (exact) {
    return exact;
  }

  const matches = store.alerts.filter((candidate) => candidate.id.toLowerCase().includes(target));
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length === 0) {
    throw new Error(`Alert not found: ${reference}`);
  }
  throw new Error(`Alert reference is ambiguous: ${reference}`);
}

function findDeploymentMatch(
  store: PlatformOperationsStore,
  reference?: string,
): PlatformDeployment {
  if (!reference) {
    throw new Error('Deployment reference is required.');
  }

  const target = reference.toLowerCase().trim();
  const exact = store.deployments.find((candidate) => candidate.id.toLowerCase() === target);
  if (exact) {
    return exact;
  }

  const matches = store.deployments.filter(
    (candidate) =>
      candidate.id.toLowerCase().includes(target) ||
      candidate.source.toLowerCase().includes(target),
  );

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length === 0) {
    throw new Error(`Deployment not found: ${reference}`);
  }
  throw new Error(`Deployment reference is ambiguous: ${reference}`);
}

function normalizeEventList(raw: string | undefined): string[] {
  return (raw || '')
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function loadOperationsStore(): PlatformOperationsStore {
  return readStore(resolveStorePath());
}

export function listWebhooks(reference?: string): PlatformWebhook[] {
  const store = loadOperationsStore();
  if (!reference) return store.webhooks;
  const target = reference.toLowerCase();
  return store.webhooks.filter(
    (candidate) =>
      candidate.id.toLowerCase().includes(target) || candidate.url.toLowerCase().includes(target),
  );
}

export function createWebhook(input: {
  url: string;
  events?: string;
  enabled?: boolean;
}): PlatformWebhook {
  const url = input.url.trim();
  if (!url) {
    throw new Error('Webhook URL is required.');
  }
  const events = normalizeEventList(input.events);
  if (events.length === 0) {
    throw new Error('At least one event is required.');
  }

  const storePath = resolveStorePath();
  const store = readStore(storePath);

  const record: PlatformWebhook = {
    id: generateId('webhook'),
    url,
    events,
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  store.webhooks.unshift(record);
  store.webhooks = store.webhooks.filter((item, index) => index < 500);
  writeStore(storePath, {
    ...store,
    webhooks: sortByUpdatedDesc(store.webhooks),
  });

  return record;
}

export function deleteWebhook(reference: string): PlatformWebhook {
  const storePath = resolveStorePath();
  const store = readStore(storePath);
  const target = findWebhookMatch(store, reference);
  store.webhooks = store.webhooks.filter((entry) => entry.id !== target.id);
  store.webhookLogs = store.webhookLogs.filter((entry) => entry.webhookId !== target.id);
  writeStore(storePath, store);
  return target;
}

export function getWebhook(reference: string): PlatformWebhook {
  return findWebhookMatch(loadOperationsStore(), reference);
}

export function pushWebhookLog(input: {
  webhookId: string;
  event: string;
  status?: 'ok' | 'error';
  statusMessage?: string;
  payload?: Record<string, unknown>;
}): PlatformWebhookLog {
  const storePath = resolveStorePath();
  const store = readStore(storePath);
  findWebhookMatch(store, input.webhookId);

  const record: PlatformWebhookLog = {
    id: generateId('whlog'),
    webhookId: input.webhookId,
    event: input.event,
    status: input.status ?? 'ok',
    statusMessage: input.statusMessage,
    payload: input.payload,
    createdAt: new Date().toISOString(),
  };

  store.webhookLogs.unshift(record);
  store.webhookLogs = pruneLogRows(store.webhookLogs, MAX_WEBHOOK_LOGS);
  writeStore(storePath, store);
  return record;
}

export function listWebhookLogs(reference?: string, limit = 20): PlatformWebhookLog[] {
  const normalized = Number.isFinite(limit) ? Math.max(1, Math.min(limit, MAX_WEBHOOK_LOGS)) : 20;
  const store = loadOperationsStore();
  const rows = reference
    ? store.webhookLogs.filter((entry) =>
        entry.webhookId.toLowerCase().includes(reference.toLowerCase()),
      )
    : store.webhookLogs;
  return rows.slice(0, normalized);
}

export function listAlerts(reference?: string): PlatformAlert[] {
  const store = loadOperationsStore();
  if (!reference) return store.alerts;
  const target = reference.toLowerCase();
  return store.alerts.filter((entry) => entry.id.toLowerCase().includes(target));
}

export function listDeployments(reference?: string): PlatformDeployment[] {
  const store = loadOperationsStore();
  if (!reference) return store.deployments;
  const target = reference.toLowerCase();
  return store.deployments.filter(
    (entry) =>
      entry.id.toLowerCase().includes(target) || entry.source.toLowerCase().includes(target),
  );
}

export function createAlert(input: {
  metric: string;
  threshold: number;
  channel?: string;
  enabled?: boolean;
}): PlatformAlert {
  const metric = (input.metric || '').trim();
  if (!metric) {
    throw new Error('Alert metric is required.');
  }

  const threshold = input.threshold;
  if (!Number.isFinite(threshold)) {
    throw new Error('Alert threshold must be a finite number.');
  }

  const storePath = resolveStorePath();
  const store = readStore(storePath);
  const record: PlatformAlert = {
    id: generateId('alert'),
    metric,
    threshold,
    channel: input.channel?.trim() || undefined,
    enabled: input.enabled !== false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  store.alerts.unshift(record);
  store.alerts = sortByUpdatedDesc(store.alerts).filter((item, index) => index < 500);
  writeStore(storePath, {
    ...store,
    alerts: store.alerts,
  });

  return record;
}

export function createDeployment(input: {
  mode: DeploymentMode;
  source: string;
  scheduledFor?: string;
  dryRun?: boolean;
  strict?: boolean;
  includeSecrets?: boolean;
  yes?: boolean;
}): PlatformDeployment {
  const source = input.source.trim();
  if (!source) {
    throw new Error('Deployment source is required.');
  }

  const now = new Date().toISOString();
  const idPrefix = input.mode === 'rollback' ? 'rollback' : 'deploy';
  const record: PlatformDeployment = {
    id: generateId(idPrefix),
    mode: input.mode,
    source,
    status: 'scheduled',
    scheduledFor: input.scheduledFor,
    createdAt: now,
    updatedAt: now,
    dryRun: input.dryRun,
    strict: input.strict,
    includeSecrets: input.includeSecrets,
    yes: input.yes,
  };

  const storePath = resolveStorePath();
  const store = readStore(storePath);
  store.deployments.unshift(record);
  store.deployments = sortByUpdatedDesc(store.deployments).filter(
    (item, index) => index < MAX_DEPLOYMENTS,
  );
  writeStore(storePath, {
    ...store,
    deployments: store.deployments,
  });

  return record;
}

export function getDeployment(reference: string): PlatformDeployment {
  return findDeploymentMatch(loadOperationsStore(), reference);
}

export function updateDeployment(
  reference: string,
  patch: Partial<{
    status: DeploymentStatus;
    source: string;
    scheduledFor: string;
    approvedAt: string;
    appliedAt: string;
    error: string;
    dryRun: boolean;
    strict: boolean;
    includeSecrets: boolean;
    yes: boolean;
  }>,
): PlatformDeployment {
  const storePath = resolveStorePath();
  const store = readStore(storePath);
  const target = findDeploymentMatch(store, reference);
  if (patch.source !== undefined && patch.source.trim()) {
    target.source = patch.source.trim();
  }
  if (patch.scheduledFor !== undefined) {
    target.scheduledFor = patch.scheduledFor || undefined;
  }
  if (patch.status !== undefined) {
    target.status = patch.status;
  }
  if (patch.error !== undefined) {
    target.error = patch.error || undefined;
  }
  if (patch.approvedAt !== undefined) {
    target.approvedAt = patch.approvedAt || undefined;
  }
  if (patch.appliedAt !== undefined) {
    target.appliedAt = patch.appliedAt || undefined;
  }
  if (patch.dryRun !== undefined) {
    target.dryRun = patch.dryRun;
  }
  if (patch.strict !== undefined) {
    target.strict = patch.strict;
  }
  if (patch.includeSecrets !== undefined) {
    target.includeSecrets = patch.includeSecrets;
  }
  if (patch.yes !== undefined) {
    target.yes = patch.yes;
  }

  target.updatedAt = new Date().toISOString();
  writeStore(storePath, store);
  return target;
}

export function deleteDeployment(reference: string): PlatformDeployment {
  const storePath = resolveStorePath();
  const store = readStore(storePath);
  const target = findDeploymentMatch(store, reference);
  store.deployments = store.deployments.filter((entry) => entry.id !== target.id);
  writeStore(storePath, store);
  return target;
}

export function deleteAlert(reference: string): PlatformAlert {
  const storePath = resolveStorePath();
  const store = readStore(storePath);
  const target = findAlertMatch(store, reference);
  store.alerts = store.alerts.filter((entry) => entry.id !== target.id);
  writeStore(storePath, store);
  return target;
}
