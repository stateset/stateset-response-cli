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
  resolveModel,
  DEFAULT_MODEL,
  type ModelId,
} from './config.js';
import { sanitizeSessionId } from './session.js';
import { printAuthHelp, formatError } from './utils/display.js';
import { installGlobalErrorHandlers } from './lib/errors.js';
import { exportOrg, importOrg } from './export-import.js';
import { EventsRunner, validateEventsPrereqs } from './events.js';
import { assertNodeVersion } from './cli/utils.js';
import { registerAuthCommands } from './cli/auth.js';
import { registerIntegrationsCommands } from './cli/commands-integrations.js';
import { registerDoctorCommand } from './cli/commands-doctor.js';
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
      console.error(formatError(e instanceof Error ? e.message : String(e)));
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
      console.error(formatError(e instanceof Error ? e.message : String(e)));
      process.exit(1);
    }
  });

// Import command
program
  .command('import')
  .description('Import org configuration from a JSON export file')
  .argument('<file>', 'Input file path')
  .action(async (file: string) => {
    if (!configExists()) {
      printAuthHelp();
      process.exit(1);
    }
    if (!fs.existsSync(file)) {
      console.error(formatError(`File not found: ${file}`));
      process.exit(1);
    }
    const { orgId } = getCurrentOrg();
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Import into organization "${orgId}"? This will create new resources.`,
        default: false,
      },
    ]);
    if (!confirm) {
      console.log(chalk.gray('  Import cancelled.'));
      process.exit(0);
    }
    const spinner = ora('Importing...').start();
    try {
      const result = await importOrg(file);
      spinner.succeed('Import complete');
      const counts = Object.entries(result)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');
      console.log(
        chalk.gray(`  Imported: ${counts || 'nothing (all resources may already exist)'}`),
      );
    } catch (e: unknown) {
      spinner.fail('Import failed');
      console.error(formatError(e instanceof Error ? e.message : String(e)));
      process.exit(1);
    }
  });

// Events watcher
program
  .command('events')
  .description('Run the event watcher for scheduled agent runs')
  .option('--model <model>', 'Model to use (sonnet, haiku, opus)')
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

      try {
        validateEventsPrereqs();
      } catch (e: unknown) {
        console.error(formatError(e instanceof Error ? e.message : String(e)));
        process.exit(1);
      }

      if (options.apply) {
        process.env.STATESET_ALLOW_APPLY = 'true';
      }
      if (options.redact) {
        process.env.STATESET_REDACT = 'true';
      }

      let model: ModelId = getConfiguredModel();
      if (options.model) {
        const resolved = resolveModel(options.model);
        if (!resolved) {
          console.error(
            formatError(`Unknown model "${options.model}". Use sonnet, haiku, or opus.`),
          );
          process.exit(1);
        }
        model = resolved;
      }

      const sessionId = sanitizeSessionId(options.session || 'default');
      const runner = new EventsRunner({
        model,
        defaultSession: sessionId,
        showUsage: Boolean(options.usage),
        stdout: Boolean(options.stdout),
      });

      runner.start();

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
  .option('--model <model>', 'Model to use (sonnet, haiku, opus)')
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
