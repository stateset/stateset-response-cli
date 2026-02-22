#!/usr/bin/env node

import { Command } from 'commander';
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
  resolveModelOrThrow,
  getModelAliasText,
  DEFAULT_MODEL,
  type ModelId,
} from './config.js';
import { sanitizeSessionId } from './session.js';
import { printAuthHelp, formatError } from './utils/display.js';
import { installGlobalErrorHandlers, getErrorMessage } from './lib/errors.js';
import { exportOrg, importOrg, type ImportResult } from './export-import.js';
import { EventsRunner, validateEventsPrereqs } from './events.js';
import { assertNodeVersion } from './cli/utils.js';
import { registerAuthCommands } from './cli/auth.js';
import { registerIntegrationsCommands } from './cli/commands-integrations.js';
import { registerDoctorCommand } from './cli/commands-doctor.js';
import { registerShortcutTopLevelCommands } from './cli/commands-shortcuts.js';
import { startChatSession } from './cli/chat-action.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version?: string };

const program = new Command();
assertNodeVersion();
installGlobalErrorHandlers();

program
  .name('response')
  .description('AI-powered CLI for managing the StateSet Response platform')
  .version(pkg.version || '0.0.0');

registerAuthCommands(program);
registerIntegrationsCommands(program);
registerDoctorCommand(program);
registerShortcutTopLevelCommands(program);

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
      process.exit(1);
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
            },
          ]),
        ),
      };
      console.log(JSON.stringify(display, null, 2));
    } catch (e: unknown) {
      console.error(formatError(getErrorMessage(e)));
      process.exit(1);
    }
  });

// Export command
program
  .command('export')
  .description('Export entire org configuration to a JSON file')
  .argument('[file]', 'Output file path', 'stateset-export.json')
  .action(async (file: string) => {
    if (!configExists()) {
      printAuthHelp();
      process.exit(1);
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
      process.exit(1);
    }
  });

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
        process.exit(1);
      }
      if (!fs.existsSync(file)) {
        console.error(formatError(`File not found: ${file}`));
        process.exit(1);
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
        process.exit(1);
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
        process.exit(0);
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
        process.exit(1);
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
        process.exit(1);
      }

      let runtime: ReturnType<typeof validateEventsPrereqs> | null = null;
      try {
        runtime = validateEventsPrereqs();
      } catch (e: unknown) {
        console.error(formatError(getErrorMessage(e)));
        process.exit(1);
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
          process.exit(1);
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
        process.exit(1);
        return;
      }

      try {
        runner.start();
      } catch (e: unknown) {
        console.error(formatError(getErrorMessage(e)));
        process.exit(1);
        return;
      }

      const shutdown = async () => {
        console.log('\nStopping events watcher...');
        await runner.stop();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    },
  );

// Default command: interactive agent session
program
  .command('chat', { isDefault: true })
  .description('Start an interactive AI agent session')
  .option('--model <model>', `Model to use (${getModelAliasText('list')} or full model ID)`)
  .option('--session <name>', 'Session name (default: "default")')
  .option(
    '--file <path>',
    'Attach a file (repeatable)',
    (value: string, previous: string[]) => {
      previous.push(value);
      return previous;
    },
    [],
  )
  .option('--apply', 'Allow write operations for integration tools')
  .option('--redact', 'Redact customer emails in integration outputs')
  .option('--usage', 'Show token usage summaries')
  .option('--verbose', 'Enable debug logging')
  .action(async (options) => {
    await startChatSession(options, { version: pkg.version });
  });

program.parse();
