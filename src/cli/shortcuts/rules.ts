import path from 'node:path';
import type { AnyPayload, ShortcutLogger, ShortcutRunner, TopLevelOptions } from './types.js';
import { FETCH_ALL_LIMIT } from './types.js';
import { readJsonFile } from '../../utils/file-read.js';
import { getErrorMessage } from '../../lib/errors.js';
import {
  toLines,
  parseListArgs,
  asStringRecord,
  printPayload,
  buildTopLevelLogger,
  withAgentRunner,
  resolveSafeOutputPath,
  writePrivateTextFile,
  parseToggleValue,
} from './utils.js';

function extractRuleTags(rule: Record<string, unknown>): string[] {
  const tags = Array.isArray(rule.tags)
    ? rule.tags
    : Array.isArray(asStringRecord(rule.metadata).tags)
      ? (asStringRecord(rule.metadata).tags as unknown[])
      : [];
  return tags
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export async function runRulesCommand(
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

  if (action === 'enable' || action === 'disable') {
    const targetState = action === 'enable';
    const tagFilter = (options.tag || options.tags || '').trim().toLowerCase();
    const agentFilter = (options.agent || options.agent_id || '').trim();
    const list = await runner.callTool<unknown[]>('list_rules', {
      limit: FETCH_ALL_LIMIT,
      offset: 0,
    });
    const rows = Array.isArray(list.payload) ? list.payload : [];
    const matches = rows
      .map((entry) => asStringRecord(entry))
      .filter((rule) => {
        if (agentFilter && String(rule.agent_id || '') !== agentFilter) {
          return false;
        }
        if (tagFilter) {
          return extractRuleTags(rule).includes(tagFilter);
        }
        return options.all === 'true' || options.all === '1' || positionals[1] === '--all';
      });

    if (!tagFilter && !agentFilter && options.all !== 'true' && options.all !== '1') {
      logger.warning(`Usage: /rules ${action} --tag <tag> | --agent <agent-id> | --all`);
      return;
    }
    if (matches.length === 0) {
      logger.warning(`No rules matched the ${action} filter.`);
      return;
    }
    const ids = matches.map((rule) => String(rule.id || '').trim()).filter((id) => id.length > 0);
    if (ids.length === 0) {
      logger.warning('No rule IDs available for matched rules.');
      return;
    }

    const result =
      ids.length === 1
        ? await runner.callTool('update_rule', { id: ids[0], activated: targetState })
        : await runner.callTool('bulk_update_rule_status', {
            ids,
            activated: targetState,
          });
    printPayload(
      logger,
      `${targetState ? 'Enabled' : 'Disabled'} ${ids.length} rule(s)`,
      result.payload,
      json,
    );
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
      const list = await runner.callTool<unknown[]>('list_rules', {
        limit: FETCH_ALL_LIMIT,
        offset: 0,
      });
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
    const list = await runner.callTool<unknown[]>('list_rules', {
      limit: FETCH_ALL_LIMIT,
      offset: 0,
    });
    const rows = list.payload as unknown[];
    const target = rows.find((entry) => asStringRecord(entry).id === ruleId);
    if (!target) {
      logger.warning(`Rule "${ruleId}" not found. Use /rules list to browse IDs.`);
      return;
    }
    printPayload(logger, `Rule ${ruleId}`, target as unknown as AnyPayload, json);
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
      parsed = readJsonFile(path.resolve(file), { label: 'rules import file' });
    } catch (error) {
      logger.error(`Unable to read rules import file: ${getErrorMessage(error)}`);
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
    const result = await runner.callTool('list_rules', { limit: FETCH_ALL_LIMIT, offset: 0 });
    if (outputFile) {
      try {
        const outputPath = resolveSafeOutputPath(outputFile, { label: 'Rules export path' });
        writePrivateTextFile(outputPath, JSON.stringify(result.payload, null, 2), {
          label: 'Rules export path',
        });
        logger.success(`Rules exported to ${outputPath}`);
      } catch (error) {
        logger.error(`Failed to write export file: ${getErrorMessage(error)}`);
      }
    } else {
      printPayload(logger, 'Rules export', result.payload, json);
    }
    return;
  }

  const targetId = action;
  const list = await runner.callTool<unknown[]>('list_rules', {
    limit: FETCH_ALL_LIMIT,
    offset: 0,
  });
  const rows = list.payload as unknown[];
  const target = rows.find((entry) => asStringRecord(entry).id === targetId);
  if (!target) {
    logger.warning(`Rule "${targetId}" not found. Use /rules list to browse IDs.`);
    return;
  }
  printPayload(logger, `Rule ${targetId}`, target as unknown as AnyPayload, json);
}

export async function runTopLevelRules(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await withAgentRunner(async (runner) => {
    await runRulesCommand(args, runner, logger, Boolean(options.json));
  });
}
