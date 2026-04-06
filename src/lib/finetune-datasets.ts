export type FinetuneDatasetFormat =
  | 'openai-sft'
  | 'studio-sft'
  | 'trl-sft'
  | 'studio-dpo'
  | 'pair-dpo';

export type FinetuneMethod = 'supervised' | 'dpo';

export interface FinetuneEvalRecord {
  id?: string;
  eval_name?: string;
  eval_type?: string;
  eval_status?: string;
  response_id?: string;
  ticket_id?: string;
  description?: string;
  user_message?: string;
  preferred_output?: string;
  non_preferred_output?: string;
  reason_type?: string;
  customer_impact?: string;
  metadata?: Record<string, unknown>;
}

type DatasetRecord = Record<string, unknown>;

export interface DatasetArtifact {
  basename: string;
  entries: DatasetRecord[];
  format: FinetuneDatasetFormat;
  method: FinetuneMethod;
}

export interface DatasetBuildResult {
  artifacts: DatasetArtifact[];
  dpoSourceCount: number;
  sftSourceCount: number;
  statusCounts: Record<string, number>;
  totalCount: number;
}

export interface DatasetValidationIssue {
  line?: number;
  message: string;
}

export interface DatasetValidationResult {
  detectedFormat: FinetuneDatasetFormat | 'mixed' | 'unknown';
  invalidCount: number;
  issues: DatasetValidationIssue[];
  mode: 'jsonl' | 'json-array' | 'unknown';
  totalCount: number;
  validCount: number;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeStatus(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function includesStatus(record: FinetuneEvalRecord, requestedStatus: string): boolean {
  if (!requestedStatus || requestedStatus === 'any') {
    return true;
  }
  return normalizeStatus(record.eval_status) === requestedStatus;
}

export function buildSystemPrompt(record: FinetuneEvalRecord): string {
  let prompt = 'You are a helpful customer service AI assistant.';
  const evalType = asNonEmptyString(record.eval_type);
  const reasonType = asNonEmptyString(record.reason_type);
  if (evalType || reasonType) {
    prompt += ` This is a ${evalType ?? 'general'} conversation`;
    if (reasonType) {
      prompt += ` focusing on improving ${reasonType.toLowerCase()} responses.`;
    } else {
      prompt += '.';
    }
  }
  return prompt;
}

function buildStudioInput(userMessage: string): DatasetRecord {
  return {
    messages: [{ role: 'user', content: userMessage }],
    tools: [],
    parallel_tool_calls: true,
  };
}

function buildOpenAiSftRecord(record: FinetuneEvalRecord): DatasetRecord {
  const userMessage = asNonEmptyString(record.user_message) ?? '';
  const preferred = asNonEmptyString(record.preferred_output) ?? '';
  return {
    messages: [
      { role: 'system', content: buildSystemPrompt(record) },
      { role: 'user', content: userMessage },
      { role: 'assistant', content: preferred },
    ],
  };
}

function buildStudioSftRecord(record: FinetuneEvalRecord): DatasetRecord {
  const userMessage = asNonEmptyString(record.user_message) ?? '';
  const preferred = asNonEmptyString(record.preferred_output) ?? '';
  return {
    input: buildStudioInput(userMessage),
    preferred_output: [{ role: 'assistant', content: preferred }],
  };
}

function buildTrlSftRecord(record: FinetuneEvalRecord): DatasetRecord {
  const userMessage = asNonEmptyString(record.user_message) ?? '';
  const preferred = asNonEmptyString(record.preferred_output) ?? '';
  return {
    text: `<|system|>\n${buildSystemPrompt(record)}\n<|user|>\n${userMessage}\n<|assistant|>\n${preferred}`,
    source: record.eval_name ?? 'StateSet Eval',
  };
}

function buildStudioDpoRecord(record: FinetuneEvalRecord): DatasetRecord {
  const userMessage = asNonEmptyString(record.user_message) ?? '';
  const preferred = asNonEmptyString(record.preferred_output) ?? '';
  const rejected = asNonEmptyString(record.non_preferred_output) ?? '';
  return {
    input: buildStudioInput(userMessage),
    preferred_output: [{ role: 'assistant', content: preferred }],
    non_preferred_output: [{ role: 'assistant', content: rejected }],
  };
}

function buildPairDpoRecord(record: FinetuneEvalRecord): DatasetRecord {
  return {
    prompt: asNonEmptyString(record.user_message) ?? '',
    chosen: asNonEmptyString(record.preferred_output) ?? '',
    rejected: asNonEmptyString(record.non_preferred_output) ?? '',
    metadata: {
      eval_id: record.id ?? null,
      eval_name: record.eval_name ?? null,
      eval_type: record.eval_type ?? null,
      reason_type: record.reason_type ?? null,
      customer_impact: record.customer_impact ?? null,
    },
  };
}

export function buildDatasetArtifacts(
  records: FinetuneEvalRecord[],
  options: { status?: string } = {},
): DatasetBuildResult {
  const statusFilter = normalizeStatus(options.status) || 'approved';
  const statusCounts: Record<string, number> = {};

  for (const record of records) {
    const status = normalizeStatus(record.eval_status) || 'unset';
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
  }

  const sftRecords = records.filter((record) => {
    if (!includesStatus(record, statusFilter)) {
      return false;
    }
    return Boolean(
      asNonEmptyString(record.user_message) && asNonEmptyString(record.preferred_output),
    );
  });
  const dpoRecords = sftRecords.filter((record) =>
    Boolean(asNonEmptyString(record.non_preferred_output)),
  );

  return {
    totalCount: records.length,
    statusCounts,
    sftSourceCount: sftRecords.length,
    dpoSourceCount: dpoRecords.length,
    artifacts: [
      {
        basename: 'sft-openai',
        format: 'openai-sft',
        method: 'supervised',
        entries: sftRecords.map(buildOpenAiSftRecord),
      },
      {
        basename: 'sft-studio',
        format: 'studio-sft',
        method: 'supervised',
        entries: sftRecords.map(buildStudioSftRecord),
      },
      {
        basename: 'sft-trl',
        format: 'trl-sft',
        method: 'supervised',
        entries: sftRecords.map(buildTrlSftRecord),
      },
      {
        basename: 'dpo-studio',
        format: 'studio-dpo',
        method: 'dpo',
        entries: dpoRecords.map(buildStudioDpoRecord),
      },
      {
        basename: 'dpo-pairs',
        format: 'pair-dpo',
        method: 'dpo',
        entries: dpoRecords.map(buildPairDpoRecord),
      },
    ],
  };
}

export function serializeJsonl(entries: DatasetRecord[]): string {
  return `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
}

function stableHash(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash >>> 0;
}

export function splitDatasetEntries(
  entries: DatasetRecord[],
  validationRatio: number,
): { train: DatasetRecord[]; validation: DatasetRecord[] } {
  if (!(validationRatio > 0)) {
    return { train: [...entries], validation: [] };
  }

  const train: DatasetRecord[] = [];
  const validation: DatasetRecord[] = [];
  for (const entry of entries) {
    const key = JSON.stringify(entry);
    const bucket = (stableHash(key) % 10000) / 10000;
    if (bucket < validationRatio) {
      validation.push(entry);
    } else {
      train.push(entry);
    }
  }
  return { train, validation };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDatasetText(text: string): {
  issues: DatasetValidationIssue[];
  mode: 'jsonl' | 'json-array' | 'unknown';
  records: unknown[];
} {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      mode: 'unknown',
      records: [],
      issues: [{ message: 'Dataset is empty.' }],
    };
  }

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        return {
          mode: 'json-array',
          records: [],
          issues: [{ message: 'Top-level JSON value must be an array.' }],
        };
      }
      return {
        mode: 'json-array',
        records: parsed,
        issues: [
          {
            message:
              'Parsed a JSON array. Convert to JSONL before upload if your trainer requires JSONL.',
          },
        ],
      };
    } catch (error) {
      return {
        mode: 'json-array',
        records: [],
        issues: [
          {
            message: `Could not parse JSON array: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  const issues: DatasetValidationIssue[] = [];
  const records: unknown[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      return;
    }
    try {
      records.push(JSON.parse(trimmedLine));
    } catch (error) {
      issues.push({
        line: index + 1,
        message: `Could not parse JSON object: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });
  return { mode: 'jsonl', records, issues };
}

function detectDatasetFormat(record: unknown): FinetuneDatasetFormat | 'unknown' {
  if (!isRecord(record)) {
    return 'unknown';
  }
  if (Array.isArray(record.messages)) {
    return 'openai-sft';
  }
  if (typeof record.text === 'string') {
    return 'trl-sft';
  }
  if (
    isRecord(record.input) &&
    Array.isArray(record.input.messages) &&
    Array.isArray(record.preferred_output) &&
    Array.isArray(record.non_preferred_output)
  ) {
    return 'studio-dpo';
  }
  if (
    isRecord(record.input) &&
    Array.isArray(record.input.messages) &&
    Array.isArray(record.preferred_output)
  ) {
    return 'studio-sft';
  }
  if (
    typeof record.prompt === 'string' &&
    typeof record.chosen === 'string' &&
    typeof record.rejected === 'string'
  ) {
    return 'pair-dpo';
  }
  return 'unknown';
}

function validateMessageArray(
  value: unknown,
  label: string,
  issues: DatasetValidationIssue[],
): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ message: `${label} must be a non-empty message array.` });
    return;
  }
  value.forEach((message, index) => {
    if (!isRecord(message)) {
      issues.push({ message: `${label}[${index}] must be an object.` });
      return;
    }
    if (typeof message.role !== 'string' || !message.role.trim()) {
      issues.push({ message: `${label}[${index}].role must be a non-empty string.` });
    }
    if (typeof message.content !== 'string' || !message.content.trim()) {
      issues.push({ message: `${label}[${index}].content must be a non-empty string.` });
    }
  });
}

function validateRecordByFormat(
  record: unknown,
  format: FinetuneDatasetFormat | 'unknown',
): DatasetValidationIssue[] {
  const issues: DatasetValidationIssue[] = [];
  if (!isRecord(record)) {
    return [{ message: 'Record must be a JSON object.' }];
  }

  if (format === 'openai-sft') {
    validateMessageArray(record.messages, 'messages', issues);
    return issues;
  }

  if (format === 'studio-sft') {
    if (!isRecord(record.input)) {
      issues.push({ message: 'input must be an object.' });
    } else {
      validateMessageArray(record.input.messages, 'input.messages', issues);
      if (!Array.isArray(record.input.tools)) {
        issues.push({ message: 'input.tools must be an array.' });
      }
      if (typeof record.input.parallel_tool_calls !== 'boolean') {
        issues.push({ message: 'input.parallel_tool_calls must be a boolean.' });
      }
    }
    validateMessageArray(record.preferred_output, 'preferred_output', issues);
    return issues;
  }

  if (format === 'studio-dpo') {
    if (!isRecord(record.input)) {
      issues.push({ message: 'input must be an object.' });
    } else {
      validateMessageArray(record.input.messages, 'input.messages', issues);
      if (!Array.isArray(record.input.tools)) {
        issues.push({ message: 'input.tools must be an array.' });
      }
      if (typeof record.input.parallel_tool_calls !== 'boolean') {
        issues.push({ message: 'input.parallel_tool_calls must be a boolean.' });
      }
    }
    validateMessageArray(record.preferred_output, 'preferred_output', issues);
    validateMessageArray(record.non_preferred_output, 'non_preferred_output', issues);
    return issues;
  }

  if (format === 'trl-sft') {
    if (typeof record.text !== 'string' || !record.text.trim()) {
      issues.push({ message: 'text must be a non-empty string.' });
    }
    return issues;
  }

  if (format === 'pair-dpo') {
    if (typeof record.prompt !== 'string' || !record.prompt.trim()) {
      issues.push({ message: 'prompt must be a non-empty string.' });
    }
    if (typeof record.chosen !== 'string' || !record.chosen.trim()) {
      issues.push({ message: 'chosen must be a non-empty string.' });
    }
    if (typeof record.rejected !== 'string' || !record.rejected.trim()) {
      issues.push({ message: 'rejected must be a non-empty string.' });
    }
    return issues;
  }

  issues.push({ message: 'Could not detect a supported dataset format.' });
  return issues;
}

export function validateDatasetText(
  text: string,
  expectedFormat?: FinetuneDatasetFormat | 'auto',
): DatasetValidationResult {
  const parsed = parseDatasetText(text);
  const allIssues = [...parsed.issues];
  const detectedFormats = new Set<FinetuneDatasetFormat | 'unknown'>();
  let validCount = 0;
  let invalidCount = 0;

  parsed.records.forEach((record, index) => {
    const recordFormat = detectDatasetFormat(record);
    detectedFormats.add(recordFormat);
    const targetFormat =
      expectedFormat && expectedFormat !== 'auto' ? expectedFormat : recordFormat;
    if (
      expectedFormat &&
      expectedFormat !== 'auto' &&
      recordFormat !== 'unknown' &&
      recordFormat !== expectedFormat
    ) {
      allIssues.push({
        line: parsed.mode === 'jsonl' ? index + 1 : undefined,
        message: `Record format ${recordFormat} does not match expected ${expectedFormat}.`,
      });
      invalidCount += 1;
      return;
    }
    const issues = validateRecordByFormat(record, targetFormat);
    if (issues.length > 0) {
      invalidCount += 1;
      for (const issue of issues) {
        allIssues.push({
          line: parsed.mode === 'jsonl' ? index + 1 : undefined,
          message: issue.message,
        });
      }
      return;
    }
    validCount += 1;
  });

  const distinctFormats = Array.from(detectedFormats).filter(
    (value): value is FinetuneDatasetFormat => value !== 'unknown',
  );
  const detectedFormat =
    distinctFormats.length === 1
      ? distinctFormats[0]
      : distinctFormats.length > 1
        ? 'mixed'
        : 'unknown';

  return {
    mode: parsed.mode,
    totalCount: parsed.records.length,
    validCount,
    invalidCount,
    issues: allIssues,
    detectedFormat,
  };
}

export function inferFinetuneMethod(
  format: FinetuneDatasetFormat | 'mixed' | 'unknown',
): FinetuneMethod | undefined {
  if (format === 'studio-dpo' || format === 'pair-dpo') {
    return 'dpo';
  }
  if (format === 'openai-sft' || format === 'studio-sft' || format === 'trl-sft') {
    return 'supervised';
  }
  return undefined;
}
