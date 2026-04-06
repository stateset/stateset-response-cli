import { Command } from 'commander';
import type { ChatContext } from './types.js';
import {
  parseCommandArgs,
  parseTopLevelOptionsFromSlashArgs,
  parsePeriodRangeAsIso,
  parseNonNegativeIntegerOption,
  parsePositiveIntegerOption,
  toLines,
  buildSlashLogger,
  addCommonJsonOption,
} from './shortcuts/utils.js';
import { formatError } from '../utils/display.js';
import { getErrorMessage } from '../lib/errors.js';

import { runRulesCommand, runTopLevelRules } from './shortcuts/rules.js';
import { runEvalsCommand, runTopLevelEvals } from './shortcuts/evals.js';
import { runDatasetsCommand, runTopLevelDatasets } from './shortcuts/datasets.js';
import { runKnowledgeBaseCommand, runTopLevelKb } from './shortcuts/knowledge-base.js';
import { runAgentsCommand, runTopLevelAgents } from './shortcuts/agents.js';
import {
  runChannelsCommand,
  runConvosCommand,
  runMessagesCommand,
  runResponsesCommand,
  runTopLevelChannels,
  runTopLevelConvos,
  runTopLevelMessages,
  runTopLevelResponses,
} from './shortcuts/resources.js';
import {
  runStatusCommand,
  runAnalyticsCommand,
  runTopLevelStatus,
  runTopLevelStats,
  runTopLevelAnalytics,
} from './shortcuts/analytics.js';
import {
  runSnapshotCommand,
  runDiffCommand,
  runDeploymentsCommand,
  runBulkCommand,
  runTopLevelDeploy,
  runTopLevelRollback,
  runTopLevelDeployments,
  runTopLevelDiff,
  runTopLevelPull,
  runTopLevelPush,
  runTopLevelValidate,
  runTopLevelBulk,
  runTopLevelWatch,
} from './shortcuts/deployments.js';
import { runTopLevelReplay } from './shortcuts/replay.js';
import { runTopLevelSync } from './shortcuts/sync.js';
import { runTopLevelLogs } from './shortcuts/logs.js';
import {
  runWebhooksCommand,
  runAlertsCommand,
  runMonitorCommand,
  runTopLevelWebhooks,
  runTopLevelAlerts,
  runTopLevelMonitor,
} from './shortcuts/monitoring.js';
import { runTestCommand, runTopLevelTest } from './shortcuts/test.js';
import { runDriftCommand } from './shortcuts/drift.js';
import { runTopLevelFinetune } from './commands-finetune.js';

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
    if (command === '/evals') {
      await runEvalsCommand(
        tokens,
        { callTool: ctx.agent.callTool.bind(ctx.agent) },
        logger,
        slashOptions.json,
      );
      logger.done();
      return { handled: true };
    }
    if (command === '/datasets') {
      await runDatasetsCommand(
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
      await runSnapshotCommand(actionArgs, slashOptions);
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
      await runTestCommand(remaining, logger, slashOptions.json, { agentId });
      logger.done();
      return { handled: true };
    }
    if (command === '/diff') {
      await runDiffCommand(tokens, logger, slashOptions);
      logger.done();
      return { handled: true };
    }
    if (command === '/drift') {
      await runDriftCommand(ctx.agent.callTool.bind(ctx.agent), logger, Boolean(slashOptions.json));
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
      const deploymentOptions: {
        mode?: string;
        status?: string;
        limit?: string;
        offset?: string;
        from?: string;
        dryRun?: boolean;
        yes?: boolean;
        strict?: boolean;
        includeSecrets?: boolean;
      } = {
        mode: parsedArgs.options.mode,
        status: parsedArgs.options.status,
        limit: parsedArgs.options.limit,
      };
      if (parsedArgs.options.offset !== undefined) {
        deploymentOptions.offset = parsedArgs.options.offset;
      }
      if (slashOptions.from) deploymentOptions.from = slashOptions.from;
      if (slashOptions.dryRun !== undefined) deploymentOptions.dryRun = slashOptions.dryRun;
      if (slashOptions.yes !== undefined) deploymentOptions.yes = slashOptions.yes;
      if (slashOptions.strict !== undefined) deploymentOptions.strict = slashOptions.strict;
      if (slashOptions.includeSecrets !== undefined) {
        deploymentOptions.includeSecrets = slashOptions.includeSecrets;
      }
      await runDeploymentsCommand(tokens, logger, slashOptions.json, {
        ...deploymentOptions,
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
    logger.error(getErrorMessage(error));
    logger.done();
    return { handled: true };
  }

  return { handled: false };
}

export function registerShortcutTopLevelCommands(program: Command): void {
  const rules = program
    .command('rules')
    .description('Manage rules with direct MCP shortcuts')
    .argument(
      '[args...]',
      'Rules command: get|list|create|toggle|enable|disable|delete|import|export|agent|<id>',
    )
    .option('--tag <tag>', 'Filter rules by tag for bulk enable/disable')
    .option('--agent <agent-id>', 'Filter rules by agent ID for bulk enable/disable')
    .option('--all', 'Apply to all rules for bulk enable/disable')
    .action(
      async (
        args: string[],
        opts: { json?: boolean; tag?: string; agent?: string; all?: boolean },
      ) => {
        try {
          const forwarded = [...args];
          if (opts.tag) forwarded.push('--tag', opts.tag);
          if (opts.agent) forwarded.push('--agent', opts.agent);
          if (opts.all) forwarded.push('--all');
          await runTopLevelRules(forwarded, { json: opts.json });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exitCode = 1;
          }
          throw error;
        }
      },
    );
  addCommonJsonOption(rules, 'rules');

  const evals = program
    .command('evals')
    .description('Manage evals with direct MCP shortcuts')
    .argument(
      '[args...]',
      'Evals command: list|create|create-from-response|get|update|delete|export|review|suggest|<id>',
    )
    .option('--limit <n>', 'Limit the number of evals returned')
    .option('--offset <n>', 'Offset for paginated eval listing')
    .option('--status <status>', 'Filter evals by status')
    .option('--name <name>', 'Eval name')
    .option('--type <type>', 'Eval type')
    .option('--status <status>', 'Eval status')
    .option('--response-id <id>', 'Associated response ID')
    .option('--ticket-id <id>', 'Associated ticket ID')
    .option('--description <text>', 'Eval description')
    .option('--message <text>', 'User message')
    .option('--preferred <text>', 'Preferred output')
    .option('--rejected <text>', 'Non-preferred output')
    .option('--reason <text>', 'Reason type')
    .option('--impact <text>', 'Customer impact')
    .option(
      '--seed <mode>',
      'For create-from-response, seed agent output into preferred|rejected|none fields',
    )
    .option('--out <path>', 'Write exported evals to a file')
    .action(
      async (
        args: string[],
        opts: {
          json?: boolean;
          limit?: string;
          offset?: string;
          status?: string;
          name?: string;
          type?: string;
          responseId?: string;
          ticketId?: string;
          description?: string;
          message?: string;
          preferred?: string;
          rejected?: string;
          reason?: string;
          impact?: string;
          seed?: string;
          out?: string;
        },
      ) => {
        try {
          const forwarded = [...args];
          if (opts.limit) forwarded.push('--limit', opts.limit);
          if (opts.offset) forwarded.push('--offset', opts.offset);
          if (opts.status) forwarded.push('--status', opts.status);
          if (opts.name) forwarded.push('--name', opts.name);
          if (opts.type) forwarded.push('--type', opts.type);
          if (opts.status) forwarded.push('--status', opts.status);
          if (opts.responseId) forwarded.push('--response-id', opts.responseId);
          if (opts.ticketId) forwarded.push('--ticket-id', opts.ticketId);
          if (opts.description) forwarded.push('--description', opts.description);
          if (opts.message) forwarded.push('--message', opts.message);
          if (opts.preferred) forwarded.push('--preferred', opts.preferred);
          if (opts.rejected) forwarded.push('--rejected', opts.rejected);
          if (opts.reason) forwarded.push('--reason', opts.reason);
          if (opts.impact) forwarded.push('--impact', opts.impact);
          if (opts.seed) forwarded.push('--seed', opts.seed);
          if (opts.out) forwarded.push('--out', opts.out);
          await runTopLevelEvals(forwarded, { json: opts.json });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exitCode = 1;
          }
          throw error;
        }
      },
    );
  addCommonJsonOption(evals, 'evals');

  const datasets = program
    .command('datasets')
    .description('Manage datasets and dataset entries for training-data curation')
    .argument(
      '[args...]',
      'Datasets command: list|create|get|update|delete|add-entry|update-entry|delete-entry|import|export|<id>',
    )
    .option('--limit <n>', 'Limit the number of datasets returned')
    .option('--offset <n>', 'Offset for paginated dataset listing')
    .option('--name <name>', 'Dataset name')
    .option('--description <text>', 'Dataset description')
    .option('--status <status>', 'Dataset status')
    .option('--metadata <json>', 'Dataset metadata JSON')
    .option('--messages <json>', 'Dataset entry messages JSON array')
    .option('--file <path>', 'JSON/JSONL file used for entry import or update')
    .option('--out <path>', 'Write exported dataset JSON to a file')
    .action(
      async (
        args: string[],
        opts: {
          json?: boolean;
          limit?: string;
          offset?: string;
          name?: string;
          description?: string;
          status?: string;
          metadata?: string;
          messages?: string;
          file?: string;
          out?: string;
        },
      ) => {
        try {
          const forwarded = [...args];
          if (opts.limit) forwarded.push('--limit', opts.limit);
          if (opts.offset) forwarded.push('--offset', opts.offset);
          if (opts.name) forwarded.push('--name', opts.name);
          if (opts.description) forwarded.push('--description', opts.description);
          if (opts.status) forwarded.push('--status', opts.status);
          if (opts.metadata) forwarded.push('--metadata', opts.metadata);
          if (opts.messages) forwarded.push('--messages', opts.messages);
          if (opts.file) forwarded.push('--file', opts.file);
          if (opts.out) forwarded.push('--out', opts.out);
          await runTopLevelDatasets(forwarded, { json: opts.json });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exitCode = 1;
          }
          throw error;
        }
      },
    );
  addCommonJsonOption(datasets, 'datasets');

  program
    .command('finetune')
    .description('Export, validate, and stage fine-tuning datasets')
    .argument('[args...]', 'Finetune command: list|export|validate|create|deploy')
    .option(
      '--format <format>',
      'Dataset format filter: all|sft|dpo|openai-sft|studio-sft|trl-sft|studio-dpo|pair-dpo',
    )
    .option('--status <status>', 'Eval status filter for export (default: approved)')
    .option('--validation-ratio <ratio>', 'Optional validation split ratio for export, such as 0.1')
    .option('--method <method>', 'Training method override for create: supervised|dpo')
    .action(
      async (
        args: string[],
        opts: {
          format?: string;
          status?: string;
          validationRatio?: string;
          method?: string;
        },
      ) => {
        try {
          const forwarded = [...args];
          if (opts.format) forwarded.push('--format', opts.format);
          if (opts.status) forwarded.push('--status', opts.status);
          if (opts.validationRatio) {
            forwarded.push('--validation-ratio', opts.validationRatio);
          }
          if (opts.method) forwarded.push('--method', opts.method);
          await runTopLevelFinetune(forwarded);
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exitCode = 1;
          }
          throw error;
        }
      },
    );

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
          process.exitCode = 1;
        }
        throw error;
      }
    });
  addCommonJsonOption(kb, 'kb');

  const agents = program
    .command('agents')
    .description('Manage agents')
    .argument('[args...]', 'Agents command: create|get|update|switch|export|import|bootstrap|<id>')
    .option('--all', 'Apply updates to all agents')
    .option('--model <model>', 'Update configured model on agent settings records')
    .option('--name <name>', 'Agent name')
    .option('--type <type>', 'Agent type')
    .option('--description <text>', 'Agent description')
    .option('--role <text>', 'Agent role')
    .option('--goal <text>', 'Agent goal')
    .option('--instructions <text>', 'Agent instructions')
    .option('--active <on|off>', 'Activation state')
    .option('--voice-model <name>', 'Voice model name')
    .option('--voice-model-id <id>', 'Voice model ID')
    .option('--voice-model-provider <provider>', 'Voice model provider')
    .action(
      async (
        args: string[],
        opts: {
          json?: boolean;
          all?: boolean;
          model?: string;
          name?: string;
          type?: string;
          description?: string;
          role?: string;
          goal?: string;
          instructions?: string;
          active?: string;
          voiceModel?: string;
          voiceModelId?: string;
          voiceModelProvider?: string;
        },
      ) => {
        try {
          const forwarded = [...args];
          if (opts.all) forwarded.push('--all');
          if (opts.model) forwarded.push('--model', opts.model);
          if (opts.name) forwarded.push('--name', opts.name);
          if (opts.type) forwarded.push('--type', opts.type);
          if (opts.description) forwarded.push('--description', opts.description);
          if (opts.role) forwarded.push('--role', opts.role);
          if (opts.goal) forwarded.push('--goal', opts.goal);
          if (opts.instructions) forwarded.push('--instructions', opts.instructions);
          if (opts.active) forwarded.push('--active', opts.active);
          if (opts.voiceModel) forwarded.push('--voice_model', opts.voiceModel);
          if (opts.voiceModelId) forwarded.push('--voice_model_id', opts.voiceModelId);
          if (opts.voiceModelProvider) {
            forwarded.push('--voice_model_provider', opts.voiceModelProvider);
          }
          await runTopLevelAgents(forwarded, { json: opts.json });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exitCode = 1;
          }
          throw error;
        }
      },
    );
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
          process.exitCode = 1;
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
          process.exitCode = 1;
        }
        throw error;
      }
    });
  addCommonJsonOption(convos, 'conversations');

  program
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
          process.exitCode = 1;
        }
        throw error;
      }
    });

  program
    .command('status')
    .description('Show quick platform status')
    .option('--json', 'Output counts as JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        await runTopLevelStatus(opts);
      } catch (error) {
        if (error instanceof Error) {
          console.error(formatError(error.message));
          process.exitCode = 1;
        }
        throw error;
      }
    });

  program
    .command('stats')
    .description('Show analytics summary')
    .argument('[args...]', 'Stats command: summary|agents|conversations|responses|quality')
    .option('--period <duration>', 'Filter window (supports 7d, 30d, 90d, etc.)')
    .option('--since <date>', 'Alias for --from (supports 7d, 2026-01-01, etc.)')
    .option('--from <date>', 'Filter start date (supports 7d, 2026-01-01, etc.)')
    .option('--to <date>', 'Filter end date')
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
          process.exitCode = 1;
          return;
        }

        if (opts.from && opts.period) {
          console.error(formatError('Use either --from or --period, not both.'));
          process.exitCode = 1;
          return;
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
            process.exitCode = 1;
          }
          throw error;
        }
      },
    );

  program
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
          process.exitCode = 1;
        }
        throw error;
      }
    });

  program
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
          process.exitCode = 1;
        }
        throw error;
      }
    });

  program
    .command('test')
    .description('Run a traced agent simulation without writing to a conversation')
    .argument('[message...]', 'Message to evaluate')
    .option('--agent <agent-id>', 'Target agent ID')
    .option('--mock <file>', 'Mock tool responses from a JSON file')
    .option('--context-file <file>', 'Append extra system context during simulation')
    .option('--allow-writes', 'Allow write-like tool calls during simulation')
    .option('--json', 'Output as JSON')
    .action(
      async (
        message: string[],
        opts: {
          agent?: string;
          mock?: string;
          contextFile?: string;
          allowWrites?: boolean;
          json?: boolean;
        },
      ) => {
        try {
          await runTopLevelTest(message, {
            json: opts.json,
            agent: opts.agent,
            mock: opts.mock,
            contextFile: opts.contextFile,
            allowWrites: opts.allowWrites,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exitCode = 1;
          }
          throw error;
        }
      },
    );

  program
    .command('replay')
    .description('Replay a conversation against traced agent execution')
    .argument('<conversation-id>', 'Conversation UUID')
    .option('--step-through', 'Show every customer turn instead of only the final turn')
    .option('--limit <n>', 'Max messages to load from the conversation')
    .option('--agent <agent-id>', 'Override the conversation agent ID')
    .option('--mock <file>', 'Mock tool responses from a JSON file')
    .option('--context-file <file>', 'Append extra system context during replay')
    .option('--allow-writes', 'Allow write-like tool calls during replay')
    .option('--json', 'Output as JSON')
    .action(
      async (
        conversationId: string,
        opts: {
          stepThrough?: boolean;
          limit?: string;
          agent?: string;
          mock?: string;
          contextFile?: string;
          allowWrites?: boolean;
          json?: boolean;
        },
      ) => {
        try {
          await runTopLevelReplay(conversationId, {
            json: opts.json,
            stepThrough: opts.stepThrough,
            limit: opts.limit,
            agentId: opts.agent,
            mock: opts.mock,
            contextFile: opts.contextFile,
            allowWrites: opts.allowWrites,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exitCode = 1;
          }
          throw error;
        }
      },
    );

  program
    .command('analytics')
    .description('Show platform analytics')
    .argument(
      '[args...]',
      'analytics command: summary|agents|conversations|responses|quality [options]',
    )
    .option('--period <duration>', 'Filter window (supports 7d, 30d, 90d, etc.)')
    .option('--since <date>', 'Alias for --from (supports 7d, 2026-01-01, etc.)')
    .option('--from <date>', 'Filter start date (supports 7d, 2026-01-01, etc.)')
    .option('--to <date>', 'Filter end date')
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
            process.exitCode = 1;
            return;
          }
          if (opts.from && opts.period) {
            console.error(formatError('Use either --from or --period, not both.'));
            process.exitCode = 1;
            return;
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
            process.exitCode = 1;
          }
          throw error;
        }
      },
    );

  program
    .command('diff')
    .description('Show configuration diff between snapshots')
    .argument('[refs...]', 'Diff refs: [from] [to]')
    .option('--from <snapshot>', 'Source snapshot')
    .option('--to <snapshot>', 'Target snapshot')
    .option('--remote', 'Compare local .stateset config against the deployed remote state')
    .option('--json', 'Output diff as JSON')
    .option('--include-secrets', 'Include secrets when exporting current snapshot')
    .action(
      async (
        args: string[],
        opts: {
          from?: string;
          to?: string;
          remote?: boolean;
          json?: boolean;
          includeSecrets?: boolean;
        },
      ) => {
        try {
          await runTopLevelDiff(args, {
            json: opts.json,
            from: opts.from,
            to: opts.to,
            remote: opts.remote,
            includeSecrets: opts.includeSecrets,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exitCode = 1;
          }
          throw error;
        }
      },
    );

  program
    .command('sync')
    .description('Show derived integration sync status')
    .argument('[args...]', 'sync command: status [integration-id]')
    .option('--json', 'Output as JSON')
    .action(async (args: string[], opts: { json?: boolean }) => {
      try {
        await runTopLevelSync(args, { json: opts.json });
      } catch (error) {
        if (error instanceof Error) {
          console.error(formatError(error.message));
          process.exitCode = 1;
        }
        throw error;
      }
    });

  program
    .command('logs')
    .description('Inspect or tail live agent activity from local session logs')
    .argument('[args...]', 'logs command')
    .option('--watch', 'Tail new events instead of printing recent history')
    .option('--filter <text>', 'Filter events by substring')
    .option('--limit <n>', 'Max events to show in non-watch mode')
    .option('--interval <seconds>', 'Polling interval for watch mode')
    .option('--count <n>', 'Stop after emitting n events in watch mode')
    .option('--session <id>', 'Restrict to one session ID')
    .option('--json', 'Output as JSON')
    .action(
      async (
        args: string[],
        opts: {
          watch?: boolean;
          filter?: string;
          limit?: string;
          interval?: string;
          count?: string;
          session?: string;
          json?: boolean;
        },
      ) => {
        try {
          await runTopLevelLogs(args, {
            json: opts.json,
            watch: opts.watch,
            filter: opts.filter,
            limit: opts.limit,
            interval: opts.interval,
            count: opts.count,
            session: opts.session,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exitCode = 1;
          }
          throw error;
        }
      },
    );

  program
    .command('webhooks')
    .description('Manage remote webhook subscriptions and delivery history')
    .argument('[args...]', 'Webhook command: list|get|create|update|deliveries|logs|delete')
    .option('--json', 'Output as JSON')
    .action(async (args: string[], opts: { json?: boolean }) => {
      try {
        await runTopLevelWebhooks(args, { json: opts.json });
      } catch (error) {
        if (error instanceof Error) {
          console.error(formatError(error.message));
          process.exitCode = 1;
        }
        throw error;
      }
    });

  program
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
          process.exitCode = 1;
        }
        throw error;
      }
    });

  program
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
            process.exitCode = 1;
          }
          throw error;
        }
      },
    );

  program
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
            process.exitCode = 1;
          }
          throw error;
        }
      },
    );

  program
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
            process.exitCode = 1;
          }
          throw error;
        }
      },
    );

  program
    .command('deployments')
    .description('Inspect deployment history')
    .argument(
      '[args...]',
      'Deployment command: list|get|status|approve|retry|reschedule|cancel|delete|<id>',
    )
    .option('--mode <mode>', 'Filter by mode (deploy|rollback)')
    .option('--status <status>', 'Filter by status (scheduled|approved|applied|failed|cancelled)')
    .option('--limit <n>', 'Max rows for list view')
    .option('--offset <n>', 'Rows to skip before applying --limit in list view')
    .option('--from <snapshot>', 'Override source when approving or retrying a deployment')
    .option('--dry-run', 'Show changes only when approving or retrying a deployment')
    .option('--yes', 'Apply changes without prompting when approving or retrying a deployment')
    .option(
      '--strict',
      'Fail fast if any import item fails when approving or retrying a deployment',
    )
    .option('--include-secrets', 'Include secrets when exporting current snapshot')
    .option('--schedule <datetime>', 'Schedule timestamp for deployment reschedule')
    .option('--json', 'Output as JSON')
    .action(
      async (
        args: string[],
        opts: {
          mode?: string;
          status?: string;
          limit?: string;
          offset?: string;
          from?: string;
          dryRun?: boolean;
          yes?: boolean;
          strict?: boolean;
          includeSecrets?: boolean;
          schedule?: string;
          json?: boolean;
        },
      ) => {
        try {
          const parsedLimit = opts.limit ? parsePositiveIntegerOption(opts.limit) : undefined;
          if (opts.limit && parsedLimit === undefined) {
            console.error(formatError('Invalid --limit value. Expected a positive integer.'));
            process.exitCode = 1;
            return;
          }
          const parsedOffset =
            opts.offset !== undefined ? parseNonNegativeIntegerOption(opts.offset) : undefined;
          if (opts.offset !== undefined && parsedOffset === undefined) {
            console.error(formatError('Invalid --offset value. Expected a non-negative integer.'));
            process.exitCode = 1;
            return;
          }
          await runTopLevelDeployments(args, {
            json: opts.json,
            mode: opts.mode,
            status: opts.status,
            limit: parsedLimit,
            offset: parsedOffset,
            from: opts.from,
            dryRun: opts.dryRun,
            yes: opts.yes,
            strict: opts.strict,
            includeSecrets: opts.includeSecrets,
            schedule: opts.schedule,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exitCode = 1;
          }
          throw error;
        }
      },
    );

  program
    .command('snapshot')
    .description('Manage local snapshots')
    .argument('[args...]', 'snapshot command: list|create <name>|show <ref>')
    .option('--out <path>', 'Output path for create')
    .option('--json', 'Output as JSON')
    .option('--include-secrets', 'Include secrets in snapshot export')
    .action(
      async (args: string[], opts: { out?: string; json?: boolean; includeSecrets?: boolean }) => {
        try {
          await runSnapshotCommand(args, {
            out: opts.out,
            json: opts.json,
            includeSecrets: opts.includeSecrets,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exitCode = 1;
          }
          throw error;
        }
      },
    );

  program
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
            process.exitCode = 1;
          }
          throw error;
        }
      },
    );

  program
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
            process.exitCode = 1;
          }
          throw error;
        }
      },
    );

  program
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
            process.exitCode = 1;
          }
          throw error;
        }
      },
    );

  program
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
            process.exitCode = 1;
          }
          throw error;
        }
      },
    );

  program
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
            process.exitCode = 1;
          }
          throw error;
        }
      },
    );

  program
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
            process.exitCode = 1;
          }
          throw error;
        }
      },
    );

  program
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
            process.exitCode = 1;
          }
          throw error;
        }
      },
    );
}
