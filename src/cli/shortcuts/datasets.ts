import fs from 'node:fs';
import path from 'node:path';
import type { ShortcutLogger, ShortcutRunner, TopLevelOptions } from './types.js';
import {
  parseListArgs,
  printPayload,
  buildTopLevelLogger,
  withAgentRunner,
  resolveSafeOutputPath,
  writePrivateTextFile,
} from './utils.js';
import { getErrorMessage } from '../../lib/errors.js';

interface DatasetMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface DatasetEntryInput {
  messages: DatasetMessage[];
}

function readFirstOption(options: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    const value = options[name];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function parseJsonValue(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid ${label} JSON: ${getErrorMessage(error)}`);
  }
}

function parseMetadataOption(options: Record<string, string>): Record<string, unknown> | undefined {
  const raw = readFirstOption(options, ['metadata']);
  if (!raw) {
    return undefined;
  }
  const parsed = parseJsonValue(raw, 'metadata');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Metadata must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function isDatasetMessage(value: unknown): value is DatasetMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    (record.role === 'system' || record.role === 'user' || record.role === 'assistant') &&
    typeof record.content === 'string'
  );
}

function normalizeMessages(value: unknown, label: string): DatasetMessage[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty JSON array of messages.`);
  }
  const messages = value.filter(isDatasetMessage);
  if (messages.length !== value.length) {
    throw new Error(`${label} messages must have role=system|user|assistant and string content.`);
  }
  return messages;
}

function loadJsonFile(filePath: string): unknown {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, 'utf-8');
  return JSON.parse(raw);
}

function parseMessagesInput(options: Record<string, string>): DatasetMessage[] {
  const inline = readFirstOption(options, ['messages']);
  if (inline) {
    return normalizeMessages(parseJsonValue(inline, 'messages'), 'Messages');
  }

  const sourceFile = readFirstOption(options, ['file']);
  if (!sourceFile) {
    throw new Error('Provide --messages <json> or --file <path>.');
  }

  const parsed = loadJsonFile(sourceFile);
  if (Array.isArray(parsed)) {
    return normalizeMessages(parsed, 'Messages');
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    return normalizeMessages(record.messages, 'Messages');
  }
  throw new Error(
    'Entry file must contain a messages array or an object with { "messages": [...] }.',
  );
}

function normalizeDatasetEntry(value: unknown, index: number): DatasetEntryInput {
  if (Array.isArray(value)) {
    return { messages: normalizeMessages(value, `Entry ${index + 1}`) };
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return { messages: normalizeMessages(record.messages, `Entry ${index + 1}`) };
  }
  throw new Error(`Entry ${index + 1} must be a messages array or an object with messages.`);
}

function parseImportEntries(sourceFile: string): DatasetEntryInput[] {
  const resolved = path.resolve(sourceFile);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, 'utf-8');

  let entries: unknown[];
  if (resolved.endsWith('.jsonl')) {
    entries = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch (error) {
          throw new Error(`Invalid JSONL on line ${index + 1}: ${getErrorMessage(error)}`);
        }
      });
  } else {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      entries = parsed;
    } else if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { entries?: unknown[] }).entries)
    ) {
      entries = (parsed as { entries: unknown[] }).entries;
    } else {
      throw new Error(
        'Import file must be a JSON array, JSONL file, or an object with an entries array.',
      );
    }
  }

  if (entries.length === 0) {
    throw new Error('Import file did not contain any dataset entries.');
  }

  return entries.map((entry, index) => normalizeDatasetEntry(entry, index));
}

function parseEntryId(raw: string | undefined): number | null {
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isInteger(value) || value < 1) {
    return null;
  }
  return value;
}

export async function runDatasetsCommand(
  tokens: string[],
  runner: ShortcutRunner,
  logger: ShortcutLogger,
  json = false,
): Promise<void> {
  const { limit, offset, options, positionals } = parseListArgs(tokens);
  const action = positionals[0]?.toLowerCase() || 'list';

  if (action === 'list') {
    const result = await runner.callTool('list_datasets', { limit, offset });
    printPayload(logger, 'Datasets', result.payload, json);
    return;
  }

  if (action === 'create') {
    const name = readFirstOption(options, ['name']);
    if (!name) {
      logger.warning(
        'Usage: /datasets create --name <name> [--description <text>] [--status active|archived|draft] [--metadata <json>]',
      );
      return;
    }
    try {
      const result = await runner.callTool('create_dataset', {
        name,
        description: readFirstOption(options, ['description']),
        status: readFirstOption(options, ['status']),
        metadata: parseMetadataOption(options),
      });
      printPayload(logger, 'Created dataset', result.payload, json);
    } catch (error) {
      logger.error(getErrorMessage(error));
    }
    return;
  }

  if (action === 'update') {
    const datasetId = positionals[1];
    if (!datasetId) {
      logger.warning(
        'Usage: /datasets update <dataset-id> [--name <name>] [--description <text>] [--status active|archived|draft] [--metadata <json>]',
      );
      return;
    }
    try {
      const payload: Record<string, unknown> = {
        id: datasetId,
      };
      const name = readFirstOption(options, ['name']);
      const description = readFirstOption(options, ['description']);
      const status = readFirstOption(options, ['status']);
      const metadata = parseMetadataOption(options);
      if (name !== undefined) payload.name = name;
      if (description !== undefined) payload.description = description;
      if (status !== undefined) payload.status = status;
      if (metadata !== undefined) payload.metadata = metadata;
      if (Object.keys(payload).length === 1) {
        logger.warning('Provide at least one field to update.');
        return;
      }
      const result = await runner.callTool('update_dataset', payload);
      printPayload(logger, `Updated dataset ${datasetId}`, result.payload, json);
    } catch (error) {
      logger.error(getErrorMessage(error));
    }
    return;
  }

  if (action === 'delete') {
    const datasetId = positionals[1];
    if (!datasetId) {
      logger.warning('Usage: /datasets delete <dataset-id>');
      return;
    }
    const result = await runner.callTool('delete_dataset', { id: datasetId });
    printPayload(logger, `Deleted dataset ${datasetId}`, result.payload, json);
    return;
  }

  if (action === 'get') {
    const datasetId = positionals[1];
    if (!datasetId) {
      logger.warning('Usage: /datasets get <dataset-id>');
      return;
    }
    const result = await runner.callTool('get_dataset', { id: datasetId });
    printPayload(logger, `Dataset ${datasetId}`, result.payload, json);
    return;
  }

  if (action === 'add-entry') {
    const datasetId = positionals[1];
    if (!datasetId) {
      logger.warning('Usage: /datasets add-entry <dataset-id> (--messages <json> | --file <path>)');
      return;
    }
    try {
      const messages = parseMessagesInput(options);
      const result = await runner.callTool('add_dataset_entry', {
        dataset_id: datasetId,
        messages,
      });
      printPayload(logger, `Added dataset entry to ${datasetId}`, result.payload, json);
    } catch (error) {
      logger.error(getErrorMessage(error));
    }
    return;
  }

  if (action === 'update-entry') {
    const entryId = parseEntryId(positionals[1]);
    if (!entryId) {
      logger.warning(
        'Usage: /datasets update-entry <entry-id> (--messages <json> | --file <path>)',
      );
      return;
    }
    try {
      const messages = parseMessagesInput(options);
      const result = await runner.callTool('update_dataset_entry', {
        id: entryId,
        messages,
      });
      printPayload(logger, `Updated dataset entry ${entryId}`, result.payload, json);
    } catch (error) {
      logger.error(getErrorMessage(error));
    }
    return;
  }

  if (action === 'delete-entry') {
    const entryId = parseEntryId(positionals[1]);
    if (!entryId) {
      logger.warning('Usage: /datasets delete-entry <entry-id>');
      return;
    }
    const result = await runner.callTool('delete_dataset_entry', { id: entryId });
    printPayload(logger, `Deleted dataset entry ${entryId}`, result.payload, json);
    return;
  }

  if (action === 'import') {
    const datasetId = positionals[1];
    const sourceFile = positionals[2] ?? readFirstOption(options, ['file']);
    if (!datasetId || !sourceFile) {
      logger.warning('Usage: /datasets import <dataset-id> <json|jsonl-file>');
      return;
    }
    try {
      const entries = parseImportEntries(sourceFile);
      const result = await runner.callTool('import_dataset_entries', {
        dataset_id: datasetId,
        entries,
      });
      printPayload(logger, `Imported dataset entries into ${datasetId}`, result.payload, json);
    } catch (error) {
      logger.error(getErrorMessage(error));
    }
    return;
  }

  if (action === 'export') {
    const datasetId = positionals[1];
    if (!datasetId) {
      logger.warning('Usage: /datasets export <dataset-id> [--out <path>]');
      return;
    }
    const result = await runner.callTool('get_dataset', { id: datasetId });
    const outputFile = readFirstOption(options, ['out']);
    if (!outputFile) {
      printPayload(logger, `Dataset ${datasetId}`, result.payload, json);
      return;
    }
    try {
      const outputPath = resolveSafeOutputPath(path.resolve(outputFile), {
        label: 'Dataset export path',
      });
      writePrivateTextFile(outputPath, JSON.stringify(result.payload, null, 2), {
        label: 'Dataset export path',
      });
      logger.success(`Dataset exported to ${outputPath}`);
    } catch (error) {
      logger.error(`Failed to write export file: ${getErrorMessage(error)}`);
    }
    return;
  }

  const datasetId = positionals[0];
  const result = await runner.callTool('get_dataset', { id: datasetId });
  printPayload(logger, `Dataset ${datasetId}`, result.payload, json);
}

export async function runTopLevelDatasets(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await withAgentRunner(async (runner) => {
    await runDatasetsCommand(args, runner, logger, Boolean(options.json));
  });
}
