import path from 'node:path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import type { ShortcutLogger, ShortcutRunner, TopLevelOptions } from './types.js';
import { FETCH_ALL_LIMIT } from './types.js';
import {
  toLines,
  parseListArgs,
  asStringRecord,
  asRecordArray,
  printPayload,
  buildTopLevelLogger,
  withAgentRunner,
  resolveSafeOutputPath,
  writePrivateTextFile,
} from './utils.js';
import { getErrorMessage } from '../../lib/errors.js';

function readFirstOption(options: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    const value = options[name];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function buildEvalPayload(options: Record<string, string>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const fieldMap: Array<[string, string[]]> = [
    ['eval_name', ['name', 'eval-name', 'eval_name']],
    ['eval_type', ['type', 'eval-type', 'eval_type']],
    ['eval_status', ['status', 'eval-status', 'eval_status']],
    ['response_id', ['response', 'response-id', 'response_id']],
    ['ticket_id', ['ticket', 'ticket-id', 'ticket_id']],
    ['description', ['description']],
    ['user_message', ['message', 'user-message', 'user_message']],
    ['preferred_output', ['preferred', 'preferred-output', 'preferred_output']],
    ['non_preferred_output', ['rejected', 'non-preferred-output', 'non_preferred_output']],
    ['reason_type', ['reason', 'reason-type', 'reason_type']],
    ['customer_impact', ['impact', 'customer-impact', 'customer_impact']],
  ];

  for (const [target, names] of fieldMap) {
    const value = readFirstOption(options, names);
    if (value !== undefined) {
      payload[target] = value;
    }
  }

  return payload;
}

function buildEvalPayloadFromResponse(
  responseId: string,
  responseRow: Record<string, unknown>,
  options: Record<string, string>,
): Record<string, unknown> {
  const payload = buildEvalPayload(options);
  const customerMessage = String(responseRow.customer_message ?? '').trim();
  const agentResponse = String(responseRow.agent_response ?? '').trim();
  const channel = String(responseRow.channel ?? '').trim();
  const ticketId = String(responseRow.ticket_id ?? '').trim();
  const seedMode = readFirstOption(options, ['seed']) ?? 'rejected';

  payload.response_id = responseId;
  payload.eval_name ??= `Response Review ${responseId}`;
  payload.eval_type ??= 'quality';
  payload.eval_status ??= 'pending';
  payload.description ??= [
    `Seeded from response ${responseId}.`,
    channel ? `Channel: ${channel}.` : '',
    ticketId ? `Ticket: ${ticketId}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  payload.user_message ??= customerMessage;
  payload.ticket_id ??= ticketId || undefined;

  if (seedMode === 'preferred' && agentResponse) {
    payload.preferred_output ??= agentResponse;
  }
  if (seedMode === 'rejected' && agentResponse) {
    payload.non_preferred_output ??= agentResponse;
  }

  return payload;
}

function printSuccess(message: string): void {
  console.log(chalk.green(`  ✓ ${message}`));
}

function printInfo(message: string): void {
  console.log(chalk.gray(`  ${message}`));
}

function normalizeEvalStatus(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function filterEvalRows(
  rows: Array<Record<string, unknown>>,
  options: { status?: string; evalId?: string } = {},
): Array<Record<string, unknown>> {
  const status = normalizeEvalStatus(options.status);
  return rows.filter((row) => {
    const rowId = String(row.id ?? '').trim();
    if (options.evalId && rowId !== options.evalId) {
      return false;
    }
    if (status && normalizeEvalStatus(row.eval_status) !== status) {
      return false;
    }
    return true;
  });
}

function printEvalReviewCard(evalRow: Record<string, unknown>): void {
  const id = String(evalRow.id ?? '-');
  const name = String(evalRow.eval_name ?? '-');
  const type = String(evalRow.eval_type ?? '-');
  const status = String(evalRow.eval_status ?? '-');
  const ticketId = String(evalRow.ticket_id ?? '-');
  const createdAt = String(evalRow.created_at ?? '-');
  const userMessage = String(evalRow.user_message ?? '').trim() || '-';
  const preferred = String(evalRow.preferred_output ?? '').trim() || '-';
  const rejected = String(evalRow.non_preferred_output ?? '').trim() || '-';

  console.log('');
  console.log(chalk.bold(`  Eval ${id}`));
  console.log(chalk.gray(`  Name: ${name}`));
  console.log(chalk.gray(`  Type: ${type}`));
  console.log(chalk.gray(`  Status: ${status}`));
  console.log(chalk.gray(`  Ticket: ${ticketId}`));
  console.log(chalk.gray(`  Created: ${createdAt}`));
  console.log(chalk.white('  User message:'));
  console.log(chalk.gray(`    ${userMessage}`));
  console.log(chalk.white('  Preferred output:'));
  console.log(chalk.gray(`    ${preferred}`));
  console.log(chalk.white('  Rejected output:'));
  console.log(chalk.gray(`    ${rejected}`));
}

async function runEvalsReview(
  runner: ShortcutRunner,
  logger: ShortcutLogger,
  options: Record<string, string>,
  evalId?: string,
): Promise<void> {
  const statusFilter = readFirstOption(options, ['status']) ?? (evalId ? undefined : 'pending');
  const list = await runner.callTool<unknown[]>('list_evals', {
    limit: FETCH_ALL_LIMIT,
    offset: 0,
  });
  const rows = filterEvalRows(asRecordArray(list.payload), {
    status: statusFilter,
    evalId,
  });

  if (rows.length === 0) {
    logger.warning(
      evalId
        ? `Eval "${evalId}" not found.`
        : `No evals matched${statusFilter ? ` status "${statusFilter}"` : ''}.`,
    );
    return;
  }

  let approved = 0;
  let rejected = 0;
  let edited = 0;
  let skipped = 0;

  for (const evalRow of rows) {
    printEvalReviewCard(evalRow);
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Review action:',
        choices: [
          { name: 'Approve', value: 'approve' },
          { name: 'Reject', value: 'reject' },
          { name: 'Edit fields', value: 'edit' },
          { name: 'Skip', value: 'skip' },
          { name: 'Quit review', value: 'quit' },
        ],
      },
    ]);

    const targetId = String(evalRow.id ?? '').trim();
    if (action === 'quit') {
      break;
    }
    if (action === 'skip') {
      skipped++;
      continue;
    }
    if (action === 'approve') {
      const updatePayload: Record<string, unknown> = {
        id: targetId,
        eval_status: 'approved',
      };
      if (!String(evalRow.preferred_output ?? '').trim()) {
        const { preferredOutput } = await inquirer.prompt([
          {
            type: 'input',
            name: 'preferredOutput',
            message: 'Preferred output:',
            validate: (value: string) => (value.trim().length > 0 ? true : 'Required'),
          },
        ]);
        updatePayload.preferred_output = String(preferredOutput).trim();
      }
      await runner.callTool('update_eval', updatePayload);
      approved++;
      logger.success(`Approved eval ${targetId}`);
      continue;
    }
    if (action === 'reject') {
      await runner.callTool('update_eval', {
        id: targetId,
        eval_status: 'rejected',
      });
      rejected++;
      logger.success(`Rejected eval ${targetId}`);
      continue;
    }

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'status',
        message: 'Status:',
        default: String(evalRow.eval_status ?? 'pending'),
      },
      {
        type: 'input',
        name: 'preferredOutput',
        message: 'Preferred output:',
        default: String(evalRow.preferred_output ?? ''),
      },
      {
        type: 'input',
        name: 'rejectedOutput',
        message: 'Rejected output:',
        default: String(evalRow.non_preferred_output ?? ''),
      },
      {
        type: 'input',
        name: 'reasonType',
        message: 'Reason type:',
        default: String(evalRow.reason_type ?? ''),
      },
      {
        type: 'input',
        name: 'customerImpact',
        message: 'Customer impact:',
        default: String(evalRow.customer_impact ?? ''),
      },
    ]);

    await runner.callTool('update_eval', {
      id: targetId,
      eval_status: String(answers.status ?? '').trim() || undefined,
      preferred_output: String(answers.preferredOutput ?? ''),
      non_preferred_output: String(answers.rejectedOutput ?? ''),
      reason_type: String(answers.reasonType ?? ''),
      customer_impact: String(answers.customerImpact ?? ''),
    });
    edited++;
    logger.success(`Updated eval ${targetId}`);
  }

  logger.success(
    `Review complete: approved=${approved} rejected=${rejected} edited=${edited} skipped=${skipped}`,
  );
}

export async function runEvalsSuggestFlow(runner: ShortcutRunner): Promise<void> {
  console.log('');
  console.log(chalk.bold('  Eval Suggestions'));
  console.log(chalk.gray('  ─'.repeat(24)));

  printInfo('Analyzing recent responses to suggest evaluation criteria...');

  try {
    await runner.callTool('list_responses', { limit: 50 });
  } catch {
    console.log(chalk.yellow('  Could not fetch recent responses. Falling back to defaults.'));
  }

  const suggestions = [
    {
      name: 'Accuracy',
      description: 'Response correctly addresses the customer question using factual information',
      criteria: 'Check if response matches order data, policies, and KB content',
      weight: 5,
    },
    {
      name: 'Tone & Empathy',
      description: 'Response is professional, empathetic, and brand-appropriate',
      criteria: 'Assess warmth, professionalism, and emotional awareness',
      weight: 4,
    },
    {
      name: 'Completeness',
      description: 'Response fully resolves the customer issue without follow-up needed',
      criteria: 'Check if all parts of the question are addressed and next steps are clear',
      weight: 5,
    },
    {
      name: 'Hallucination Detection',
      description: 'Response does not contain fabricated information',
      criteria: 'Verify all claims against KB, order data, and policies',
      weight: 5,
    },
    {
      name: 'Tool Usage',
      description: 'Agent correctly used available tools (order lookup, KB search)',
      criteria: 'Check if correct tools were called with right parameters',
      weight: 3,
    },
    {
      name: 'Escalation Judgment',
      description: 'Correctly identified when to escalate vs. handle autonomously',
      criteria: 'Review escalation decisions against policy guidelines',
      weight: 4,
    },
  ];

  console.log('');
  console.log(chalk.bold('  Suggested evaluation criteria:'));
  console.log('');

  for (const suggestion of suggestions) {
    console.log(chalk.white(`  ${suggestion.name} (weight: ${suggestion.weight}/5)`));
    console.log(chalk.gray(`    ${suggestion.description}`));
    console.log(chalk.gray(`    Criteria: ${suggestion.criteria}`));
    console.log('');
  }

  const { confirm } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'confirm',
      message: 'Select criteria to create as eval templates:',
      choices: suggestions.map((suggestion) => ({
        name: `${suggestion.name} — ${suggestion.description}`,
        value: suggestion.name,
        checked: true,
      })),
    },
  ]);

  const selected = suggestions.filter((suggestion) =>
    (confirm as string[]).includes(suggestion.name),
  );
  if (selected.length === 0) {
    printInfo('No eval criteria selected.');
    return;
  }

  let created = 0;
  for (const suggestion of selected) {
    try {
      await runner.callTool('create_eval', {
        eval_name: suggestion.name,
        eval_type: 'quality',
        description: suggestion.description,
      });
      created++;
    } catch {
      console.log(chalk.yellow(`  Warning: could not create eval "${suggestion.name}"`));
    }
  }

  printSuccess(`Created ${created} eval templates`);
  printInfo('Run /finetune export to generate training data from eval results.');
  console.log('');
}

export async function runEvalsCommand(
  tokens: string[],
  runner: ShortcutRunner,
  logger: ShortcutLogger,
  json = false,
): Promise<void> {
  const raw = toLines(tokens);
  const { limit, offset, options, positionals } = parseListArgs(raw);
  const action = positionals[0]?.toLowerCase() || null;
  const statusFilter = readFirstOption(options, ['status']);

  if (!action || action === 'list') {
    const result = await runner.callTool('list_evals', {
      limit: statusFilter ? FETCH_ALL_LIMIT : limit,
      offset: statusFilter ? 0 : offset,
    });
    const payload = statusFilter
      ? filterEvalRows(asRecordArray(result.payload), { status: statusFilter }).slice(
          offset,
          offset + limit,
        )
      : result.payload;
    printPayload(logger, 'Evals', payload, json);
    return;
  }

  if (action === 'suggest') {
    await runEvalsSuggestFlow(runner);
    return;
  }

  if (action === 'review') {
    await runEvalsReview(runner, logger, options, positionals[1]);
    return;
  }

  if (action === 'create-from-response' || action === 'from-response') {
    const responseId =
      positionals[1] ?? readFirstOption(options, ['response', 'response-id', 'response_id']);
    if (!responseId) {
      logger.warning(
        'Usage: /evals create-from-response <response-id> [--seed preferred|rejected|none]',
      );
      return;
    }
    const responseResult = await runner.callTool('get_response', { id: responseId });
    const responsePayload = asStringRecord(responseResult.payload);
    const userMessage = String(responsePayload.customer_message ?? '').trim();
    if (!userMessage) {
      logger.warning(`Response "${responseId}" is missing customer_message.`);
      return;
    }
    const payload = buildEvalPayloadFromResponse(responseId, responsePayload, options);
    const result = await runner.callTool('create_eval', payload);
    printPayload(logger, `Created eval from response ${responseId}`, result.payload, json);
    return;
  }

  if (action === 'create') {
    const payload = buildEvalPayload(options);
    if (!payload.eval_name || !payload.eval_type) {
      logger.warning(
        'Usage: /evals create --name <name> --type <type> [--status <status>] [--message <text>] [--preferred <text>]',
      );
      return;
    }
    const result = await runner.callTool('create_eval', payload);
    printPayload(logger, 'Created eval', result.payload, json);
    return;
  }

  if (action === 'update') {
    const evalId = positionals[1];
    if (!evalId) {
      logger.warning(
        'Usage: /evals update <eval-id> [--name <name>] [--status <status>] [--preferred <text>]',
      );
      return;
    }
    const payload = buildEvalPayload(options);
    if (Object.keys(payload).length === 0) {
      logger.warning('Provide at least one field to update.');
      return;
    }
    const result = await runner.callTool('update_eval', { id: evalId, ...payload });
    printPayload(logger, `Updated eval ${evalId}`, result.payload, json);
    return;
  }

  if (action === 'delete') {
    const evalId = positionals[1];
    if (!evalId) {
      logger.warning('Usage: /evals delete <eval-id>');
      return;
    }
    const result = await runner.callTool('delete_eval', { id: evalId });
    printPayload(logger, `Deleted eval ${evalId}`, result.payload, json);
    return;
  }

  if (action === 'export') {
    const outputFile = readFirstOption(options, ['out']);
    const evalIds = positionals.slice(1).filter(Boolean);
    const result = await runner.callTool('export_evals_for_finetuning', {
      eval_ids: evalIds.length > 0 ? evalIds : undefined,
    });
    if (outputFile) {
      try {
        const outputPath = resolveSafeOutputPath(path.resolve(outputFile), {
          label: 'Evals export path',
        });
        writePrivateTextFile(outputPath, JSON.stringify(result.payload, null, 2), {
          label: 'Evals export path',
        });
        logger.success(`Evals exported to ${outputPath}`);
      } catch (error) {
        logger.error(`Failed to write export file: ${getErrorMessage(error)}`);
      }
    } else {
      printPayload(logger, 'Evals export', result.payload, json);
    }
    return;
  }

  if (action === 'get') {
    const evalId = positionals[1];
    if (!evalId) {
      logger.warning('Usage: /evals get <eval-id>');
      return;
    }
    const list = await runner.callTool<unknown[]>('list_evals', {
      limit: FETCH_ALL_LIMIT,
      offset: 0,
    });
    const rows = asRecordArray(list.payload);
    const target = rows.find((entry) => String(entry.id ?? '').trim() === evalId);
    if (!target) {
      logger.warning(`Eval "${evalId}" not found. Use /evals list to browse IDs.`);
      return;
    }
    printPayload(logger, `Eval ${evalId}`, target, json);
    return;
  }

  const targetId = action;
  const list = await runner.callTool<unknown[]>('list_evals', {
    limit: FETCH_ALL_LIMIT,
    offset: 0,
  });
  const rows = asRecordArray(list.payload);
  const target = rows.find((entry) => String(entry.id ?? '').trim() === targetId);
  if (!target) {
    logger.warning(`Eval "${targetId}" not found. Use /evals list to browse IDs.`);
    return;
  }
  printPayload(logger, `Eval ${targetId}`, asStringRecord(target), json);
}

export async function runTopLevelEvals(
  args: string[] = [],
  options: TopLevelOptions = {},
): Promise<void> {
  const logger = buildTopLevelLogger();
  await withAgentRunner(async (runner) => {
    await runEvalsCommand(args, runner, logger, Boolean(options.json));
  });
}
