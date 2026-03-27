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
import { assertNodeVersion } from './cli/utils.js';
import { registerAuthCommands, runAuthLogin, type AuthLoginOptions } from './cli/auth.js';
import { registerIntegrationsCommands, runIntegrationsSetup } from './cli/commands-integrations.js';
import { registerDoctorCommand, runDoctorChecks } from './cli/commands-doctor.js';
import { registerShortcutTopLevelCommands } from './cli/commands-shortcuts.js';
import { resolveOneShotInput, runOneShotPrompt, startChatSession } from './cli/chat-action.js';
import { exportAgentRunbook } from './cli/runbook.js';
import { listAgentTemplates, scaffoldAgentTemplate } from './cli/agent-templates.js';

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
    '  response init --from-env --integration shopify',
    '  response serve --port 3000 --forward-to-engine',
    '  response doctor',
    '  eval "$(response completion bash)"',
    '',
  ].join('\n'),
);

registerAuthCommands(program);
registerIntegrationsCommands(program);
registerDoctorCommand(program);
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
  .option('--instance-url <url>', 'StateSet ResponseCX instance URL')
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
  .description('Generate shell completion scripts (bash, zsh, fish)')
  .argument('[shell]', 'Shell type: bash, zsh, or fish', 'bash')
  .action((shell: string) => {
    const commands = [
      'chat',
      'ask',
      'init',
      'config',
      'export',
      'import',
      'events',
      'doctor',
      'auth',
      'integrations',
      'engine',
      'batch',
      'completion',
    ];
    const globalFlags = [
      '--model',
      '--session',
      '--apply',
      '--redact',
      '--dry-run',
      '--json',
      '--usage',
      '--verbose',
      '--help',
      '--version',
      '--profile',
      '--dev',
    ];

    switch (shell.toLowerCase()) {
      case 'bash':
        console.log(`# bash completion for response CLI
# Add to ~/.bashrc: eval "$(response completion bash)"
_response_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local prev="\${COMP_WORDS[COMP_CWORD-1]}"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=($(compgen -W "${commands.join(' ')}" -- "$cur"))
    return
  fi
  case "$prev" in
    --model) COMPREPLY=($(compgen -W "sonnet haiku opus" -- "$cur")); return;;
    --output) COMPREPLY=($(compgen -W "json pretty minimal" -- "$cur")); return;;
    --profile) return;;
    engine) COMPREPLY=($(compgen -W "setup status brands health" -- "$cur")); return;;
    config) COMPREPLY=($(compgen -W "path show" -- "$cur")); return;;
  esac
  COMPREPLY=($(compgen -W "${globalFlags.join(' ')}" -- "$cur"))
}
complete -F _response_completions response`);
        break;

      case 'zsh':
        console.log(`# zsh completion for response CLI
# Add to ~/.zshrc: eval "$(response completion zsh)"
_response() {
  local -a commands=(${commands.map((c) => `'${c}:${c} command'`).join(' ')})
  local -a flags=(${globalFlags.map((f) => `'${f}'`).join(' ')})
  _arguments '1:command:->cmds' '*:flags:->flags'
  case "$state" in
    cmds) _describe 'command' commands;;
    flags) _values 'flags' $flags;;
  esac
}
compdef _response response`);
        break;

      case 'fish':
        console.log(`# fish completion for response CLI
# Save to ~/.config/fish/completions/response.fish
${commands.map((c) => `complete -c response -n '__fish_use_subcommand' -a '${c}' -d '${c}'`).join('\n')}
complete -c response -l model -xa 'sonnet haiku opus'
complete -c response -l output -xa 'json pretty minimal'
complete -c response -l profile
complete -c response -l apply
complete -c response -l redact
complete -c response -l dry-run
complete -c response -l json
complete -c response -l verbose
complete -c response -n '__fish_seen_subcommand_from engine' -a 'setup status brands health'
complete -c response -n '__fish_seen_subcommand_from config' -a 'path show'`);
        break;

      default:
        console.error(formatError(`Unknown shell: ${shell}. Use bash, zsh, or fish.`));
        process.exitCode = 1;
    }
  });

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
    const config = getWorkflowEngineConfig();
    if (!config) {
      console.log(chalk.yellow('  Workflow engine not configured.'));
      console.log(chalk.gray('  Run "response engine setup" to configure.'));
      return;
    }

    console.log(chalk.bold('  Workflow Engine'));
    console.log(chalk.gray(`  URL:       ${config.url}`));
    console.log(chalk.gray(`  API Key:   ${'*'.repeat(8)}...${config.apiKey.slice(-4)}`));
    if (config.tenantId) {
      console.log(chalk.gray(`  Tenant ID: ${config.tenantId}`));
    }

    const { EngineClient } = await import('./lib/engine-client.js');
    const client = new EngineClient(config);
    try {
      await client.health();
      console.log(chalk.green('  Status:    connected'));
    } catch (e: unknown) {
      console.log(chalk.red(`  Status:    unreachable (${getErrorMessage(e)})`));
    }
  });

engineCmd
  .command('brands')
  .description('List brands in the workflow engine')
  .option('--slug <slug>', 'Filter by brand slug')
  .option('--status <status>', 'Filter by status')
  .action(async (options: { slug?: string; status?: string }) => {
    const config = getWorkflowEngineConfig();
    if (!config) {
      console.log(chalk.yellow('  Workflow engine not configured.'));
      return;
    }

    const { EngineClient } = await import('./lib/engine-client.js');
    const client = new EngineClient(config);
    try {
      const result = (await client.listBrands({
        slug: options.slug,
        status: options.status,
        limit: 50,
      })) as { items?: Array<Record<string, unknown>> };
      const items =
        result?.items ?? (Array.isArray(result) ? (result as Array<Record<string, unknown>>) : []);

      if (!items.length) {
        console.log(chalk.gray('  No brands found.'));
        return;
      }

      console.log(chalk.bold(`  Brands (${items.length})`));
      for (const brand of items) {
        const id = String(brand.id ?? '').slice(0, 8);
        const name = brand.name ?? brand.slug ?? 'unnamed';
        const st = brand.status ?? 'unknown';
        const mode = brand.routing_mode ?? '-';
        console.log(
          `  ${chalk.gray(id)}  ${String(name).padEnd(24)} ${String(st).padEnd(12)} ${chalk.gray(String(mode))}`,
        );
      }
    } catch (e: unknown) {
      console.error(formatError(getErrorMessage(e)));
      process.exitCode = 1;
    }
  });

engineCmd
  .command('health')
  .description('Check workflow engine health')
  .action(async () => {
    const config = getWorkflowEngineConfig();
    if (!config) {
      console.log(chalk.yellow('  Workflow engine not configured.'));
      return;
    }

    const { EngineClient } = await import('./lib/engine-client.js');
    const client = new EngineClient(config);
    try {
      const result = await client.health();
      console.log(chalk.green('  Engine healthy'));
      if (result && typeof result === 'object') {
        console.log(chalk.gray(`  ${JSON.stringify(result, null, 2)}`));
      }
    } catch (e: unknown) {
      console.error(chalk.red(`  Engine unreachable: ${getErrorMessage(e)}`));
      process.exitCode = 1;
    }
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
