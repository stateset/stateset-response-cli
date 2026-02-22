import { Command } from 'commander';
import type { ChatContext } from './types.js';
import {
  parseCommandArgs,
  parseTopLevelOptionsFromSlashArgs,
  parsePeriodRangeAsIso,
  parsePositiveIntegerOption,
  toLines,
  buildSlashLogger,
  addCommonJsonOption,
} from './shortcuts/utils.js';
import { formatError } from '../utils/display.js';
import { getErrorMessage } from '../lib/errors.js';

import { runRulesCommand, runTopLevelRules } from './shortcuts/rules.js';
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
import {
  runWebhooksCommand,
  runAlertsCommand,
  runMonitorCommand,
  runTopLevelWebhooks,
  runTopLevelAlerts,
  runTopLevelMonitor,
} from './shortcuts/monitoring.js';
import { runTestCommand, runTopLevelTest } from './shortcuts/test.js';

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
      await runTestCommand(remaining, logger, slashOptions.json, agentId);
      logger.done();
      return { handled: true };
    }
    if (command === '/diff') {
      await runDiffCommand(tokens, logger, slashOptions);
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
      await runDeploymentsCommand(tokens, logger, slashOptions.json, {
        mode: parsedArgs.options.mode,
        status: parsedArgs.options.status,
        limit: parsedArgs.options.limit,
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
    .argument('[args...]', 'Rules command: get|list|create|toggle|delete|import|export|agent|<id>')
    .action(async (args: string[], opts: { json?: boolean }) => {
      try {
        await runTopLevelRules(args, opts);
      } catch (error) {
        if (error instanceof Error) {
          console.error(formatError(error.message));
          process.exit(1);
        }
        throw error;
      }
    });
  addCommonJsonOption(rules, 'rules');

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
          process.exit(1);
        }
        throw error;
      }
    });
  addCommonJsonOption(kb, 'kb');

  const agents = program
    .command('agents')
    .description('Manage agents')
    .argument('[args...]', 'Agents command: create|get|switch|export|import|bootstrap|<id>')
    .action(async (args: string[], opts: { json?: boolean }) => {
      try {
        await runTopLevelAgents(args, opts);
      } catch (error) {
        if (error instanceof Error) {
          console.error(formatError(error.message));
          process.exit(1);
        }
        throw error;
      }
    });
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
          process.exit(1);
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
          process.exit(1);
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
          process.exit(1);
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
          process.exit(1);
        }
        throw error;
      }
    });

  program
    .command('stats')
    .description('Show analytics summary')
    .argument('[args...]', 'Stats command: summary|agents|conversations|responses')
    .option('--period <duration>', 'Filter window (supports 7d, 30d, 90d, etc.)')
    .option('--since <date>', 'Alias for --from (supports 7d, 2026-01-01, etc.)')
    .option('--from <date>', 'Filter start date (not yet enforced)')
    .option('--to <date>', 'Filter end date (not yet enforced)')
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
          process.exit(1);
        }

        if (opts.from && opts.period) {
          console.error(formatError('Use either --from or --period, not both.'));
          process.exit(1);
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
            process.exit(1);
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
          process.exit(1);
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
          process.exit(1);
        }
        throw error;
      }
    });

  program
    .command('test')
    .description('Test an agent-style response without writing to a conversation')
    .argument('[message...]', 'Message to evaluate')
    .option('--agent <agent-id>', 'Target agent ID')
    .option('--json', 'Output as JSON')
    .action(async (message: string[], opts: { agent?: string; json?: boolean }) => {
      try {
        await runTopLevelTest(message, { json: opts.json, agent: opts.agent });
      } catch (error) {
        if (error instanceof Error) {
          console.error(formatError(error.message));
          process.exit(1);
        }
        throw error;
      }
    });

  program
    .command('analytics')
    .description('Show platform analytics')
    .argument('[args...]', 'analytics command: summary|agents|conversations|responses [options]')
    .option('--period <duration>', 'Filter window (supports 7d, 30d, 90d, etc.)')
    .option('--since <date>', 'Alias for --from (supports 7d, 2026-01-01, etc.)')
    .option('--from <date>', 'Filter start date (not yet enforced)')
    .option('--to <date>', 'Filter end date (not yet enforced)')
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
            process.exit(1);
          }
          if (opts.from && opts.period) {
            console.error(formatError('Use either --from or --period, not both.'));
            process.exit(1);
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
            process.exit(1);
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
    .option('--json', 'Output diff as JSON')
    .option('--include-secrets', 'Include secrets when exporting current snapshot')
    .action(
      async (
        args: string[],
        opts: { from?: string; to?: string; json?: boolean; includeSecrets?: boolean },
      ) => {
        try {
          await runTopLevelDiff(args, {
            json: opts.json,
            from: opts.from,
            to: opts.to,
            includeSecrets: opts.includeSecrets,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exit(1);
          }
          throw error;
        }
      },
    );

  program
    .command('webhooks')
    .description('Manage webhook subscriptions')
    .argument('[args...]', 'Webhook command: list|create|test|logs|delete')
    .option('--json', 'Output as JSON')
    .action(async (args: string[], opts: { json?: boolean }) => {
      try {
        await runTopLevelWebhooks(args, { json: opts.json });
      } catch (error) {
        if (error instanceof Error) {
          console.error(formatError(error.message));
          process.exit(1);
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
          process.exit(1);
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
            process.exit(1);
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
            process.exit(1);
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
            process.exit(1);
          }
          throw error;
        }
      },
    );

  program
    .command('deployments')
    .description('Inspect deployment history')
    .argument('[args...]', 'Deployment command: list|get|status|cancel|delete|<id>')
    .option('--mode <mode>', 'Filter by mode (deploy|rollback)')
    .option('--status <status>', 'Filter by status (scheduled|approved|applied|failed|cancelled)')
    .option('--limit <n>', 'Max rows for list view')
    .option('--json', 'Output as JSON')
    .action(
      async (
        args: string[],
        opts: {
          mode?: string;
          status?: string;
          limit?: string;
          json?: boolean;
        },
      ) => {
        try {
          const parsedLimit = opts.limit ? parsePositiveIntegerOption(opts.limit) : undefined;
          if (opts.limit && parsedLimit === undefined) {
            console.error(formatError('Invalid --limit value. Expected a positive integer.'));
            process.exit(1);
          }
          await runTopLevelDeployments(args, {
            json: opts.json,
            mode: opts.mode,
            status: opts.status,
            limit: parsedLimit,
          });
        } catch (error) {
          if (error instanceof Error) {
            console.error(formatError(error.message));
            process.exit(1);
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
            process.exit(1);
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
            process.exit(1);
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
            process.exit(1);
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
            process.exit(1);
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
            process.exit(1);
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
            process.exit(1);
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
            process.exit(1);
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
            process.exit(1);
          }
          throw error;
        }
      },
    );
}
