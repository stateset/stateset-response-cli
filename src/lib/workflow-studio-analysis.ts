import fs from 'node:fs';
import path from 'node:path';

import type { SkipRule } from './manifest-builder.js';
import { readJsonFile } from '../utils/file-read.js';

const CSV_EXTENSION_PATTERN = /\.(csv|tsv)$/i;
const JSON_EXTENSION_PATTERN = /\.json$/i;
const TICKET_FILE_PATTERN = /ticket/i;
const RESPONSE_FILE_PATTERN = /response/i;
const NOISE_INTENT_PREFIX = 'other::no reply';
const GENERIC_SKIP_TAGS = new Set([
  'agent-take-over',
  'auto-close',
  'macro',
  'subscription',
  'returns',
  'retail subscription',
  'retail standard',
]);

export interface AnalysisCountRow {
  value: string;
  count: number;
  sample_ticket_ids: string[];
}

export interface WorkflowStudioConfigProposal {
  skip_rules_append: SkipRule[];
  classification_focus: AnalysisCountRow[];
  review_gate_focus: AnalysisCountRow[];
  prompt_hints: string[];
}

export interface WorkflowStudioFeedbackAnalysis {
  brand_slug: string;
  generated_at: string;
  inputs: {
    ticket_files: string[];
    response_files: string[];
  };
  totals: {
    ticket_rows: number;
    matched_ticket_rows: number;
    response_rows: number;
    matched_response_rows: number;
    noise_ticket_rows: number;
    agent_takeover_rows: number;
    brand_boundary_responses: number;
  };
  summaries: {
    intents: AnalysisCountRow[];
    issue_types: AnalysisCountRow[];
    channels: AnalysisCountRow[];
    handled_by: AnalysisCountRow[];
    ratings: AnalysisCountRow[];
    noise_tags: AnalysisCountRow[];
    agent_takeovers_by_intent: AnalysisCountRow[];
  };
  proposal: WorkflowStudioConfigProposal;
}

export interface WorkflowStudioFeedbackAnalysisOptions {
  brandRef: string;
  cwd?: string;
  sourcePath?: string;
  ticketsPath?: string;
  responsesPath?: string;
}

interface TicketRecord {
  ticketId: string;
  brand: string;
  tags: string[];
  channel: string;
  aiIntent: string;
  issueType: string;
  agentMessages: number;
  customerMessages: number;
}

interface ResponseRecord {
  ticketId: string;
  handledBy: string;
  rating: string;
  customerMessage: string;
  response: string;
}

function normalizeBrandKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function toBrandSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function matchesBrand(candidate: string, brandKey: string): boolean {
  const candidateKey = normalizeBrandKey(candidate);
  if (!candidateKey || !brandKey) return false;
  return (
    candidateKey === brandKey || candidateKey.includes(brandKey) || brandKey.includes(candidateKey)
  );
}

function parseCsvText(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];

    if (inQuotes) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\r') {
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((value) => value.trim().length > 0));
}

function readCsvObjects(filePath: string): Array<Record<string, string>> {
  const raw = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
  const rows = parseCsvText(raw);
  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    for (let index = 0; index < headers.length; index += 1) {
      record[headers[index]] = (cells[index] ?? '').trim();
    }
    return record;
  });
}

function readJsonArray<T>(filePath: string): T[] {
  return readJsonFile(filePath, {
    label: 'Workflow feedback JSON input',
    maxBytes: 32 * 1024 * 1024,
    expectArray: true,
  }) as T[];
}

function discoverCsvFiles(rootPath: string, matcher: RegExp): string[] {
  const resolved = path.resolve(rootPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Input path not found: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    if (!CSV_EXTENSION_PATTERN.test(resolved)) {
      throw new Error(`Expected a CSV file: ${resolved}`);
    }
    return [resolved];
  }

  const results: string[] = [];
  const stack = [resolved];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (CSV_EXTENSION_PATTERN.test(entry.name) && matcher.test(entry.name)) {
        results.push(nextPath);
      }
    }
  }

  return results.sort();
}

function resolveStructuredJsonFile(
  cwd: string,
  sourcePath: string | undefined,
  explicitPath: string | undefined,
  fileName: string,
): string | null {
  const rawPath = explicitPath?.trim() || sourcePath?.trim();
  if (!rawPath) {
    return null;
  }

  const resolved = path.resolve(cwd, rawPath);
  if (!fs.existsSync(resolved)) {
    return null;
  }

  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    return JSON_EXTENSION_PATTERN.test(resolved) ? resolved : null;
  }

  const candidate = path.join(resolved, fileName);
  return fs.existsSync(candidate) ? candidate : null;
}

function parseTags(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function toCountMap(values: Array<{ value: string; ticketId?: string }>): AnalysisCountRow[] {
  const counts = new Map<string, { count: number; sampleIds: string[] }>();
  for (const entry of values) {
    const value = entry.value.trim();
    if (!value) continue;
    const current = counts.get(value) ?? { count: 0, sampleIds: [] };
    current.count += 1;
    if (
      entry.ticketId &&
      current.sampleIds.length < 5 &&
      !current.sampleIds.includes(entry.ticketId)
    ) {
      current.sampleIds.push(entry.ticketId);
    }
    counts.set(value, current);
  }

  return [...counts.entries()]
    .map(([value, current]) => ({
      value,
      count: current.count,
      sample_ticket_ids: current.sampleIds,
    }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

function toNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isNoiseTicket(ticket: TicketRecord): boolean {
  return (
    ticket.aiIntent.toLowerCase().startsWith(NOISE_INTENT_PREFIX) ||
    ticket.tags.includes('non-support-related') ||
    (ticket.agentMessages === 0 && ticket.customerMessages <= 1)
  );
}

function hasBrandBoundarySignal(response: ResponseRecord): boolean {
  const text = `${response.customerMessage}\n${response.response}`.toLowerCase();
  return (
    text.includes('another brand') ||
    text.includes('separate brands') ||
    text.includes('wrong brand') ||
    text.includes('meant for another')
  );
}

function createPromptHints(
  tickets: TicketRecord[],
  noiseTickets: TicketRecord[],
  brandBoundaryResponses: ResponseRecord[],
  topIntents: AnalysisCountRow[],
): string[] {
  const hints = new Set<string>();

  if (tickets.length > 0 && noiseTickets.length / tickets.length >= 0.15) {
    hints.add(
      'Explicitly identify newsletters, supplier outreach, wholesale pitches, marketplace notifications, and operational alerts as non-support traffic to skip or auto-close.',
    );
  }

  if (brandBoundaryResponses.length > 0) {
    hints.add(
      'Reinforce brand-boundary handling so the agent clearly acknowledges when a customer message appears to be meant for another brand or merchant.',
    );
  }

  if (topIntents.some((entry) => entry.value.toLowerCase().includes('delivery'))) {
    hints.add(
      'Differentiate delivery delay, delivered-not-received, and missing-item scenarios with separate response patterns and evidence requirements.',
    );
  }

  if (topIntents.some((entry) => entry.value.toLowerCase().includes('subscription::cancel'))) {
    hints.add(
      'Keep subscription cancellation responses concise and action-oriented, confirming the next charge or shipment state when available.',
    );
  }

  return [...hints];
}

function createSkipRuleProposal(
  noiseTickets: TicketRecord[],
  matchedTickets: TicketRecord[],
  brandKey: string,
): SkipRule[] {
  const noiseTagCounts = toCountMap(
    noiseTickets.flatMap((ticket) =>
      ticket.tags.map((tag) => ({ value: tag, ticketId: ticket.ticketId })),
    ),
  );
  const allTagCounts = toCountMap(
    matchedTickets.flatMap((ticket) =>
      ticket.tags.map((tag) => ({ value: tag, ticketId: ticket.ticketId })),
    ),
  );

  const candidateTags = noiseTagCounts
    .map((entry) => entry.value)
    .filter((tag) => !GENERIC_SKIP_TAGS.has(tag))
    .filter((tag) => !matchesBrand(tag, brandKey))
    .filter((tag, index, values) => values.indexOf(tag) === index)
    .filter((tag) => {
      if (tag === 'non-support-related') {
        return true;
      }
      const noiseCount = noiseTagCounts.find((entry) => entry.value === tag)?.count ?? 0;
      const totalCount = allTagCounts.find((entry) => entry.value === tag)?.count ?? 0;
      return noiseCount >= 2 && totalCount > 0 && noiseCount / totalCount >= 0.8;
    })
    .slice(0, 8);

  if (candidateTags.length === 0) {
    return [];
  }

  return [
    {
      rule_type: 'tag_filter',
      params: {
        match_any: candidateTags,
        rationale: 'Generated from local feedback analysis of non-support traffic.',
      },
    },
  ];
}

function buildTicketRecord(row: Record<string, string>): TicketRecord {
  return {
    ticketId: row['Ticket id'] || row['Ticket ID'] || '',
    brand: row['Ticket Field: Brand'] || '',
    tags: parseTags(row.Tags || ''),
    channel: row['Initial channel'] || '',
    aiIntent: row['Ticket Field: AI Intent'] || '',
    issueType: row['Ticket Field: Type'] || '',
    agentMessages: toNumber(row['Number of agent messages'] || '0'),
    customerMessages: toNumber(row['Number of customer messages'] || '0'),
  };
}

function buildResponseRecord(row: Record<string, string>): ResponseRecord {
  return {
    ticketId: row['Ticket ID'] || row['Ticket id'] || '',
    handledBy: row['Handled By'] || '',
    rating: row.Rating || '',
    customerMessage: row['Customer Message'] || '',
    response: row.Response || '',
  };
}

function buildStoredTicketRecord(row: Record<string, unknown>): TicketRecord {
  return {
    ticketId: String(row.ticketId ?? '').trim(),
    brand: String(row.brand ?? '').trim(),
    tags: Array.isArray(row.tags)
      ? row.tags
          .map((value) =>
            String(value ?? '')
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean)
      : [],
    channel: String(row.channel ?? '').trim(),
    aiIntent: String(row.aiIntent ?? '').trim(),
    issueType: String(row.issueType ?? '').trim(),
    agentMessages: toNumber(String(row.agentMessages ?? '0')),
    customerMessages: toNumber(String(row.customerMessages ?? '0')),
  };
}

function buildStoredResponseRecord(row: Record<string, unknown>): ResponseRecord {
  return {
    ticketId: String(row.ticketId ?? '').trim(),
    handledBy: String(row.handledBy ?? '').trim(),
    rating: String(row.rating ?? '').trim(),
    customerMessage: String(row.customerMessage ?? '').trim(),
    response: String(row.response ?? '').trim(),
  };
}

function resolveInputFiles(
  cwd: string,
  sourcePath: string | undefined,
  explicitPath: string | undefined,
  matcher: RegExp,
): string[] {
  if (explicitPath?.trim()) {
    return discoverCsvFiles(path.resolve(cwd, explicitPath.trim()), matcher);
  }
  if (sourcePath?.trim()) {
    return discoverCsvFiles(path.resolve(cwd, sourcePath.trim()), matcher);
  }
  return [];
}

export function renderWorkflowStudioFeedbackSummary(
  analysis: WorkflowStudioFeedbackAnalysis,
): string {
  const lines = [
    `# Workflow Feedback Analysis: ${analysis.brand_slug}`,
    '',
    `Generated: ${analysis.generated_at}`,
    '',
    '## Totals',
    '',
    `- Ticket rows scanned: ${analysis.totals.ticket_rows}`,
    `- Ticket rows matched: ${analysis.totals.matched_ticket_rows}`,
    `- Response rows scanned: ${analysis.totals.response_rows}`,
    `- Response rows matched: ${analysis.totals.matched_response_rows}`,
    `- Noise / non-support tickets: ${analysis.totals.noise_ticket_rows}`,
    `- Agent takeover tickets: ${analysis.totals.agent_takeover_rows}`,
    `- Brand-boundary responses: ${analysis.totals.brand_boundary_responses}`,
    '',
    '## Top Intents',
    '',
    ...analysis.summaries.intents.slice(0, 8).map((entry) => `- ${entry.value}: ${entry.count}`),
    '',
    '## Proposal',
    '',
    ...analysis.proposal.skip_rules_append.map(
      (rule) => `- Add skip rule ${rule.rule_type}: ${JSON.stringify(rule.params)}`,
    ),
    ...analysis.proposal.classification_focus
      .slice(0, 5)
      .map((entry) => `- Focus classification on ${entry.value} (${entry.count} tickets)`),
    ...analysis.proposal.review_gate_focus
      .slice(0, 5)
      .map((entry) => `- Review gate focus: ${entry.value} (${entry.count} takeovers)`),
    ...analysis.proposal.prompt_hints.map((hint) => `- Prompt hint: ${hint}`),
    '',
  ];

  return lines.join('\n');
}

export function analyzeWorkflowStudioFeedback(
  options: WorkflowStudioFeedbackAnalysisOptions,
): WorkflowStudioFeedbackAnalysis {
  const cwd = options.cwd ?? process.cwd();
  const brandSlug = toBrandSlug(options.brandRef);
  const brandKey = normalizeBrandKey(brandSlug);

  const ticketFiles = resolveInputFiles(
    cwd,
    options.sourcePath,
    options.ticketsPath,
    TICKET_FILE_PATTERN,
  );
  const responseFiles = resolveInputFiles(
    cwd,
    options.sourcePath,
    options.responsesPath,
    RESPONSE_FILE_PATTERN,
  );
  const structuredTicketFile = ticketFiles.length
    ? null
    : resolveStructuredJsonFile(cwd, options.sourcePath, options.ticketsPath, 'tickets.json');
  const structuredResponseFile = responseFiles.length
    ? null
    : resolveStructuredJsonFile(cwd, options.sourcePath, options.responsesPath, 'responses.json');

  if (ticketFiles.length === 0 && !structuredTicketFile) {
    throw new Error(
      'No ticket feedback files found. Pass --tickets <file|dir> or --source <dir> with ticket exports or a normalized feedback store.',
    );
  }

  const allTickets = ticketFiles.length
    ? ticketFiles.flatMap((filePath) => readCsvObjects(filePath).map(buildTicketRecord))
    : readJsonArray<Record<string, unknown>>(structuredTicketFile as string).map(
        buildStoredTicketRecord,
      );
  const matchedTickets = allTickets.filter((ticket) => matchesBrand(ticket.brand, brandKey));
  const ticketIds = new Set(matchedTickets.map((ticket) => ticket.ticketId).filter(Boolean));

  const allResponses = responseFiles.length
    ? responseFiles.flatMap((filePath) => readCsvObjects(filePath).map(buildResponseRecord))
    : structuredResponseFile
      ? readJsonArray<Record<string, unknown>>(structuredResponseFile).map(
          buildStoredResponseRecord,
        )
      : [];
  const matchedResponses = allResponses.filter((response) => ticketIds.has(response.ticketId));

  const noiseTickets = matchedTickets.filter(isNoiseTicket);
  const agentTakeovers = matchedTickets.filter((ticket) => ticket.tags.includes('agent-take-over'));
  const brandBoundaryResponses = matchedResponses.filter(hasBrandBoundarySignal);

  const intentSummary = toCountMap(
    matchedTickets.map((ticket) => ({ value: ticket.aiIntent, ticketId: ticket.ticketId })),
  );
  const issueTypeSummary = toCountMap(
    matchedTickets.map((ticket) => ({ value: ticket.issueType, ticketId: ticket.ticketId })),
  );
  const channelSummary = toCountMap(
    matchedTickets.map((ticket) => ({ value: ticket.channel, ticketId: ticket.ticketId })),
  );
  const handledBySummary = toCountMap(
    matchedResponses.map((response) => ({
      value: response.handledBy || 'unknown',
      ticketId: response.ticketId,
    })),
  );
  const ratingSummary = toCountMap(
    matchedResponses
      .filter((response) => response.rating)
      .map((response) => ({ value: response.rating, ticketId: response.ticketId })),
  );
  const noiseTagSummary = toCountMap(
    noiseTickets.flatMap((ticket) =>
      ticket.tags.map((tag) => ({ value: tag, ticketId: ticket.ticketId })),
    ),
  );
  const takeoverSummary = toCountMap(
    agentTakeovers.map((ticket) => ({
      value: ticket.aiIntent || ticket.issueType || 'unknown',
      ticketId: ticket.ticketId,
    })),
  );

  const classificationFocus = intentSummary
    .filter((entry) => !entry.value.toLowerCase().startsWith(NOISE_INTENT_PREFIX))
    .slice(0, 8);
  const reviewGateFocus = takeoverSummary.filter((entry) => entry.count >= 2).slice(0, 8);
  const skipRulesAppend = createSkipRuleProposal(noiseTickets, matchedTickets, brandKey);
  const promptHints = createPromptHints(
    matchedTickets,
    noiseTickets,
    brandBoundaryResponses,
    classificationFocus,
  );

  return {
    brand_slug: brandSlug,
    generated_at: new Date().toISOString(),
    inputs: {
      ticket_files: ticketFiles.length
        ? ticketFiles
        : structuredTicketFile
          ? [structuredTicketFile]
          : [],
      response_files: responseFiles.length
        ? responseFiles
        : structuredResponseFile
          ? [structuredResponseFile]
          : [],
    },
    totals: {
      ticket_rows: allTickets.length,
      matched_ticket_rows: matchedTickets.length,
      response_rows: allResponses.length,
      matched_response_rows: matchedResponses.length,
      noise_ticket_rows: noiseTickets.length,
      agent_takeover_rows: agentTakeovers.length,
      brand_boundary_responses: brandBoundaryResponses.length,
    },
    summaries: {
      intents: intentSummary,
      issue_types: issueTypeSummary,
      channels: channelSummary,
      handled_by: handledBySummary,
      ratings: ratingSummary,
      noise_tags: noiseTagSummary,
      agent_takeovers_by_intent: takeoverSummary,
    },
    proposal: {
      skip_rules_append: skipRulesAppend,
      classification_focus: classificationFocus,
      review_gate_focus: reviewGateFocus,
      prompt_hints: promptHints,
    },
  };
}
