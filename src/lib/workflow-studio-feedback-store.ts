import path from 'node:path';

import type { GorgiasConfig, ZendeskConfig } from '../integrations/config.js';
import { getGorgiasConfigFromEnv, getZendeskConfigFromEnv } from '../integrations/config.js';
import { createGorgiasApi, type GorgiasApi } from '../integrations/gorgias.js';
import { zendeskRequest, type ZendeskRequestOptions } from '../integrations/zendesk.js';
import { readJsonFile } from '../utils/file-read.js';
import { ensurePrivateDirectory, writePrivateTextFileSecure } from '../utils/secure-file.js';
import { brandStudioExists, loadBrandStudioBundle } from './brand-studio.js';

const STORE_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_MAX_PAGES = 5;
const DEFAULT_ZENDESK_INITIAL_SYNC_DAYS = 30;

export type WorkflowStudioFeedbackSource = 'gorgias' | 'zendesk';

export interface WorkflowStudioFeedbackStoreTicket {
  ticketId: string;
  brand: string;
  tags: string[];
  channel: string;
  aiIntent: string;
  issueType: string;
  agentMessages: number;
  customerMessages: number;
  updatedAt: string;
  source: WorkflowStudioFeedbackSource;
  subject: string;
  status: string;
  rating: string;
}

export interface WorkflowStudioFeedbackStoreResponse {
  messageId: string;
  ticketId: string;
  handledBy: string;
  rating: string;
  customerMessage: string;
  response: string;
  createdAt: string;
  source: WorkflowStudioFeedbackSource;
}

export interface WorkflowStudioFeedbackStoreState {
  source: WorkflowStudioFeedbackSource;
  lastSyncedAt: string | null;
  newestTicketUpdatedAt: string | null;
  newestTicketIds: string[];
  providerCursor?: string | null;
}

export interface WorkflowStudioFeedbackStorePaths {
  dir: string;
  tickets: string;
  responses: string;
  state: string;
}

export interface WorkflowStudioFeedbackStore {
  brandSlug: string;
  paths: WorkflowStudioFeedbackStorePaths;
  tickets: WorkflowStudioFeedbackStoreTicket[];
  responses: WorkflowStudioFeedbackStoreResponse[];
  state: WorkflowStudioFeedbackStoreState;
}

export interface WorkflowStudioFeedbackSyncOptions {
  brandRef: string;
  cwd?: string;
  provider?: WorkflowStudioFeedbackSource;
  pageLimit?: number;
  maxPages?: number;
  sinceDays?: number;
  gorgiasConfig?: GorgiasConfig | null;
  api?: GorgiasApi;
  zendeskConfig?: ZendeskConfig | null;
  zendeskRequest?: (options: ZendeskRequestOptions) => Promise<{ status: number; data: unknown }>;
}

export interface WorkflowStudioFeedbackSyncResult {
  brandSlug: string;
  provider: WorkflowStudioFeedbackSource;
  storeDir: string;
  syncedAt: string;
  ticketsScanned: number;
  ticketsUpserted: number;
  responsesUpserted: number;
  pagesFetched: number;
  newestTicketUpdatedAt: string | null;
}

interface RawGorgiasTicket {
  id?: number | string;
  subject?: string;
  status?: string;
  channel?: string;
  updated_datetime?: string;
  created_datetime?: string;
  tags?: Array<{ name?: string } | string>;
  customer?: { email?: string };
  satisfaction_survey?: { score?: number | string; rating?: string };
  survey_score?: number | string;
  rating?: string;
}

interface RawGorgiasMessage {
  id?: number | string;
  sender?: { email?: string };
  body_text?: string;
  created_datetime?: string;
  internal?: boolean;
  from_agent?: boolean;
}

interface RawZendeskTicketField {
  id?: number | string;
  title?: string;
  raw_title?: string;
  key?: string;
}

interface RawZendeskCustomFieldValue {
  id?: number | string;
  value?: unknown;
}

interface RawZendeskTicket {
  id?: number | string;
  subject?: string;
  status?: string;
  updated_at?: string;
  created_at?: string;
  tags?: unknown;
  requester_id?: number | string;
  custom_fields?: RawZendeskCustomFieldValue[];
  via?: { channel?: string };
  satisfaction_rating?: { score?: string };
}

interface RawZendeskComment {
  id?: number | string;
  author_id?: number | string;
  body?: string;
  plain_body?: string;
  html_body?: string;
  created_at?: string;
  public?: boolean;
}

function normalizeBrandSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asDataArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter(isObject);
  }
  if (isObject(value) && Array.isArray(value.data)) {
    return value.data.filter(isObject);
  }
  if (isObject(value) && Array.isArray(value.items)) {
    return value.items.filter(isObject);
  }
  return [];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTimestamp(value: unknown): string {
  const raw = asString(value);
  if (!raw) return '';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
}

function parseGorgiasTags(value: RawGorgiasTicket['tags']): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry.trim().toLowerCase();
      return asString(entry?.name).toLowerCase();
    })
    .filter(Boolean);
}

function parseStringTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => asString(entry).toLowerCase()).filter(Boolean);
}

function extractNextCursor(value: unknown): string | null {
  if (!isObject(value)) return null;
  const meta = isObject(value.meta) ? value.meta : {};
  return (
    asString(meta.next_cursor) ||
    asString(meta.nextCursor) ||
    asString(meta.after_cursor) ||
    asString(meta.afterCursor) ||
    asString(value.next_cursor) ||
    asString(value.nextCursor) ||
    null
  );
}

function stringifyCustomFieldValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => stringifyCustomFieldValue(entry))
      .filter(Boolean)
      .join(', ');
  }
  if (isObject(value)) {
    return (
      stringifyCustomFieldValue(value.value) ||
      stringifyCustomFieldValue(value.label) ||
      stringifyCustomFieldValue(value.name) ||
      stringifyCustomFieldValue(value.id)
    );
  }
  return '';
}

function parseUrlPathAndQuery(
  value: unknown,
): { path: string; query: Record<string, string> } | null {
  const raw = asString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const pathName = url.pathname.replace(/^\/api\/v2/, '') || '/';
    const query: Record<string, string> = {};
    for (const [key, queryValue] of url.searchParams.entries()) {
      query[key] = queryValue;
    }
    return { path: pathName, query };
  } catch {
    return null;
  }
}

function buildCustomFieldDefinitionMap(rows: Array<Record<string, unknown>>): Map<string, string> {
  const definitions = new Map<string, string>();
  for (const row of rows) {
    const id = asString(row.id);
    const name = asString(row.name) || asString(row.label) || asString(row.key);
    if (id && name) {
      definitions.set(id, name);
    }
  }
  return definitions;
}

function extractCustomFieldValues(
  rows: Array<Record<string, unknown>>,
  definitions: Map<string, string>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const row of rows) {
    const field = isObject(row.custom_field)
      ? row.custom_field
      : isObject(row.field)
        ? row.field
        : null;
    const id =
      asString(row.custom_field_id) ||
      asString(row.field_id) ||
      (field ? asString(field.id) : '') ||
      '';
    const name =
      asString(row.name) ||
      asString(row.label) ||
      (field ? asString(field.name) || asString(field.label) : '') ||
      definitions.get(id) ||
      '';
    const fieldValue =
      stringifyCustomFieldValue(row.value) ||
      stringifyCustomFieldValue(row.values) ||
      stringifyCustomFieldValue(row.field_value);
    if (name && fieldValue) {
      values[name] = fieldValue;
    }
  }
  return values;
}

function buildZendeskTicketFieldMap(rows: Array<Record<string, unknown>>): Map<string, string> {
  const definitions = new Map<string, string>();
  for (const row of rows) {
    const field = row as RawZendeskTicketField;
    const id = asString(field.id);
    const name = asString(field.title) || asString(field.raw_title) || asString(field.key);
    if (id && name) {
      definitions.set(id, name);
    }
  }
  return definitions;
}

function extractZendeskCustomFieldValues(
  rows: RawZendeskCustomFieldValue[] | undefined,
  definitions: Map<string, string>,
): Record<string, string> {
  const values: Record<string, string> = {};
  if (!Array.isArray(rows)) {
    return values;
  }
  for (const row of rows) {
    const id = asString(row.id);
    const name = definitions.get(id) || '';
    const fieldValue = stringifyCustomFieldValue(row.value);
    if (name && fieldValue) {
      values[name] = fieldValue;
    }
  }
  return values;
}

function normalizeFieldName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function pickCustomFieldValue(values: Record<string, string>, candidates: string[]): string {
  const entries = Object.entries(values).map(
    ([key, value]) => [normalizeFieldName(key), value] as const,
  );
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeFieldName(candidate);
    const exact = entries.find(([key]) => key === normalizedCandidate);
    if (exact?.[1]) {
      return exact[1];
    }
  }
  return '';
}

function inferIntentFromText(subject: string, customerText: string): string {
  const text = `${subject}\n${customerText}`.toLowerCase();
  if (/\b(cancel|stop|end)\b/.test(text) && /\b(subscription|plan|membership)\b/.test(text)) {
    return 'Subscription::Cancel::Other';
  }
  if (/\bpause\b/.test(text) && /\b(subscription|plan|membership)\b/.test(text)) {
    return 'Subscription::Pause::Other';
  }
  if (/\bskip\b/.test(text) && /\b(subscription|shipment|order)\b/.test(text)) {
    return 'Subscription::Skip::Other';
  }
  if (/\b(refund|money back)\b/.test(text)) {
    return 'Returns::Refund::Other';
  }
  if (/\b(return|exchange)\b/.test(text)) {
    return 'Returns::Return::Other';
  }
  if (/\b(track|tracking|where is|delivery|shipping|shipment)\b/.test(text)) {
    return 'Order::Status::Other';
  }
  return 'Other::Unclassified::Other';
}

function inferIssueTypeFromIntent(intent: string): string {
  const normalized = intent.toLowerCase();
  if (normalized.startsWith('subscription::cancel')) {
    return 'Account Management::Cancellation';
  }
  if (normalized.startsWith('subscription::pause') || normalized.startsWith('subscription::skip')) {
    return 'Account Management::Subscription Management';
  }
  if (normalized.startsWith('returns::refund') || normalized.startsWith('returns::return')) {
    return 'Returns & Refunds::General';
  }
  if (normalized.startsWith('order::status')) {
    return 'Information Request::Order Status';
  }
  return 'Other::General';
}

function extractGorgiasRating(ticket: RawGorgiasTicket): string {
  const rating =
    stringifyCustomFieldValue(ticket.satisfaction_survey?.score) ||
    stringifyCustomFieldValue(ticket.satisfaction_survey?.rating) ||
    stringifyCustomFieldValue(ticket.survey_score) ||
    stringifyCustomFieldValue(ticket.rating);
  return rating;
}

function isAgentMessage(message: RawGorgiasMessage, customerEmail: string): boolean {
  if (message.from_agent === true || message.internal === true) {
    return true;
  }
  const senderEmail = asString(message.sender?.email).toLowerCase();
  if (!senderEmail) {
    return false;
  }
  if (customerEmail && senderEmail === customerEmail.toLowerCase()) {
    return false;
  }
  return true;
}

function sortMessages(messages: RawGorgiasMessage[]): RawGorgiasMessage[] {
  return [...messages].sort((left, right) => {
    const leftTime = new Date(left.created_datetime || '').getTime();
    const rightTime = new Date(right.created_datetime || '').getTime();
    if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
      return 0;
    }
    return leftTime - rightTime;
  });
}

function buildNormalizedRecords(args: {
  brand: string;
  ticket: RawGorgiasTicket;
  messages: RawGorgiasMessage[];
  customFieldValues: Record<string, string>;
}): {
  ticket: WorkflowStudioFeedbackStoreTicket;
  responses: WorkflowStudioFeedbackStoreResponse[];
} {
  const ticketId = String(args.ticket.id ?? '').trim();
  const customerEmail = asString(args.ticket.customer?.email);
  const sortedMessages = sortMessages(args.messages);
  const customerMessages = sortedMessages.filter(
    (message) => !message.internal && !isAgentMessage(message, customerEmail),
  );
  const agentMessages = sortedMessages.filter(
    (message) => !message.internal && isAgentMessage(message, customerEmail),
  );
  const customerText = customerMessages
    .map((message) => asString(message.body_text))
    .filter(Boolean)
    .slice(-6)
    .join('\n');

  const aiIntent =
    pickCustomFieldValue(args.customFieldValues, ['AI Intent', 'Intent', 'Primary Intent']) ||
    inferIntentFromText(asString(args.ticket.subject), customerText);
  const issueType =
    pickCustomFieldValue(args.customFieldValues, [
      'Issue Type',
      'Ticket Type',
      'AI Type',
      'Type',
    ]) || inferIssueTypeFromIntent(aiIntent);
  const rating = extractGorgiasRating(args.ticket);

  let latestCustomerMessage = '';
  const responses = sortedMessages.flatMap((message, index) => {
    const body = asString(message.body_text);
    if (!body || message.internal) {
      return [];
    }

    if (!isAgentMessage(message, customerEmail)) {
      latestCustomerMessage = body;
      return [];
    }

    return [
      {
        messageId:
          String(message.id ?? '').trim() ||
          `${ticketId}:${normalizeTimestamp(message.created_datetime) || index}`,
        ticketId,
        handledBy: asString(message.sender?.email) || 'gorgias-agent',
        rating,
        customerMessage: latestCustomerMessage,
        response: body,
        createdAt: normalizeTimestamp(message.created_datetime),
        source: 'gorgias' as const,
      },
    ];
  });

  return {
    ticket: {
      ticketId,
      brand: args.brand,
      tags: parseGorgiasTags(args.ticket.tags),
      channel: asString(args.ticket.channel),
      aiIntent,
      issueType,
      agentMessages: agentMessages.length,
      customerMessages: customerMessages.length,
      updatedAt:
        normalizeTimestamp(args.ticket.updated_datetime) ||
        normalizeTimestamp(args.ticket.created_datetime),
      source: 'gorgias',
      subject: asString(args.ticket.subject),
      status: asString(args.ticket.status),
      rating,
    },
    responses,
  };
}

function extractZendeskRating(ticket: RawZendeskTicket): string {
  return stringifyCustomFieldValue(ticket.satisfaction_rating?.score);
}

function extractZendeskCommentBody(comment: RawZendeskComment): string {
  return asString(comment.plain_body) || asString(comment.body) || asString(comment.html_body);
}

function isZendeskAgentComment(comment: RawZendeskComment, requesterId: string): boolean {
  const authorId = String(comment.author_id ?? '').trim();
  if (!authorId) {
    return false;
  }
  return !requesterId || authorId !== requesterId;
}

function sortZendeskComments(comments: RawZendeskComment[]): RawZendeskComment[] {
  return [...comments].sort((left, right) => {
    const leftTime = new Date(left.created_at || '').getTime();
    const rightTime = new Date(right.created_at || '').getTime();
    if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
      return 0;
    }
    return leftTime - rightTime;
  });
}

function extractZendeskComments(value: unknown): RawZendeskComment[] {
  if (!isObject(value) || !Array.isArray(value.comments)) {
    return [];
  }
  return value.comments.filter(isObject) as RawZendeskComment[];
}

function extractZendeskTickets(value: unknown): RawZendeskTicket[] {
  if (!isObject(value) || !Array.isArray(value.tickets)) {
    return [];
  }
  return value.tickets.filter(isObject) as RawZendeskTicket[];
}

function extractZendeskCursor(value: unknown): string | null {
  if (!isObject(value)) return null;
  return asString(value.after_cursor) || asString(value.cursor) || null;
}

function extractZendeskNextPage(
  value: unknown,
): { path: string; query: Record<string, string> } | null {
  if (!isObject(value)) return null;
  return parseUrlPathAndQuery(value.next_page);
}

function buildNormalizedZendeskRecords(args: {
  brand: string;
  ticket: RawZendeskTicket;
  comments: RawZendeskComment[];
  customFieldValues: Record<string, string>;
}): {
  ticket: WorkflowStudioFeedbackStoreTicket;
  responses: WorkflowStudioFeedbackStoreResponse[];
} {
  const ticketId = String(args.ticket.id ?? '').trim();
  const requesterId = String(args.ticket.requester_id ?? '').trim();
  const sortedComments = sortZendeskComments(args.comments);
  const publicComments = sortedComments.filter((comment) => comment.public !== false);
  const customerComments = publicComments.filter(
    (comment) => !isZendeskAgentComment(comment, requesterId),
  );
  const agentComments = publicComments.filter((comment) =>
    isZendeskAgentComment(comment, requesterId),
  );
  const customerText = customerComments
    .map((comment) => extractZendeskCommentBody(comment))
    .filter(Boolean)
    .slice(-6)
    .join('\n');

  const aiIntent =
    pickCustomFieldValue(args.customFieldValues, ['AI Intent', 'Intent', 'Primary Intent']) ||
    inferIntentFromText(asString(args.ticket.subject), customerText);
  const issueType =
    pickCustomFieldValue(args.customFieldValues, [
      'Issue Type',
      'Ticket Type',
      'AI Type',
      'Type',
    ]) || inferIssueTypeFromIntent(aiIntent);
  const rating = extractZendeskRating(args.ticket);

  let latestCustomerMessage = '';
  const responses = publicComments.flatMap((comment, index) => {
    const body = extractZendeskCommentBody(comment);
    if (!body) {
      return [];
    }

    if (!isZendeskAgentComment(comment, requesterId)) {
      latestCustomerMessage = body;
      return [];
    }

    const authorId = String(comment.author_id ?? '').trim();
    return [
      {
        messageId:
          String(comment.id ?? '').trim() ||
          `${ticketId}:${normalizeTimestamp(comment.created_at) || index}`,
        ticketId,
        handledBy: authorId ? `author:${authorId}` : 'zendesk-agent',
        rating,
        customerMessage: latestCustomerMessage,
        response: body,
        createdAt: normalizeTimestamp(comment.created_at),
        source: 'zendesk' as const,
      },
    ];
  });

  return {
    ticket: {
      ticketId,
      brand: args.brand,
      tags: parseStringTags(args.ticket.tags),
      channel: asString(args.ticket.via?.channel),
      aiIntent,
      issueType,
      agentMessages: agentComments.length,
      customerMessages: customerComments.length,
      updatedAt:
        normalizeTimestamp(args.ticket.updated_at) || normalizeTimestamp(args.ticket.created_at),
      source: 'zendesk',
      subject: asString(args.ticket.subject),
      status: asString(args.ticket.status),
      rating,
    },
    responses,
  };
}

function readTicketArray(filePath: string): WorkflowStudioFeedbackStoreTicket[] {
  return (
    readJsonFile(filePath, {
      label: 'Workflow feedback tickets',
      maxBytes: STORE_MAX_BYTES,
      expectArray: true,
    }) as WorkflowStudioFeedbackStoreTicket[]
  ).filter((entry) => isObject(entry));
}

function readResponseArray(filePath: string): WorkflowStudioFeedbackStoreResponse[] {
  return (
    readJsonFile(filePath, {
      label: 'Workflow feedback responses',
      maxBytes: STORE_MAX_BYTES,
      expectArray: true,
    }) as WorkflowStudioFeedbackStoreResponse[]
  ).filter((entry) => isObject(entry));
}

function readState(filePath: string): WorkflowStudioFeedbackStoreState {
  return readJsonFile(filePath, {
    label: 'Workflow feedback state',
    maxBytes: STORE_MAX_BYTES,
    expectObject: true,
  }) as WorkflowStudioFeedbackStoreState;
}

function defaultState(
  source: WorkflowStudioFeedbackSource = 'gorgias',
): WorkflowStudioFeedbackStoreState {
  return {
    source,
    lastSyncedAt: null,
    newestTicketUpdatedAt: null,
    newestTicketIds: [],
    providerCursor: null,
  };
}

function readOptionalTicketArray(filePath: string): WorkflowStudioFeedbackStoreTicket[] {
  try {
    return readTicketArray(filePath);
  } catch {
    return [];
  }
}

function readOptionalResponseArray(filePath: string): WorkflowStudioFeedbackStoreResponse[] {
  try {
    return readResponseArray(filePath);
  } catch {
    return [];
  }
}

function readOptionalState(
  filePath: string,
  source: WorkflowStudioFeedbackSource = 'gorgias',
): WorkflowStudioFeedbackStoreState {
  try {
    return readState(filePath);
  } catch {
    return defaultState(source);
  }
}

function writeJsonFile(filePath: string, data: unknown): void {
  writePrivateTextFileSecure(filePath, JSON.stringify(data, null, 2) + '\n', {
    label: 'Workflow feedback store',
    atomic: true,
  });
}

function resolveBrandDisplayName(brandSlug: string, cwd: string): string {
  if (!brandStudioExists(brandSlug, cwd)) {
    return brandSlug;
  }
  try {
    return loadBrandStudioBundle(brandSlug, cwd).manifest.display_name || brandSlug;
  } catch {
    return brandSlug;
  }
}

function getFeedbackStoreRoot(source: WorkflowStudioFeedbackSource): string {
  return source === 'zendesk' ? 'feedback-zendesk' : 'feedback';
}

export function getWorkflowStudioFeedbackStorePaths(
  brandRef: string,
  cwd: string = process.cwd(),
  source: WorkflowStudioFeedbackSource = 'gorgias',
): WorkflowStudioFeedbackStorePaths {
  const brandSlug = normalizeBrandSlug(brandRef);
  const dir = path.resolve(cwd, '.stateset', getFeedbackStoreRoot(source), brandSlug);
  return {
    dir,
    tickets: path.join(dir, 'tickets.json'),
    responses: path.join(dir, 'responses.json'),
    state: path.join(dir, 'state.json'),
  };
}

export function loadWorkflowStudioFeedbackStore(
  brandRef: string,
  cwd: string = process.cwd(),
  source: WorkflowStudioFeedbackSource = 'gorgias',
): WorkflowStudioFeedbackStore {
  const brandSlug = normalizeBrandSlug(brandRef);
  const paths = getWorkflowStudioFeedbackStorePaths(brandSlug, cwd, source);
  const state = readOptionalState(paths.state, source);
  return {
    brandSlug,
    paths,
    tickets: readOptionalTicketArray(paths.tickets),
    responses: readOptionalResponseArray(paths.responses),
    state: {
      ...defaultState(source),
      ...state,
      source: state.source ?? source,
    },
  };
}

function buildNewestWatermark(tickets: WorkflowStudioFeedbackStoreTicket[]): {
  newestTicketUpdatedAt: string | null;
  newestTicketIds: string[];
} {
  if (tickets.length === 0) {
    return {
      newestTicketUpdatedAt: null,
      newestTicketIds: [],
    };
  }

  const newestTicketUpdatedAt =
    tickets
      .map((ticket) => normalizeTimestamp(ticket.updatedAt))
      .filter(Boolean)
      .sort((left, right) => right.localeCompare(left))[0] || null;
  const newestTicketIds = newestTicketUpdatedAt
    ? tickets
        .filter((ticket) => normalizeTimestamp(ticket.updatedAt) === newestTicketUpdatedAt)
        .map((ticket) => ticket.ticketId)
        .filter(Boolean)
        .sort()
    : [];

  return {
    newestTicketUpdatedAt,
    newestTicketIds,
  };
}

export function writeWorkflowStudioFeedbackStore(store: WorkflowStudioFeedbackStore): void {
  ensurePrivateDirectory(store.paths.dir, {
    symlinkErrorPrefix: 'Workflow feedback store directory must not be a symlink',
    nonDirectoryErrorPrefix: 'Workflow feedback store path is not a directory',
  });
  writeJsonFile(store.paths.tickets, store.tickets);
  writeJsonFile(store.paths.responses, store.responses);
  writeJsonFile(store.paths.state, store.state);
}

function createZendeskRequester(
  config: ZendeskConfig,
  requestFn?: WorkflowStudioFeedbackSyncOptions['zendeskRequest'],
): (options: Omit<ZendeskRequestOptions, 'zendesk'>) => Promise<{ status: number; data: unknown }> {
  return (options) =>
    (requestFn ?? zendeskRequest)({
      zendesk: config,
      ...options,
    });
}

async function listZendeskTicketFields(
  request: ReturnType<typeof createZendeskRequester>,
  maxPages = DEFAULT_MAX_PAGES,
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  let next: { path: string; query: Record<string, string> } | null = {
    path: '/ticket_fields.json',
    query: { per_page: '100' },
  };
  let pages = 0;

  while (next && pages < maxPages) {
    const result = await request({
      method: 'GET',
      path: next.path,
      query: next.query,
    });
    if (isObject(result.data) && Array.isArray(result.data.ticket_fields)) {
      rows.push(...result.data.ticket_fields.filter(isObject));
    }
    next = extractZendeskNextPage(result.data);
    pages += 1;
  }

  return rows;
}

async function listZendeskTicketComments(
  request: ReturnType<typeof createZendeskRequester>,
  ticketId: string,
  maxPages = DEFAULT_MAX_PAGES,
): Promise<RawZendeskComment[]> {
  const comments: RawZendeskComment[] = [];
  let next: { path: string; query: Record<string, string> } | null = {
    path: `/tickets/${ticketId}/comments.json`,
    query: { per_page: '100', sort_order: 'asc' },
  };
  let pages = 0;

  while (next && pages < maxPages) {
    const result = await request({
      method: 'GET',
      path: next.path,
      query: next.query,
    });
    comments.push(...extractZendeskComments(result.data));
    next = extractZendeskNextPage(result.data);
    pages += 1;
  }

  return comments;
}

export async function syncWorkflowStudioFeedbackFromGorgias(
  options: WorkflowStudioFeedbackSyncOptions,
): Promise<WorkflowStudioFeedbackSyncResult> {
  const cwd = options.cwd ?? process.cwd();
  const brandSlug = normalizeBrandSlug(options.brandRef);
  const paths = getWorkflowStudioFeedbackStorePaths(brandSlug, cwd, 'gorgias');
  const existing = loadWorkflowStudioFeedbackStore(brandSlug, cwd, 'gorgias');
  const gorgiasConfig = options.gorgiasConfig ?? getGorgiasConfigFromEnv(cwd);
  if (!gorgiasConfig && !options.api) {
    throw new Error(
      'Gorgias credentials not found. Set GORGIAS_DOMAIN, GORGIAS_API_KEY, and GORGIAS_EMAIL or run response integrations setup.',
    );
  }

  const api = options.api ?? createGorgiasApi(gorgiasConfig as GorgiasConfig);
  const pageLimit = Math.max(1, Math.min(100, Number(options.pageLimit) || DEFAULT_PAGE_LIMIT));
  const maxPages = Math.max(1, Number(options.maxPages) || DEFAULT_MAX_PAGES);
  const ticketsById = new Map(existing.tickets.map((ticket) => [ticket.ticketId, ticket]));
  const responsesByTicketId = new Map<string, WorkflowStudioFeedbackStoreResponse[]>();
  for (const response of existing.responses) {
    const current = responsesByTicketId.get(response.ticketId) ?? [];
    current.push(response);
    responsesByTicketId.set(response.ticketId, current);
  }

  const definitionRows = asDataArray(await api.requestRaw('GET', '/custom-fields', { limit: 100 }));
  const customFieldDefinitions = buildCustomFieldDefinitionMap(definitionRows);
  const displayName = resolveBrandDisplayName(brandSlug, cwd);
  const watermark = normalizeTimestamp(existing.state.newestTicketUpdatedAt);
  const watermarkIds = new Set(existing.state.newestTicketIds);

  let cursor: string | null = null;
  let pagesFetched = 0;
  let ticketsScanned = 0;
  let ticketsUpserted = 0;
  let stop = false;

  while (pagesFetched < maxPages && !stop) {
    const result = await api.requestRaw('GET', '/tickets', {
      order_by: 'updated_datetime:desc',
      limit: pageLimit,
      cursor: cursor || undefined,
      trashed: false,
    });
    const rows = asDataArray(result);
    if (rows.length === 0) {
      break;
    }

    pagesFetched += 1;
    for (const row of rows) {
      const ticket = row as RawGorgiasTicket;
      const ticketId = String(ticket.id ?? '').trim();
      if (!ticketId) {
        continue;
      }
      ticketsScanned += 1;

      const updatedAt =
        normalizeTimestamp(ticket.updated_datetime) || normalizeTimestamp(ticket.created_datetime);
      const alreadySeenAtWatermark =
        watermark &&
        updatedAt &&
        (updatedAt < watermark || (updatedAt === watermark && watermarkIds.has(ticketId)));
      if (alreadySeenAtWatermark) {
        if (updatedAt < watermark) {
          stop = true;
          break;
        }
        continue;
      }

      const [messagesResult, customFieldsResult] = await Promise.all([
        api.getTicketMessages(Number(ticketId)),
        api.requestRaw('GET', `/tickets/${ticketId}/custom-fields`),
      ]);
      const messages = asDataArray(messagesResult) as RawGorgiasMessage[];
      const customFieldValues = extractCustomFieldValues(
        asDataArray(customFieldsResult),
        customFieldDefinitions,
      );
      const normalized = buildNormalizedRecords({
        brand: pickCustomFieldValue(customFieldValues, ['Brand']) || displayName,
        ticket,
        messages,
        customFieldValues,
      });

      ticketsById.set(ticketId, normalized.ticket);
      responsesByTicketId.set(ticketId, normalized.responses);
      ticketsUpserted += 1;
    }

    if (stop) {
      break;
    }
    cursor = extractNextCursor(result);
    if (!cursor) {
      break;
    }
  }

  const tickets = [...ticketsById.values()].sort(
    (left, right) =>
      normalizeTimestamp(right.updatedAt).localeCompare(normalizeTimestamp(left.updatedAt)) ||
      left.ticketId.localeCompare(right.ticketId),
  );
  const responses = [...responsesByTicketId.values()]
    .flat()
    .sort(
      (left, right) =>
        normalizeTimestamp(left.createdAt).localeCompare(normalizeTimestamp(right.createdAt)) ||
        left.messageId.localeCompare(right.messageId),
    );
  const syncedAt = new Date().toISOString();
  const newest = buildNewestWatermark(tickets);
  const store: WorkflowStudioFeedbackStore = {
    brandSlug,
    paths,
    tickets,
    responses,
    state: {
      source: 'gorgias',
      lastSyncedAt: syncedAt,
      newestTicketUpdatedAt: newest.newestTicketUpdatedAt,
      newestTicketIds: newest.newestTicketIds,
    },
  };
  writeWorkflowStudioFeedbackStore(store);

  return {
    brandSlug,
    provider: 'gorgias',
    storeDir: paths.dir,
    syncedAt,
    ticketsScanned,
    ticketsUpserted,
    responsesUpserted: responses.length,
    pagesFetched,
    newestTicketUpdatedAt: newest.newestTicketUpdatedAt,
  };
}

export async function syncWorkflowStudioFeedbackFromZendesk(
  options: WorkflowStudioFeedbackSyncOptions,
): Promise<WorkflowStudioFeedbackSyncResult> {
  const cwd = options.cwd ?? process.cwd();
  const brandSlug = normalizeBrandSlug(options.brandRef);
  const paths = getWorkflowStudioFeedbackStorePaths(brandSlug, cwd, 'zendesk');
  const existing = loadWorkflowStudioFeedbackStore(brandSlug, cwd, 'zendesk');
  const zendeskConfig = options.zendeskConfig ?? getZendeskConfigFromEnv(cwd);
  if (!zendeskConfig && !options.zendeskRequest) {
    throw new Error(
      'Zendesk credentials not found. Set ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, and ZENDESK_API_TOKEN or run response integrations setup.',
    );
  }

  const request = createZendeskRequester(zendeskConfig as ZendeskConfig, options.zendeskRequest);
  const pageLimit = Math.max(1, Math.min(1000, Number(options.pageLimit) || 1000));
  const maxPages = Math.max(1, Number(options.maxPages) || DEFAULT_MAX_PAGES);
  const sinceDays = Math.max(
    1,
    Math.min(365, Number(options.sinceDays) || DEFAULT_ZENDESK_INITIAL_SYNC_DAYS),
  );
  const ticketsById = new Map(existing.tickets.map((ticket) => [ticket.ticketId, ticket]));
  const responsesByTicketId = new Map<string, WorkflowStudioFeedbackStoreResponse[]>();
  for (const response of existing.responses) {
    const current = responsesByTicketId.get(response.ticketId) ?? [];
    current.push(response);
    responsesByTicketId.set(response.ticketId, current);
  }

  const ticketFieldDefinitions = buildZendeskTicketFieldMap(await listZendeskTicketFields(request));
  const displayName = resolveBrandDisplayName(brandSlug, cwd);
  let cursor = asString(existing.state.providerCursor);
  const lastSyncedAtEpoch = existing.state.lastSyncedAt
    ? Math.floor(new Date(existing.state.lastSyncedAt).getTime() / 1000)
    : 0;
  let pagesFetched = 0;
  let ticketsScanned = 0;
  let ticketsUpserted = 0;

  while (pagesFetched < maxPages) {
    const query = cursor
      ? {
          cursor,
          per_page: pageLimit,
          exclude_deleted: true,
          support_type_scope: 'agent',
        }
      : {
          start_time:
            lastSyncedAtEpoch > 0
              ? Math.max(0, lastSyncedAtEpoch - 120)
              : Math.floor(Date.now() / 1000) - sinceDays * 24 * 60 * 60 - 120,
          per_page: pageLimit,
          exclude_deleted: true,
          support_type_scope: 'agent',
        };
    const result = await request({
      method: 'GET',
      path: '/incremental/tickets/cursor',
      query,
    });
    const rows = extractZendeskTickets(result.data);
    const nextCursor = extractZendeskCursor(result.data);
    const endOfStream = isObject(result.data) && result.data.end_of_stream === true;
    pagesFetched += 1;

    for (const ticket of rows) {
      const ticketId = String(ticket.id ?? '').trim();
      if (!ticketId) {
        continue;
      }
      ticketsScanned += 1;

      const comments = await listZendeskTicketComments(request, ticketId);
      const customFieldValues = extractZendeskCustomFieldValues(
        ticket.custom_fields,
        ticketFieldDefinitions,
      );
      const normalized = buildNormalizedZendeskRecords({
        brand: pickCustomFieldValue(customFieldValues, ['Brand']) || displayName,
        ticket,
        comments,
        customFieldValues,
      });

      ticketsById.set(ticketId, normalized.ticket);
      responsesByTicketId.set(ticketId, normalized.responses);
      ticketsUpserted += 1;
    }

    if (!nextCursor) {
      break;
    }
    cursor = nextCursor;
    if (endOfStream) {
      break;
    }
  }

  const tickets = [...ticketsById.values()].sort(
    (left, right) =>
      normalizeTimestamp(right.updatedAt).localeCompare(normalizeTimestamp(left.updatedAt)) ||
      left.ticketId.localeCompare(right.ticketId),
  );
  const responses = [...responsesByTicketId.values()]
    .flat()
    .sort(
      (left, right) =>
        normalizeTimestamp(left.createdAt).localeCompare(normalizeTimestamp(right.createdAt)) ||
        left.messageId.localeCompare(right.messageId),
    );
  const syncedAt = new Date().toISOString();
  const newest = buildNewestWatermark(tickets);
  const store: WorkflowStudioFeedbackStore = {
    brandSlug,
    paths,
    tickets,
    responses,
    state: {
      source: 'zendesk',
      lastSyncedAt: syncedAt,
      newestTicketUpdatedAt: newest.newestTicketUpdatedAt,
      newestTicketIds: newest.newestTicketIds,
      providerCursor: cursor || null,
    },
  };
  writeWorkflowStudioFeedbackStore(store);

  return {
    brandSlug,
    provider: 'zendesk',
    storeDir: paths.dir,
    syncedAt,
    ticketsScanned,
    ticketsUpserted,
    responsesUpserted: responses.length,
    pagesFetched,
    newestTicketUpdatedAt: newest.newestTicketUpdatedAt,
  };
}
