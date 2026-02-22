import fs from 'node:fs';
import { requestText } from '../../integrations/http.js';
import type { ShortcutLogger, ShortcutRunner, TopLevelOptions } from './types.js';
import { readTextFile, MAX_TEXT_FILE_SIZE_BYTES } from '../../utils/file-read.js';
import {
  toLines,
  parseCommandArgs,
  stripQuotes,
  toPositiveInteger,
  printPayload,
  buildTopLevelLogger,
  withAgentRunner,
} from './utils.js';

export async function runKnowledgeBaseCommand(
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
        knowledge = await requestText(source).then((res) => res.text);
      } catch (error) {
        logger.error(
          `Unable to fetch URL: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
    } else if (fs.existsSync(source)) {
      try {
        knowledge = readTextFile(source, {
          label: 'knowledge base source',
          maxBytes: MAX_TEXT_FILE_SIZE_BYTES,
        });
      } catch (error) {
        logger.error(
          `Unable to read source file: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
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

export async function runTopLevelKb(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await withAgentRunner(async (runner) => {
    await runKnowledgeBaseCommand(args, runner, logger, Boolean(options.json));
  });
}
