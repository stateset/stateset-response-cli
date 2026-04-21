#!/usr/bin/env node

import { Command, CommanderError } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  configExists,
  getCurrentOrg,
  getConfiguredModel,
  getConfigPath,
  loadConfig,
  saveConfig,
  resolveModelOrThrow,
  getModelAliasText,
  getWorkflowEngineConfig,
  DEFAULT_MODEL,
  type ModelId,
  type WorkflowEngineConfig,
} from './config.js';
import { sanitizeSessionId } from './session.js';
import { printAuthHelp, formatError } from './utils/display.js';
import { installGlobalErrorHandlers, getErrorMessage } from './lib/errors.js';
import { setOutputMode, type OutputMode } from './lib/output.js';
import { exportOrg, importOrg, type ImportResult } from './export-import.js';
import { EventsRunner, validateEventsPrereqs } from './events.js';
import { assertNodeVersion, parseToggleValue } from './cli/utils.js';
import { registerAuthCommands, runAuthLogin, type AuthLoginOptions } from './cli/auth.js';
import { registerIntegrationsCommands, runIntegrationsSetup } from './cli/commands-integrations.js';
import { registerDoctorCommand, runDoctorChecks } from './cli/commands-doctor.js';
import { registerDashboardCommand } from './cli/commands-dashboard.js';
import { registerResetCommand } from './cli/commands-reset.js';
import { registerShortcutTopLevelCommands } from './cli/commands-shortcuts.js';
import { registerUpdateCommand } from './cli/commands-update.js';
import { resolveOneShotInput, runOneShotPrompt, startChatSession } from './cli/chat-action.js';
import { exportAgentRunbook } from './cli/runbook.js';
import { listAgentTemplates, scaffoldAgentTemplate } from './cli/agent-templates.js';
import { listCapabilityAreas, printCapabilityMap } from './cli/capabilities.js';
import {
  installCompletion,
  renderCompletionScript,
  resolveCompletionShell,
  writeCompletionScript,
} from './cli/shell-completion.js';
import {
  pullBrandStudioConfig,
  pushBrandStudioConfig,
  validateBrandStudioConfig,
} from './cli/engine-config.js';
import {
  applyBrandToLocalStack,
  activateBrandConfig,
  bootstrapBrandStudio,
  createBrandConnectorFromFile,
  createBrandFromFile,
  createPolicySetFromFile,
  createWorkflowTemplateFromFile,
  checkBrandConnectorHealth,
  checkHealth,
  runDispatchGuardView,
  listBrands,
  listBrandExecutions,
  listOnboardingRunsView,
  listPolicySetsView,
  listWorkflowTemplatesView,
  ingestBrandEventFromFile,
  resolveBrandDlqItem,
  runWorkflowStudioTest,
  showBrandDlq,
  showBrandBillingState,
  showBrandConfigHistory,
  showBrandConnectorSyncPlan,
  showBrandConnectorSecretEnv,
  showBrandConnectors,
  showBrandDetails,
  showBrandOutcomeSummary,
  showDispatchHealthDashboard,
  showEngineStatus,
  showEffectiveBrandConfig,
  showBrandMigrationState,
  showBrandParityDashboard,
  showOnboardingRunView,
  startOnboardingRun,
  syncBrandConnectors,
  retryBrandDlqItem,
  updateBrandFromFile,
  updateBrandMigrationStateFromFile,
  updateOnboardingRunView,
  updatePolicySetFromFile,
  updateWorkflowTemplateFromFile,
  validateEngineBrand,
} from './cli/commands-engine.js';
import { parseLocalStackServices } from './lib/workflow-studio-local-stack.js';

import { parseProfileArgs, applyProfile } from './lib/profile.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version?: string };

// Parse and apply profile BEFORE commander or config loading
try {
  const { profile, cleanedArgv } = parseProfileArgs(process.argv.slice(2));
  applyProfile(profile);
  // Replace argv so commander doesn't see --profile/--dev
  process.argv = [...process.argv.slice(0, 2), ...cleanedArgv];
} catch (e) {
  console.error(`Error: ${(e as Error).message}`);
  process.exit(1);
}

const program = new Command();
assertNodeVersion();
installGlobalErrorHandlers();

program
  .name('response')
  .description('AI-powered CLI for managing the StateSet Response platform')
  .version(pkg.version || '0.0.0')
  .showSuggestionAfterError(true)
  .showHelpAfterError()
  .option('--json', 'Output in machine-readable JSON format')
  .option('--output <mode>', 'Output mode: json, pretty, minimal', 'pretty')
  .option('--dry-run', 'Preview operations without executing mutations');
program.exitOverride();

// Apply global output mode before subcommands run
program.hook('preAction', (thisCommand) => {
  const opts = thisCommand.opts();
  if (opts.json) {
    setOutputMode('json');
  } else if (opts.output && ['json', 'pretty', 'minimal'].includes(opts.output)) {
    setOutputMode(opts.output as OutputMode);
  }
});

program.addHelpText(
  'after',
  [
    '',
    'Examples:',
    '  response',
    '  response ask "Summarize the latest failed orders"',
    '  cat incident.txt | response ask --stdin --session ops',
    '  response chat --session ops --model sonnet',
    '  response batch prompts.txt --output results.jsonl',
    '  response engine setup',
    '  response capabilities workflow-studio',
    '  response init --from-env --integration shopify',
    '  response serve --port 3000 --forward-to-engine',
    '  response doctor',
    '  response doctor --repair',
    '  response reset sessions',
    '  response update status',
    '  eval "$(response completion bash)"',
    '  response completion powershell --install',
    '',
  ].join('\n'),
);

registerAuthCommands(program);
registerIntegrationsCommands(program);
registerDoctorCommand(program);
registerDashboardCommand(program);
registerResetCommand(program);
registerUpdateCommand(program, pkg.version || '0.0.0');
registerShortcutTopLevelCommands(program);

const collectRepeatableOption = (value: string, previous: string[]): string[] => {
  previous.push(value);
  return previous;
};

interface InitCommandOptions extends AuthLoginOptions {
  model?: string;
  session?: string;
  apply?: boolean;
  redact?: boolean;
  usage?: boolean;
  verbose?: boolean;
  integrations?: boolean;
  chat?: boolean;
  fromEnv?: boolean;
  integration?: string;
  template?: string;
}

program
  .command('init')
  .description('Guided first-run setup (auth, diagnostics, integrations, chat)')
  .option('--model <model>', `Model to use (${getModelAliasText('list')} or full model ID)`)
  .option('--session <name>', 'Session name for chat', 'default')
  .option('--apply', 'Allow write operations for integration tools')
  .option('--redact', 'Redact customer emails in integration outputs')
  .option('--usage', 'Show token usage summaries')
  .option('--verbose', 'Enable debug logging')
  .option('--no-integrations', 'Skip integrations setup')
  .option('--no-chat', 'Skip launching chat after setup')
  .option('--from-env', 'During integration setup, prefill values from environment variables')
  .option('--integration <id>', 'Configure one integration during setup')
  .option(
    '--template <id>',
    `Scaffold a local agent template (${listAgentTemplates()
      .map((template) => template.id)
      .join(', ')})`,
  )
  .option('--device', 'Use browser/device code authentication')
  .option('--manual', 'Use manual admin-secret authentication')
  .option('--instance-url <url>', 'StateSet Response app URL')
  .option('--org-id <id>', 'Organization ID (manual mode)')
  .option('--org-name <name>', 'Organization name (manual mode)')
  .option('--graphql-endpoint <url>', 'GraphQL endpoint (manual mode)')
  .option('--admin-secret <secret>', 'Hasura admin secret (manual mode)')
  .option('--anthropic-api-key <key>', 'Anthropic API key to store in config')
  .option('--non-interactive', 'Fail instead of prompting for missing values')
  .option('--no-open-browser', 'Do not attempt to open the device verification URL')
  .action(async (options: InitCommandOptions) => {
    if (!configExists()) {
      console.log(chalk.gray('  No existing config found. Starting authentication setup.'));
      try {
        await runAuthLogin({
          device: options.device,
          manual: options.manual,
          instanceUrl: options.instanceUrl,
          orgId: options.orgId,
          orgName: options.orgName,
          graphqlEndpoint: options.graphqlEndpoint,
          adminSecret: options.adminSecret,
          anthropicApiKey: options.anthropicApiKey,
          nonInteractive: options.nonInteractive,
          openBrowser: options.openBrowser,
        });
      } catch (e: unknown) {
        console.error(formatError(getErrorMessage(e)));
        process.exitCode = 1;
        return;
      }
    } else {
      console.log(chalk.gray('  Credentials already configured. Skipping auth.'));
    }

    console.log('');
    console.log(chalk.bold('  Running diagnostics'));
    const checks = await runDoctorChecks();
    const statusIcon: Record<string, string> = {
      pass: chalk.green('[PASS]'),
      warn: chalk.yellow('[WARN]'),
      fail: chalk.red('[FAIL]'),
    };
    for (const check of checks) {
      const icon = statusIcon[check.status] || '[?]';
      console.log(`  ${icon} ${check.message}`);
    }
    const failedChecks = checks.filter((check) => check.status === 'fail');
    console.log('');

    if (options.integrations !== false && !options.nonInteractive) {
      const answer = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'configureIntegrations',
          message: 'Configure integrations now?',
          default: false,
        },
      ]);
      if (answer.configureIntegrations) {
        try {
          await runIntegrationsSetup(process.cwd(), {
            target: options.integration,
            fromEnv: Boolean(options.fromEnv),
          });
        } catch (e: unknown) {
          console.error(formatError(getErrorMessage(e)));
          process.exitCode = 1;
          return;
        }
      }
    } else if (options.integrations !== false && options.nonInteractive) {
      try {
        await runIntegrationsSetup(process.cwd(), {
          target: options.integration,
          fromEnv: Boolean(options.fromEnv),
          validateOnly: !options.fromEnv,
          nonInteractive: true,
        });
      } catch (e: unknown) {
        console.error(formatError(getErrorMessage(e)));
        process.exitCode = 1;
        return;
      }
    }

    // Offer workflow engine setup
    if (!options.nonInteractive) {
      const engineConfig = getWorkflowEngineConfig();
      if (!engineConfig) {
        const { configEngine } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'configEngine',
            message: 'Configure Workflow Engine? (brand management, workflow automation)',
            default: false,
          },
        ]);
        if (configEngine) {
          try {
            // Delegate to the engine setup command
            await program.parseAsync(['node', 'response', 'engine', 'setup'], { from: 'user' });
          } catch (e: unknown) {
            console.error(formatError(getErrorMessage(e)));
          }
        }
      } else {
        console.log(chalk.gray('  Workflow engine already configured.'));
      }
      console.log('');
    }

    if (options.template) {
      try {
        const result = scaffoldAgentTemplate(options.template, process.cwd());
        console.log(chalk.green(`  Template scaffolded: ${result.template.label}`));
        console.log(chalk.gray(`  Wrote local bundle to ${result.path}`));
      } catch (e: unknown) {
        console.error(formatError(getErrorMessage(e)));
        process.exitCode = 1;
        return;
      }
      console.log('');
    }

    if (options.chat === false) {
      return;
    }

    if (failedChecks.length > 0) {
      if (options.nonInteractive) {
        console.log(chalk.red('  Diagnostics reported failures; refusing to start chat.'));
        process.exitCode = 1;
        return;
      }
      const answer = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continueToChat',
          message: 'Diagnostics reported failures. Start chat anyway?',
          default: false,
        },
      ]);
      if (!answer.continueToChat) {
        return;
      }
    }

    await startChatSession(
      {
        model: options.model,
        session: options.session,
        apply: options.apply,
        redact: options.redact,
        usage: options.usage,
        verbose: options.verbose,
      },
      { version: pkg.version },
    );
  });

interface AskCommandOptions {
  model?: string;
  session?: string;
  file?: string[];
  apply?: boolean;
  redact?: boolean;
  usage?: boolean;
  verbose?: boolean;
  stdin?: boolean;
}

// Webhook dev server
program
  .command('serve')
  .description('Start a local webhook development server')
  .option('--port <port>', 'Port to listen on', '3000')
  .option('--forward-to-engine', 'Forward received webhooks to the workflow engine')
  .option('--verbose', 'Show webhook body previews')
  .action(async (options: { port?: string; forwardToEngine?: boolean; verbose?: boolean }) => {
    const port = Number.parseInt(options.port ?? '3000', 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      console.error(formatError('Invalid port number. Use 1-65535.'));
      process.exitCode = 1;
      return;
    }

    const { startWebhookServer } = await import('./webhook-server.js');
    const { server, stop } = startWebhookServer({
      port,
      forwardToEngine: Boolean(options.forwardToEngine),
      verbose: Boolean(options.verbose),
    });

    const shutdown = async () => {
      console.log('\n  Stopping webhook server...');
      await stop();
      process.exitCode = 0;
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(formatError(`Port ${port} is already in use.`));
      } else {
        console.error(formatError(err.message));
      }
      process.exitCode = 1;
    });
  });

// Shell completion generation
program
  .command('completion')
  .description('Generate or install shell completion scripts (bash, zsh, fish, powershell)')
  .argument('[shell]', 'Shell type: bash, zsh, fish, or powershell')
  .option('--install', 'Install the completion script into your shell profile')
  .option('--write-state', 'Write the completion script into the active CLI state directory')
  .action(async (shell: string | undefined, opts: { install?: boolean; writeState?: boolean }) => {
    try {
      const resolvedShell = resolveCompletionShell(shell);
      if (opts.install) {
        const { cachePath, profilePath } = await installCompletion(resolvedShell, program, [
          '--profile',
          '--dev',
        ]);
        console.log(chalk.green(`Installed ${resolvedShell} completion.`));
        console.log(chalk.gray(`  Cache: ${cachePath}`));
        console.log(chalk.gray(`  Profile: ${profilePath}`));
        return;
      }

      if (opts.writeState) {
        const cachePath = await writeCompletionScript(resolvedShell, program, [
          '--profile',
          '--dev',
        ]);
        console.log(cachePath);
        return;
      }

      console.log(renderCompletionScript(resolvedShell, program, ['--profile', '--dev']));
    } catch (error) {
      console.error(
        formatError(error instanceof Error ? error.message : 'Unable to render shell completion.'),
      );
      process.exitCode = 1;
    }
  });

program
  .command('capabilities')
  .alias('caps')
  .description('Show the CLI grouped by common workflows instead of raw command count')
  .argument(
    '[area]',
    `Capability area: ${listCapabilityAreas()
      .map((area) => area.id)
      .join(', ')}`,
  )
  .option('--json', 'Output capability areas and workflows as JSON')
  .action((area: string | undefined, options: { json?: boolean }) => {
    const json = Boolean(options.json || program.opts().json);
    printCapabilityMap(area, json);
  });

function parseLoopModeOption(value?: string): 'subscriptions' | 'returns' | 'both' | undefined {
  if (!value) {
    return undefined;
  }
  if (value === 'subscriptions' || value === 'returns' || value === 'both') {
    return value;
  }
  throw new CommanderError(
    1,
    'response.engine',
    `Invalid --loop-mode value "${value}". Use subscriptions, returns, or both.`,
  );
}

function parseServicesOption(value?: string): string[] | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return parseLocalStackServices(value);
  } catch (err) {
    throw new CommanderError(
      1,
      'response.engine',
      err instanceof Error ? err.message : String(err),
    );
  }
}

// Engine commands
const engineCmd = program
  .command('engine')
  .description('Manage the workflow engine connection and control plane');

engineCmd
  .command('setup')
  .description('Configure the workflow engine connection (URL, API key, tenant)')
  .option('--url <url>', 'Workflow engine URL')
  .option('--api-key <key>', 'Workflow engine API key')
  .option('--tenant-id <id>', 'Tenant ID for multi-tenant scoping')
  .action(async (options: { url?: string; apiKey?: string; tenantId?: string }) => {
    if (!configExists()) {
      printAuthHelp();
      process.exitCode = 1;
      return;
    }

    const cfg = loadConfig();
    const org = cfg.organizations[cfg.currentOrg];
    if (!org) {
      console.error(formatError(`Organization "${cfg.currentOrg}" not found.`));
      process.exitCode = 1;
      return;
    }

    let url = options.url?.trim();
    let apiKey = options.apiKey?.trim();
    let tenantId = options.tenantId?.trim();

    if (!url || !apiKey) {
      const existing = org.workflowEngine;
      const answers = await inquirer.prompt([
        ...(!url
          ? [
              {
                type: 'input' as const,
                name: 'url',
                message: 'Workflow engine URL:',
                default: existing?.url || 'http://localhost:8080',
              },
            ]
          : []),
        ...(!apiKey
          ? [
              {
                type: 'password' as const,
                name: 'apiKey',
                message: 'Workflow engine API key:',
                default: existing?.apiKey,
              },
            ]
          : []),
        ...(!tenantId
          ? [
              {
                type: 'input' as const,
                name: 'tenantId',
                message: 'Tenant ID (optional):',
                default: existing?.tenantId || '',
              },
            ]
          : []),
      ]);
      url = url || answers.url;
      apiKey = apiKey || answers.apiKey;
      tenantId = tenantId || answers.tenantId || undefined;
    }

    if (!url || !apiKey) {
      console.error(formatError('URL and API key are required.'));
      process.exitCode = 1;
      return;
    }

    const engineConfig: WorkflowEngineConfig = {
      url,
      apiKey,
      tenantId: tenantId || undefined,
    };

    // Test connectivity
    const { EngineClient } = await import('./lib/engine-client.js');
    const client = new EngineClient(engineConfig);
    const spinner = ora('Testing connection...').start();
    try {
      await client.health();
      spinner.succeed('Connected to workflow engine');
    } catch (e: unknown) {
      spinner.warn(`Could not reach engine: ${getErrorMessage(e)}`);
    }

    org.workflowEngine = engineConfig;
    cfg.organizations[cfg.currentOrg] = org;
    saveConfig(cfg);
    console.log(chalk.green('  Workflow engine configuration saved.'));
  });

engineCmd
  .command('status')
  .description('Show workflow engine connection status')
  .action(async () => {
    await showEngineStatus();
  });

engineCmd
  .command('brands')
  .description('List brands in the workflow engine')
  .option('--slug <slug>', 'Filter by brand slug')
  .option('--status <status>', 'Filter by status')
  .action(async (options: { slug?: string; status?: string }) => {
    await listBrands(options.slug, options.status);
  });

engineCmd
  .command('brand-create')
  .description('Create a brand from a JSON file')
  .argument('<file>', 'JSON file containing the create-brand payload')
  .action(async (file: string) => {
    const ok = await createBrandFromFile(file);
    if (!ok) {
      process.exitCode = 1;
    }
  });

engineCmd
  .command('brand-bootstrap')
  .description('Create or repair a workflow-studio brand and bootstrap response automation')
  .argument('<brand>', 'Brand slug or brand id')
  .option('--display-name <name>', 'Display name to use when creating a missing brand')
  .option('--template <template>', 'Workflow-studio template id from the engine bootstrap catalog')
  .option('--activate', 'Activate the latest config after bootstrapping')
  .action(
    async (
      brand: string,
      options: { displayName?: string; template?: string; activate?: boolean },
    ) => {
      const template =
        typeof options.template === 'string' && options.template.trim()
          ? options.template.trim().toLowerCase()
          : undefined;
      const ok = await bootstrapBrandStudio(brand, {
        displayName: options.displayName,
        templateId: template,
        activate: Boolean(options.activate),
      });
      if (!ok) {
        process.exitCode = 1;
      }
    },
  );

engineCmd
  .command('brand-show')
  .description('Show brand details from the workflow engine')
  .argument('<brand>', 'Brand slug or brand id')
  .action(async (brand: string) => {
    const ok = await showBrandDetails(brand);
    if (!ok) {
      process.exitCode = 1;
    }
  });

engineCmd
  .command('brand-update')
  .description('Update a brand from a JSON patch file')
  .argument('<brand>', 'Brand slug or brand id')
  .argument('<file>', 'JSON file containing the brand patch')
  .action(async (brand: string, file: string) => {
    const ok = await updateBrandFromFile(brand, file);
    if (!ok) {
      process.exitCode = 1;
    }
  });

engineCmd
  .command('health')
  .description('Check workflow engine health')
  .action(async () => {
    await checkHealth();
  });

engineCmd
  .command('dispatch-health')
  .description('Show dispatch health dashboard across brands')
  .option('--tenant-id <tenantId>', 'Optional tenant id override')
  .option('--limit <limit>', 'Maximum number of rows to return')
  .option('--offset <offset>', 'Dashboard row offset')
  .action(async (options: { tenantId?: string; limit?: string; offset?: string }) => {
    const limit = options.limit ? Number.parseInt(options.limit, 10) : undefined;
    const offset = options.offset ? Number.parseInt(options.offset, 10) : undefined;
    await showDispatchHealthDashboard({
      tenantId: options.tenantId,
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
    });
  });

engineCmd
  .command('dispatch-guard')
  .description('Plan or apply dispatch guard actions for unhealthy brands')
  .option('--tenant-id <tenantId>', 'Optional tenant id override')
  .option('--apply <true|false>', 'Apply planned actions instead of running in plan mode')
  .option(
    '--minimum-health-status <status>',
    'Minimum health threshold to act on: warning or critical',
  )
  .option('--max-actions <maxActions>', 'Maximum number of actions to plan or apply')
  .action(
    async (options: {
      tenantId?: string;
      apply?: string;
      minimumHealthStatus?: string;
      maxActions?: string;
    }) => {
      const apply = parseToggleValue(options.apply);
      if (options.apply !== undefined && apply === undefined) {
        console.error(formatError('Apply must be one of: true, false, on, off, yes, no.'));
        process.exitCode = 1;
        return;
      }

      const threshold = options.minimumHealthStatus?.trim().toLowerCase();
      if (threshold && threshold !== 'warning' && threshold !== 'critical') {
        console.error(formatError('Minimum health status must be one of: warning, critical.'));
        process.exitCode = 1;
        return;
      }

      const maxActions = options.maxActions ? Number.parseInt(options.maxActions, 10) : undefined;
      await runDispatchGuardView({
        tenantId: options.tenantId,
        apply,
        minimumHealthStatus: threshold as 'warning' | 'critical' | undefined,
        maxActions: Number.isFinite(maxActions) ? maxActions : undefined,
      });
    },
  );

engineCmd
  .command('activate')
  .description('Activate the current config version for a brand')
  .argument('<brand>', 'Brand slug or brand id')
  .option('--config-version <version>', 'Expected config version')
  .action(async (brand: string, options: { configVersion?: string }) => {
    const parsed = options.configVersion ? Number.parseInt(options.configVersion, 10) : undefined;
    await activateBrandConfig(brand, Number.isFinite(parsed) ? parsed : undefined);
  });

engineCmd
  .command('validate')
  .description('Run remote engine validation for a brand')
  .argument('<brand>', 'Brand slug or brand id')
  .action(async (brand: string) => {
    const ok = await validateEngineBrand(brand);
    if (!ok) {
      process.exitCode = 1;
    }
  });

engineCmd
  .command('billing')
  .description('Show billing state, meter status, and forecast for a brand')
  .argument('<brand>', 'Brand slug or brand id')
  .action(async (brand: string) => {
    const ok = await showBrandBillingState(brand);
    if (!ok) {
      process.exitCode = 1;
    }
  });

engineCmd
  .command('outcomes')
  .description('Show outcome summary for a brand')
  .argument('<brand>', 'Brand slug or brand id')
  .option('--status <status>', 'Filter by outcome status')
  .option('--outcome-type <outcomeType>', 'Filter by outcome type')
  .option('--source <source>', 'Filter by outcome source')
  .option('--from <from>', 'ISO start date/time')
  .option('--to <to>', 'ISO end date/time')
  .action(
    async (
      brand: string,
      options: {
        status?: string;
        outcomeType?: string;
        source?: string;
        from?: string;
        to?: string;
      },
    ) => {
      const ok = await showBrandOutcomeSummary(brand, {
        status: options.status,
        outcomeType: options.outcomeType,
        source: options.source,
        from: options.from,
        to: options.to,
      });
      if (!ok) {
        process.exitCode = 1;
      }
    },
  );

engineCmd
  .command('executions')
  .description('List recent workflow executions for a brand')
  .argument('<brand>', 'Brand slug or brand id')
  .option('--status <status>', 'Filter by execution status')
  .option('--limit <limit>', 'Maximum number of executions to list', '20')
  .option('--offset <offset>', 'Execution list offset', '0')
  .action(async (brand: string, options: { status?: string; limit?: string; offset?: string }) => {
    const limit = Number.parseInt(options.limit ?? '', 10);
    const offset = Number.parseInt(options.offset ?? '', 10);
    await listBrandExecutions(brand, {
      status: options.status,
      limit: Number.isFinite(limit) ? limit : 20,
      offset: Number.isFinite(offset) ? offset : 0,
    });
  });

engineCmd
  .command('connectors')
  .description('List connectors for a brand')
  .argument('<brand>', 'Brand slug or brand id')
  .action(async (brand: string) => {
    await showBrandConnectors(brand);
  });

engineCmd
  .command('connector-health')
  .description('Run a health check for a brand connector')
  .argument('<brand>', 'Brand slug or brand id')
  .argument('<connector-id>', 'Connector id')
  .action(async (brand: string, connectorId: string) => {
    await checkBrandConnectorHealth(brand, connectorId);
  });

engineCmd
  .command('connector-create')
  .description('Create a connector for a brand from a JSON file')
  .argument('<brand>', 'Brand slug or brand id')
  .argument('<file>', 'JSON file containing the connector payload')
  .action(async (brand: string, file: string) => {
    const ok = await createBrandConnectorFromFile(brand, file);
    if (!ok) {
      process.exitCode = 1;
    }
  });

engineCmd
  .command('connector-plan')
  .description('Plan workflow-studio connector sync from local or platform credentials')
  .argument('<brand>', 'Brand slug or brand id')
  .option('--loop-mode <mode>', 'Loop sync mode: subscriptions, returns, or both')
  .option('--source <source>', 'Connector sync source: local or platform', 'local')
  .action(async (brand: string, options: { loopMode?: string; source?: string }) => {
    const loopMode = parseLoopModeOption(options.loopMode);
    const source =
      options.source === 'local' || options.source === 'platform' ? options.source : undefined;
    if (options.source && !source) {
      console.error(formatError('Source must be one of: local, platform.'));
      process.exitCode = 1;
      return;
    }
    await showBrandConnectorSyncPlan(brand, { loopMode, source });
  });

engineCmd
  .command('connector-sync')
  .description('Sync workflow-studio connectors from local or platform credentials')
  .argument('<brand>', 'Brand slug or brand id')
  .option('--loop-mode <mode>', 'Loop sync mode: subscriptions, returns, or both')
  .option('--source <source>', 'Connector sync source: local or platform', 'local')
  .action(async (brand: string, options: { loopMode?: string; source?: string }) => {
    const loopMode = parseLoopModeOption(options.loopMode);
    const source =
      options.source === 'local' || options.source === 'platform' ? options.source : undefined;
    if (options.source && !source) {
      console.error(formatError('Source must be one of: local, platform.'));
      process.exitCode = 1;
      return;
    }
    const ok = await syncBrandConnectors(brand, { loopMode, source });
    if (!ok) {
      process.exitCode = 1;
    }
  });

engineCmd
  .command('connector-env')
  .description('Inspect or export brand-scoped connector secret env vars for local workers')
  .argument('<brand>', 'Brand slug or brand id')
  .option('--loop-mode <mode>', 'Loop sync mode: subscriptions, returns, or both')
  .option('--format <format>', 'Output format when writing: dotenv, shell, or json', 'dotenv')
  .option('--out <path>', 'Write the rendered secret env file to a path')
  .option('--unsafe-path', 'Allow writing outside the default safe output roots')
  .action(
    async (
      brand: string,
      options: {
        loopMode?: string;
        format?: string;
        out?: string;
        unsafePath?: boolean;
      },
    ) => {
      const loopMode = parseLoopModeOption(options.loopMode);
      const format = options.format ?? 'dotenv';
      if (!['dotenv', 'shell', 'json'].includes(format)) {
        console.error(formatError('Format must be one of: dotenv, shell, json.'));
        process.exitCode = 1;
        return;
      }
      const ok = await showBrandConnectorSecretEnv(brand, {
        loopMode,
        format: format as 'dotenv' | 'shell' | 'json',
        outPath: options.out,
        allowUnsafePath: Boolean(options.unsafePath),
      });
      if (!ok) {
        process.exitCode = 1;
      }
    },
  );

engineCmd
  .command('local-apply')
  .description('Write brand-scoped env and update the local Temporal stack services')
  .argument('<brand>', 'Brand slug or brand id')
  .option('--loop-mode <mode>', 'Loop sync mode: subscriptions, returns, or both')
  .option('--out <path>', 'Write the generated dotenv env file to a path')
  .option('--compose-file <path>', 'Local next-temporal-rs docker compose file')
  .option(
    '--services <services>',
    'Comma-separated services to refresh',
    'api,worker,dispatcher,tools',
  )
  .option('--write-only', 'Only write the env file and print the docker compose command')
  .option('--unsafe-path', 'Allow writing outside the default safe output roots')
  .action(
    async (
      brand: string,
      options: {
        loopMode?: string;
        out?: string;
        composeFile?: string;
        services?: string;
        writeOnly?: boolean;
        unsafePath?: boolean;
      },
    ) => {
      const loopMode = parseLoopModeOption(options.loopMode);
      const services = parseServicesOption(options.services);
      const ok = await applyBrandToLocalStack(brand, {
        loopMode,
        outPath: options.out,
        composeFilePath: options.composeFile,
        services,
        writeOnly: Boolean(options.writeOnly),
        allowUnsafePath: Boolean(options.unsafePath),
      });
      if (!ok) {
        process.exitCode = 1;
      }
    },
  );

engineCmd
  .command('test')
  .description('Run a dry-run workflow-studio test event for a brand')
  .argument('<brand>', 'Brand slug or brand id')
  .argument('<ticket-id>', 'Ticket id or external ticket identifier')
  .action(async (brand: string, ticketId: string) => {
    await runWorkflowStudioTest(brand, ticketId);
  });

engineCmd
  .command('event')
  .description('Ingest a workflow engine event payload from a JSON file')
  .argument('<brand>', 'Brand slug or brand id')
  .argument('<file>', 'JSON file containing the event payload')
  .option('--idempotency-key <key>', 'Custom idempotency key for the event')
  .action(async (brand: string, file: string, options: { idempotencyKey?: string }) => {
    const ok = await ingestBrandEventFromFile(brand, file, process.cwd(), options.idempotencyKey);
    if (!ok) {
      process.exitCode = 1;
    }
  });

engineCmd
  .command('onboard')
  .description('Start an onboarding run for a brand')
  .argument('<brand>', 'Brand slug or brand id')
  .option('--notes <notes>', 'Optional onboarding notes')
  .action(async (brand: string, options: { notes?: string }) => {
    await startOnboardingRun(brand, options.notes);
  });

engineCmd
  .command('onboard-runs')
  .description('List onboarding runs for a brand')
  .argument('<brand>', 'Brand slug or brand id')
  .action(async (brand: string) => {
    await listOnboardingRunsView(brand);
  });

engineCmd
  .command('onboard-show')
  .description('Show a specific onboarding run')
  .argument('<brand>', 'Brand slug or brand id')
  .argument('<run-id>', 'Onboarding run id')
  .action(async (brand: string, runId: string) => {
    await showOnboardingRunView(brand, runId);
  });

engineCmd
  .command('onboard-update')
  .description('Update an onboarding run status or notes')
  .argument('<brand>', 'Brand slug or brand id')
  .argument('<run-id>', 'Onboarding run id')
  .option('--status <status>', 'Next onboarding status')
  .option('--notes <notes>', 'Optional onboarding notes')
  .action(async (brand: string, runId: string, options: { status?: string; notes?: string }) => {
    if (!options.status && !options.notes) {
      throw new CommanderError(
        1,
        'response.engine',
        'Provide --status, --notes, or both for onboard-update.',
      );
    }
    await updateOnboardingRunView(brand, runId, {
      status: options.status,
      notes: options.notes,
    });
  });

engineCmd
  .command('dlq')
  .description('List dead-letter queue items for a brand')
  .argument('<brand>', 'Brand slug or brand id')
  .option('--status <status>', 'Filter by DLQ status')
  .option('--limit <limit>', 'Maximum number of DLQ items to list', '20')
  .option('--offset <offset>', 'DLQ list offset', '0')
  .action(async (brand: string, options: { status?: string; limit?: string; offset?: string }) => {
    const limit = Number.parseInt(options.limit ?? '', 10);
    const offset = Number.parseInt(options.offset ?? '', 10);
    await showBrandDlq(brand, {
      status: options.status,
      limit: Number.isFinite(limit) ? limit : 20,
      offset: Number.isFinite(offset) ? offset : 0,
    });
  });

engineCmd
  .command('dlq-retry')
  .description('Retry a dead-letter queue item')
  .argument('<brand>', 'Brand slug or brand id')
  .argument('<dlq-id>', 'DLQ item id')
  .action(async (brand: string, dlqId: string) => {
    await retryBrandDlqItem(brand, dlqId);
  });

engineCmd
  .command('dlq-resolve')
  .description('Resolve a dead-letter queue item')
  .argument('<brand>', 'Brand slug or brand id')
  .argument('<dlq-id>', 'DLQ item id')
  .option('--action <action>', 'Resolution action')
  .option('--notes <notes>', 'Optional resolution notes')
  .action(async (brand: string, dlqId: string, options: { action?: string; notes?: string }) => {
    await resolveBrandDlqItem(brand, dlqId, {
      action: options.action,
      notes: options.notes,
    });
  });

engineCmd
  .command('migration')
  .description('Show migration state for a brand')
  .argument('<brand>', 'Brand slug or brand id')
  .action(async (brand: string) => {
    await showBrandMigrationState(brand);
  });

engineCmd
  .command('migration-update')
  .description('Update migration state for a brand from a JSON file')
  .argument('<brand>', 'Brand slug or brand id')
  .argument('<file>', 'JSON file containing the migration patch')
  .action(async (brand: string, file: string) => {
    await updateBrandMigrationStateFromFile(brand, file);
  });

engineCmd
  .command('parity')
  .description('Show parity dashboard for a brand')
  .argument('<brand>', 'Brand slug or brand id')
  .argument('[from]', 'ISO start date/time')
  .argument('[to]', 'ISO end date/time')
  .action(async (brand: string, from?: string, to?: string) => {
    await showBrandParityDashboard(brand, { from, to });
  });

engineCmd
  .command('templates')
  .description('List workflow templates or get a specific template')
  .argument('[template-key]', 'Template key')
  .option('--version <version>', 'Specific template version')
  .action(async (templateKey: string | undefined, options: { version?: string }) => {
    const version = Number.parseInt(options.version ?? '', 10);
    await listWorkflowTemplatesView(templateKey, Number.isFinite(version) ? version : undefined);
  });

engineCmd
  .command('template-create')
  .description('Create a workflow template from a JSON file')
  .argument('<file>', 'JSON file containing the template payload')
  .action(async (file: string) => {
    await createWorkflowTemplateFromFile(file);
  });

engineCmd
  .command('template-update')
  .description('Update a workflow template version from a JSON file')
  .argument('<template-key>', 'Template key')
  .argument('<version>', 'Template version')
  .argument('<file>', 'JSON file containing the template patch')
  .action(async (templateKey: string, versionText: string, file: string) => {
    const version = Number.parseInt(versionText, 10);
    await updateWorkflowTemplateFromFile(templateKey, version, file);
  });

engineCmd
  .command('policy-sets')
  .description('List policy sets or get a specific policy set')
  .argument('[policy-set-key]', 'Policy set key')
  .option('--version <version>', 'Specific policy set version')
  .action(async (policySetKey: string | undefined, options: { version?: string }) => {
    const version = Number.parseInt(options.version ?? '', 10);
    await listPolicySetsView(policySetKey, Number.isFinite(version) ? version : undefined);
  });

engineCmd
  .command('policy-set-create')
  .description('Create a policy set from a JSON file')
  .argument('<file>', 'JSON file containing the policy set payload')
  .action(async (file: string) => {
    await createPolicySetFromFile(file);
  });

engineCmd
  .command('policy-set-update')
  .description('Update a policy set version from a JSON file')
  .argument('<policy-set-key>', 'Policy set key')
  .argument('<version>', 'Policy set version')
  .argument('<file>', 'JSON file containing the policy set patch')
  .action(async (policySetKey: string, versionText: string, file: string) => {
    const version = Number.parseInt(versionText, 10);
    await updatePolicySetFromFile(policySetKey, version, file);
  });

const engineConfigCmd = engineCmd
  .command('config')
  .description('Pull, validate, and push local brand workflow studio config');

engineConfigCmd
  .command('show')
  .description('Show the effective remote workflow studio config for a brand')
  .argument('<brand>', 'Brand slug or brand id')
  .action(async (brand: string) => {
    const ok = await showEffectiveBrandConfig(brand);
    if (!ok) {
      process.exitCode = 1;
    }
  });

engineConfigCmd
  .command('pull')
  .description('Pull workflow studio config for a brand into .stateset/<brand>')
  .argument('<brand>', 'Brand slug or brand id')
  .action(async (brand: string) => {
    const ok = await pullBrandStudioConfig(brand);
    if (!ok) {
      process.exitCode = 1;
    }
  });

engineConfigCmd
  .command('push')
  .description('Push local .stateset/<brand> workflow studio config to the engine')
  .argument('<brand>', 'Brand slug')
  .action(async (brand: string) => {
    const ok = await pushBrandStudioConfig(brand);
    if (!ok) {
      process.exitCode = 1;
    }
  });

engineConfigCmd
  .command('validate')
  .description('Validate local .stateset/<brand> workflow studio config')
  .argument('<brand>', 'Brand slug')
  .action((brand: string) => {
    const ok = validateBrandStudioConfig(brand);
    if (!ok) {
      process.exitCode = 1;
    }
  });

engineConfigCmd
  .command('history')
  .description('Show config version history for a brand')
  .argument('<brand>', 'Brand slug or brand id')
  .option('--limit <limit>', 'Maximum number of versions to list', '20')
  .action(async (brand: string, options: { limit?: string }) => {
    const limit = Number.parseInt(options.limit ?? '', 10);
    await showBrandConfigHistory(brand, Number.isFinite(limit) ? limit : 20);
  });

// Config commands
const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('path')
  .description('Print the config file path')
  .action(() => {
    console.log(getConfigPath());
  });

configCmd
  .command('show')
  .description('Display current configuration (secrets redacted)')
  .action(() => {
    if (!configExists()) {
      printAuthHelp();
      process.exitCode = 1;
      return;
    }
    try {
      const cfg = loadConfig();
      const display = {
        currentOrg: cfg.currentOrg,
        model: cfg.model ?? DEFAULT_MODEL,
        anthropicApiKey: cfg.anthropicApiKey ? '***' : undefined,
        organizations: Object.fromEntries(
          Object.entries(cfg.organizations).map(([id, org]) => [
            id,
            {
              name: org.name,
              graphqlEndpoint: org.graphqlEndpoint,
              adminSecret: org.adminSecret ? '***' : undefined,
              cliToken: org.cliToken ? '***' : undefined,
              workflowEngine: org.workflowEngine
                ? {
                    url: org.workflowEngine.url,
                    apiKey: '***',
                    tenantId: org.workflowEngine.tenantId,
                  }
                : undefined,
            },
          ]),
        ),
      };
      console.log(JSON.stringify(display, null, 2));
    } catch (e: unknown) {
      console.error(formatError(getErrorMessage(e)));
      process.exitCode = 1;
      return;
    }
  });

// Export command
program
  .command('export')
  .description('Export org configuration or generate a runbook')
  .argument('[args...]', 'Output file path or `runbook` subcommand')
  .option('--agent <agent-id-or-name>', 'Target agent for runbook generation')
  .option('--out <path>', 'Override output path')
  .action(
    async (
      args: string[],
      options: {
        agent?: string;
        out?: string;
      },
    ) => {
      const [firstArg, secondArg] = args;
      if (firstArg === 'runbook') {
        const agentReference = options.agent || secondArg;
        if (!agentReference) {
          console.error(formatError('Usage: response export runbook --agent <agent-id-or-name>'));
          process.exitCode = 1;
          return;
        }
        const spinner = ora(`Generating runbook for ${agentReference}...`).start();
        try {
          const outputPath = await exportAgentRunbook(agentReference, options.out);
          spinner.succeed(`Runbook exported to ${outputPath}`);
        } catch (e: unknown) {
          spinner.fail('Runbook export failed');
          console.error(formatError(getErrorMessage(e)));
          process.exitCode = 1;
        }
        return;
      }

      const file = options.out || firstArg || 'stateset-export.json';
      if (!configExists()) {
        printAuthHelp();
        process.exitCode = 1;
        return;
      }
      const { orgId } = getCurrentOrg();
      const spinner = ora(`Exporting organization ${orgId}...`).start();
      try {
        const data = await exportOrg(file);
        const counts = [
          `${data.agents.length} agents`,
          `${data.rules.length} rules`,
          `${data.skills.length} skills`,
          `${data.attributes.length} attributes`,
          `${data.functions.length} functions`,
          `${data.examples.length} examples`,
          `${data.evals.length} evals`,
          `${data.datasets.length} datasets`,
          `${data.agentSettings.length} agent settings`,
        ];
        spinner.succeed(`Exported to ${file}`);
        console.log(chalk.gray(`  ${counts.join(', ')}`));
      } catch (e: unknown) {
        spinner.fail('Export failed');
        console.error(formatError(getErrorMessage(e)));
        process.exitCode = 1;
      }
    },
  );

// Import command
program
  .command('import')
  .description('Import org configuration from a JSON export file')
  .argument('<file>', 'Input file path')
  .option('--dry-run', 'Validate without writing changes')
  .option('--strict', 'Fail if any insert fails')
  .action(
    async (
      file: string,
      options: {
        dryRun?: boolean;
        strict?: boolean;
      },
    ) => {
      if (!configExists()) {
        printAuthHelp();
        process.exitCode = 1;
        return;
      }
      if (!fs.existsSync(file)) {
        console.error(formatError(`File not found: ${file}`));
        process.exitCode = 1;
        return;
      }

      const formatCounts = (result: ImportResult, label = 'Imported'): string => {
        const lines = [
          ['agents', 'agents'],
          ['rules', 'rules'],
          ['skills', 'skills'],
          ['attributes', 'attributes'],
          ['functions', 'functions'],
          ['examples', 'examples'],
          ['evals', 'evals'],
          ['datasets', 'datasets'],
          ['datasetEntries', 'dataset entries'],
          ['agentSettings', 'agent settings'],
        ] as const;

        const counts = lines
          .map(([key, name]) => ({ key, name, value: result[key as keyof ImportResult] }))
          .filter((entry) => Number(entry.value) > 0)
          .map((entry) => `${entry.value} ${entry.name}`);

        return `${label}: ${counts.length ? counts.join(', ') : 'nothing'}`;
      };

      let preview: ImportResult;
      try {
        preview = await importOrg(file, { dryRun: true });
      } catch (e: unknown) {
        console.error(formatError(getErrorMessage(e)));
        process.exitCode = 1;
        return;
      }
      const { orgId } = getCurrentOrg();
      console.log(
        chalk.gray(
          `  Import preview for destination "${orgId}" from source "${preview.sourceOrgId}"`,
        ),
      );
      if (preview.sourceOrgId !== orgId) {
        console.log(chalk.yellow('  Source org differs from destination org.'));
      }
      console.log(chalk.gray(`  ${formatCounts(preview, 'Will apply')}`));
      if (preview.skipped > 0) {
        console.log(chalk.yellow(`  Skipped (dry-run estimate): ${preview.skipped}`));
      }

      if (options.dryRun) {
        console.log(chalk.gray('  Dry-run complete.'));
        return;
      }

      const confirmText = `Apply import to organization "${orgId}"?`;
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: confirmText,
          default: false,
        },
      ]);
      if (!confirm) {
        console.log(chalk.gray('  Import cancelled.'));
        return;
      }

      const spinner = ora('Importing...').start();
      try {
        const result = await importOrg(file, { strict: options.strict });
        spinner.succeed('Import complete');
        const counts = formatCounts(result);
        console.log(chalk.gray(`  ${counts || 'nothing (all resources may already exist)'}`));

        if (result.skipped > 0) {
          console.log(chalk.yellow(`  Skipped: ${result.skipped}`));
        }
        if (result.failures.length > 0) {
          const summary = result.failures
            .slice(0, 5)
            .map((f) => `    - ${f.entity}[${f.index}]: ${f.reason}`);
          console.log(chalk.yellow('  Failures:'));
          console.log(chalk.yellow(summary.join('\n')));
        }
      } catch (e: unknown) {
        spinner.fail('Import failed');
        console.error(formatError(getErrorMessage(e)));
        process.exitCode = 1;
        return;
      }
    },
  );

// Events watcher
program
  .command('events')
  .description('Run the event watcher for scheduled agent runs')
  .option('--model <model>', `Model to use (${getModelAliasText('list')} or full model ID)`)
  .option('--session <name>', 'Default session name', 'default')
  .option('--apply', 'Allow write operations for integration tools')
  .option('--redact', 'Redact customer emails in integration outputs')
  .option('--usage', 'Show token usage summaries')
  .option('--stdout', 'Print event responses to stdout')
  .action(
    async (options: {
      model?: string;
      session?: string;
      apply?: boolean;
      redact?: boolean;
      usage?: boolean;
      stdout?: boolean;
    }) => {
      if (!configExists()) {
        printAuthHelp();
        process.exitCode = 1;
        return;
      }

      let runtime: ReturnType<typeof validateEventsPrereqs> | null = null;
      try {
        runtime = validateEventsPrereqs();
      } catch (e: unknown) {
        console.error(formatError(getErrorMessage(e)));
        process.exitCode = 1;
        return;
      }
      if (!runtime) {
        return;
      }

      const mcpEnvOverrides: Record<string, string> = {};
      if (options.apply) {
        mcpEnvOverrides.STATESET_ALLOW_APPLY = 'true';
      }
      if (options.redact) {
        mcpEnvOverrides.STATESET_REDACT = 'true';
      }

      let model: ModelId = getConfiguredModel();
      if (options.model) {
        try {
          model = resolveModelOrThrow(options.model);
        } catch (e: unknown) {
          console.error(formatError(getErrorMessage(e)));
          process.exitCode = 1;
          return;
        }
      }

      const sessionId = sanitizeSessionId(options.session || 'default');
      let runner: EventsRunner;
      try {
        runner = new EventsRunner({
          model,
          defaultSession: sessionId,
          showUsage: Boolean(options.usage),
          stdout: Boolean(options.stdout),
          mcpEnvOverrides,
          anthropicApiKey: runtime.anthropicApiKey,
        });
      } catch (e: unknown) {
        console.error(formatError(getErrorMessage(e)));
        process.exitCode = 1;
        return;
      }

      try {
        runner.start();
      } catch (e: unknown) {
        console.error(formatError(getErrorMessage(e)));
        process.exitCode = 1;
        return;
      }

      const shutdown = async () => {
        console.log('\nStopping events watcher...');
        await runner.stop();
        process.exitCode = 0;
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    },
  );

program
  .command('ask')
  .description('Send one prompt and print the response')
  .argument('[prompt...]', 'Prompt text to send')
  .option('--stdin', 'Read the prompt from stdin')
  .option('--model <model>', `Model to use (${getModelAliasText('list')} or full model ID)`)
  .option('--session <name>', 'Session name (default: "default")')
  .option('--file <path>', 'Attach a file (repeatable)', collectRepeatableOption, [])
  .option('--apply', 'Allow write operations for integration tools')
  .option('--redact', 'Redact customer emails in integration outputs')
  .option('--dry-run', 'Preview write operations without executing')
  .option('--usage', 'Show token usage summaries')
  .option('--verbose', 'Enable debug logging')
  .action(async (promptParts: string[], options: AskCommandOptions) => {
    let message: string;
    try {
      message = await resolveOneShotInput({
        promptParts,
        stdin: options.stdin,
      });
    } catch (error) {
      console.error(formatError(getErrorMessage(error)));
      process.exitCode = 1;
      return;
    }

    await runOneShotPrompt({
      model: options.model,
      session: options.session,
      file: options.file,
      apply: options.apply,
      redact: options.redact,
      usage: options.usage,
      verbose: options.verbose,
      message,
    });
  });

// Batch command
program
  .command('batch')
  .description('Process multiple prompts from a file (one per line)')
  .argument('<file>', 'Input file with prompts (one per line)')
  .option('--model <model>', `Model to use (${getModelAliasText('list')} or full model ID)`)
  .option('--session <name>', 'Session name', 'batch')
  .option('--apply', 'Allow write operations')
  .option('--redact', 'Redact customer emails')
  .option('--output <path>', 'Output file (JSONL format)')
  .action(
    async (
      file: string,
      options: {
        model?: string;
        session?: string;
        apply?: boolean;
        redact?: boolean;
        output?: string;
      },
    ) => {
      const fs = await import('node:fs');
      if (!fs.existsSync(file)) {
        console.error(formatError(`File not found: ${file}`));
        process.exitCode = 1;
        return;
      }

      const lines = fs
        .readFileSync(file, 'utf-8')
        .split('\n')
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 0 && !l.startsWith('#'));

      if (lines.length === 0) {
        console.error(formatError('No prompts found in file.'));
        process.exitCode = 1;
        return;
      }

      console.log(chalk.gray(`  Processing ${lines.length} prompts from ${file}`));

      const { createProgress } = await import('./lib/progress.js');
      const progress = createProgress({
        message: `Processing ${lines.length} prompts`,
        total: lines.length,
      });

      // Set up agent once for the batch
      if (!configExists()) {
        printAuthHelp();
        process.exitCode = 1;
        return;
      }

      const { validateRuntimeConfig } = await import('./config.js');
      const { StateSetAgent } = await import('./agent.js');

      let runtime;
      try {
        runtime = validateRuntimeConfig();
      } catch (e: unknown) {
        console.error(formatError(getErrorMessage(e)));
        process.exitCode = 1;
        return;
      }

      let model: ModelId = getConfiguredModel();
      if (options.model) {
        try {
          model = resolveModelOrThrow(options.model);
        } catch (e: unknown) {
          console.error(formatError(getErrorMessage(e)));
          process.exitCode = 1;
          return;
        }
      }

      const agent = new StateSetAgent(runtime.anthropicApiKey, model);
      const mcpEnv: Record<string, string> = {};
      if (options.apply) mcpEnv.STATESET_ALLOW_APPLY = 'true';
      if (options.redact) mcpEnv.STATESET_REDACT = 'true';
      agent.setMcpEnvOverrides(mcpEnv);

      const batchSpinner = ora('Connecting to MCP server...').start();
      try {
        await agent.connect();
        batchSpinner.succeed('Connected');
      } catch (e: unknown) {
        batchSpinner.fail(`Connection failed: ${getErrorMessage(e)}`);
        process.exitCode = 1;
        return;
      }

      const outputPath = options.output ?? `${file}.results.jsonl`;
      const outputStream = fs.createWriteStream(outputPath, { flags: 'w' });

      for (let i = 0; i < lines.length; i++) {
        const prompt = lines[i];
        progress.update(`[${i + 1}/${lines.length}] ${prompt.slice(0, 50)}...`);

        try {
          const response = await agent.chat(prompt);
          outputStream.write(JSON.stringify({ index: i, prompt, response, error: null }) + '\n');
        } catch (err) {
          outputStream.write(
            JSON.stringify({ index: i, prompt, response: null, error: getErrorMessage(err) }) +
              '\n',
          );
        }

        progress.tick();
      }

      outputStream.end();
      await agent.disconnect();
      progress.succeed(`Processed ${lines.length} prompts → ${outputPath}`);
    },
  );

// Default command: interactive agent session
program
  .command('chat', { isDefault: true })
  .description('Start an interactive AI agent session')
  .option('--model <model>', `Model to use (${getModelAliasText('list')} or full model ID)`)
  .option('--session <name>', 'Session name (default: "default")')
  .option('--file <path>', 'Attach a file (repeatable)', collectRepeatableOption, [])
  .option('--apply', 'Allow write operations for integration tools')
  .option('--redact', 'Redact customer emails in integration outputs')
  .option('--dry-run', 'Preview write operations without executing')
  .option('--usage', 'Show token usage summaries')
  .option('--verbose', 'Enable debug logging')
  .action(async (options) => {
    await startChatSession(options, { version: pkg.version });
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError) {
    if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
      process.exitCode = 0;
    } else {
      process.exitCode = error.exitCode;
    }
  } else {
    throw error;
  }
}
