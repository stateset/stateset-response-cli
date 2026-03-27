import chalk from 'chalk';
import inquirer from 'inquirer';
import type { ChatContext, CommandResult } from './types.js';
import {
  loadConfig,
  saveConfig,
  configExists,
  getWorkflowEngineConfig,
  type WorkflowEngineConfig,
} from '../config.js';
import { EngineClient, EngineClientError } from '../lib/engine-client.js';
import { formatTable } from '../utils/display.js';

const NOT_HANDLED: CommandResult = { handled: false };

function printNotConfigured(): void {
  console.log(chalk.yellow('  Workflow engine not configured.'));
  console.log(
    chalk.gray(
      '  Run /engine setup or set WORKFLOW_ENGINE_URL + WORKFLOW_ENGINE_API_KEY env vars.',
    ),
  );
}

async function showStatus(): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  console.log(chalk.bold('  Workflow Engine'));
  console.log(chalk.gray(`  URL:       ${config.url}`));
  console.log(chalk.gray(`  API Key:   ${'*'.repeat(8)}...${config.apiKey.slice(-4)}`));
  if (config.tenantId) {
    console.log(chalk.gray(`  Tenant ID: ${config.tenantId}`));
  }

  const client = new EngineClient(config);
  try {
    await client.health();
    console.log(chalk.green('  Status:    connected'));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Status:    unreachable (${msg})`));
  }
}

async function runSetup(ctx: ChatContext): Promise<void> {
  if (!configExists()) {
    console.log(chalk.red('  No CLI config found. Run "response auth login" first.'));
    return;
  }

  const cfg = loadConfig();
  const org = cfg.organizations[cfg.currentOrg];
  if (!org) {
    console.log(chalk.red(`  Organization "${cfg.currentOrg}" not found in config.`));
    return;
  }

  const existing = org.workflowEngine;
  const defaults = {
    url: existing?.url || process.env.WORKFLOW_ENGINE_URL || '',
    apiKey: existing?.apiKey || process.env.WORKFLOW_ENGINE_API_KEY || '',
    tenantId: existing?.tenantId || process.env.WORKFLOW_ENGINE_TENANT_ID || '',
  };

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'url',
      message: 'Workflow engine URL:',
      default: defaults.url || 'http://localhost:8080',
      validate: (input: string) => {
        try {
          const parsed = new URL(input);
          if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return 'Must be an HTTP(S) URL';
          }
          return true;
        } catch {
          return 'Invalid URL';
        }
      },
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'Workflow engine API key:',
      default: defaults.apiKey,
      validate: (input: string) => (input.trim().length > 0 ? true : 'API key is required'),
    },
    {
      type: 'input',
      name: 'tenantId',
      message: 'Tenant ID (optional, press Enter to skip):',
      default: defaults.tenantId,
    },
  ]);

  const engineConfig: WorkflowEngineConfig = {
    url: answers.url.trim(),
    apiKey: answers.apiKey.trim(),
    tenantId: answers.tenantId.trim() || undefined,
  };

  // Test connectivity
  const client = new EngineClient(engineConfig);
  try {
    await client.health();
    console.log(chalk.green('  Connection verified.'));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.yellow(`  Warning: could not reach engine (${msg}).`));
    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: 'Save config anyway?',
        default: true,
      },
    ]);
    if (!proceed) {
      console.log(chalk.gray('  Setup cancelled.'));
      return;
    }
  }

  org.workflowEngine = engineConfig;
  cfg.organizations[cfg.currentOrg] = org;
  saveConfig(cfg);
  console.log(chalk.green('  Workflow engine config saved.'));

  // Reconnect MCP server to pick up new tools
  try {
    await ctx.reconnectAgent();
    console.log(chalk.gray('  Agent reconnected with engine tools.'));
  } catch {
    console.log(chalk.gray('  Restart the session to load engine tools.'));
  }
}

async function listBrands(slugFilter?: string): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const result = (await client.listBrands({ slug: slugFilter, limit: 50 })) as {
      items?: Array<Record<string, unknown>>;
    };
    const items = result?.items ?? (Array.isArray(result) ? result : []);
    if (!items.length) {
      console.log(chalk.gray('  No brands found.'));
      return;
    }

    console.log(chalk.bold(`  Brands (${items.length})`));
    const rows = items.map((brand) => ({
      id: String(brand.id ?? '').slice(0, 8),
      name: String(brand.name ?? brand.slug ?? 'unnamed'),
      status: String(brand.status ?? 'unknown'),
      mode: String(brand.routing_mode ?? '-'),
    }));
    console.log(formatTable(rows, ['id', 'name', 'status', 'mode']));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

async function startOnboarding(brandId: string): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const result = await client.createOnboardingRun(brandId);
    console.log(chalk.green('  Onboarding run created.'));
    console.log(chalk.gray(`  ${JSON.stringify(result, null, 2)}`));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

async function checkHealth(): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const result = await client.health();
    console.log(chalk.green('  Engine healthy'));
    if (result && typeof result === 'object') {
      console.log(chalk.gray(`  ${JSON.stringify(result, null, 2)}`));
    }
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Engine unreachable: ${msg}`));
  }
}

async function listTemplates(key?: string): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    if (key) {
      const result = await client.getWorkflowTemplate(key);
      console.log(chalk.gray(JSON.stringify(result, null, 2)));
    } else {
      const result = (await client.listWorkflowTemplates({ limit: 50 })) as {
        items?: Array<Record<string, unknown>>;
      };
      const items = result?.items ?? (Array.isArray(result) ? result : []);
      if (!items.length) {
        console.log(chalk.gray('  No workflow templates found.'));
        return;
      }
      console.log(chalk.bold(`  Workflow Templates (${items.length})`));
      for (const t of items) {
        const key = t.template_key ?? t.key ?? 'unknown';
        const name = t.name ?? '-';
        const version = t.version ?? '-';
        const status = t.status ?? 'unknown';
        console.log(
          `  ${chalk.white(String(key).padEnd(30))} v${version}  ${chalk.gray(String(name).padEnd(24))} ${chalk.gray(String(status))}`,
        );
      }
    }
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

async function listDlq(brandId: string): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const result = (await client.listDlq(brandId, { limit: 20 })) as {
      items?: Array<Record<string, unknown>>;
    };
    const items = result?.items ?? (Array.isArray(result) ? result : []);
    if (!items.length) {
      console.log(chalk.gray('  No DLQ items found.'));
      return;
    }
    console.log(chalk.bold(`  DLQ Items (${items.length})`));
    for (const item of items) {
      const id = String(item.id ?? '').slice(0, 8);
      const status = item.status ?? 'unknown';
      const error = item.error_message ?? item.error ?? '-';
      console.log(
        `  ${chalk.gray(id)}  ${chalk.yellow(String(status).padEnd(12))} ${chalk.gray(String(error).slice(0, 60))}`,
      );
    }
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function handleEngineCommand(input: string, ctx: ChatContext): Promise<CommandResult> {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed.startsWith('/engine')) {
    return NOT_HANDLED;
  }

  const parts = input.trim().split(/\s+/).slice(1);
  const subcommand = parts[0]?.toLowerCase() ?? '';

  switch (subcommand) {
    case '':
      await showStatus();
      return { handled: true };

    case 'setup':
      await runSetup(ctx);
      return { handled: true };

    case 'brands': {
      const slugFilter = parts[1];
      await listBrands(slugFilter);
      return { handled: true };
    }

    case 'onboard': {
      const brandId = parts[1];
      if (!brandId) {
        console.log(chalk.red('  Usage: /engine onboard <brand-id>'));
        return { handled: true };
      }
      await startOnboarding(brandId);
      return { handled: true };
    }

    case 'health':
      await checkHealth();
      return { handled: true };

    case 'templates': {
      const key = parts[1];
      await listTemplates(key);
      return { handled: true };
    }

    case 'dlq': {
      const brandId = parts[1];
      if (!brandId) {
        console.log(chalk.red('  Usage: /engine dlq <brand-id>'));
        return { handled: true };
      }
      await listDlq(brandId);
      return { handled: true };
    }

    default:
      // Fall through to agent for natural language engine queries
      return {
        handled: true,
        sendMessage: `Use the workflow engine tools to: ${parts.join(' ')}`,
      };
  }
}

export async function handleWorkflowsCommand(
  input: string,
  _ctx: ChatContext,
): Promise<CommandResult> {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed.startsWith('/workflows') && !trimmed.startsWith('/wf')) {
    return NOT_HANDLED;
  }

  const parts = input.trim().split(/\s+/).slice(1);
  const subcommand = parts[0]?.toLowerCase() ?? '';
  const arg = parts[1] ?? '';

  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return { handled: true };
  }

  const client = new EngineClient(config);

  switch (subcommand) {
    case '':
    case 'list': {
      // Delegate to agent for richer output
      return {
        handled: true,
        sendMessage:
          'Use the engine_list_brands tool to list brands, then use engine_get_workflow_status to check any active workflow runs.',
      };
    }

    case 'status': {
      if (!arg) {
        console.log(chalk.red('  Usage: /workflows status <workflow-id>'));
        return { handled: true };
      }
      try {
        const result = await client.getWorkflowStatus(arg);
        console.log(chalk.gray(JSON.stringify(result, null, 2)));
      } catch (err) {
        const msg = err instanceof EngineClientError ? err.message : String(err);
        console.log(chalk.red(`  Error: ${msg}`));
      }
      return { handled: true };
    }

    case 'cancel': {
      if (!arg) {
        console.log(chalk.red('  Usage: /workflows cancel <workflow-id>'));
        return { handled: true };
      }
      try {
        await client.cancelWorkflow(arg);
        console.log(chalk.green(`  Workflow ${arg} cancelled.`));
      } catch (err) {
        const msg = err instanceof EngineClientError ? err.message : String(err);
        console.log(chalk.red(`  Error: ${msg}`));
      }
      return { handled: true };
    }

    case 'start': {
      // Delegate to agent for interactive workflow start
      const brand = parts[1] ?? '';
      const ticketId = parts[2] ?? '';
      if (!brand || !ticketId) {
        return {
          handled: true,
          sendMessage:
            'Start a workflow: I need a brand slug and ticket ID. Use the engine_start_workflow tool.',
        };
      }
      return {
        handled: true,
        sendMessage: `Start a response automation workflow for brand "${brand}" with ticket ID "${ticketId}".`,
      };
    }

    case 'retry': {
      if (!arg) {
        console.log(chalk.red('  Usage: /workflows retry <brand-id>'));
        console.log(chalk.gray('  Lists and retries failed DLQ items for a brand.'));
        return { handled: true };
      }
      try {
        const result = (await client.listDlq(arg, { status: 'pending', limit: 10 })) as {
          items?: Array<Record<string, unknown>>;
        };
        const items =
          result?.items ??
          (Array.isArray(result) ? (result as Array<Record<string, unknown>>) : []);
        if (!items.length) {
          console.log(chalk.gray('  No pending DLQ items to retry.'));
          return { handled: true };
        }
        console.log(chalk.bold(`  Retrying ${items.length} DLQ items...`));
        let retried = 0;
        for (const item of items) {
          try {
            await client.retryDlqItem(arg, String(item.id));
            retried++;
          } catch {
            console.log(chalk.yellow(`  Failed to retry ${String(item.id).slice(0, 8)}`));
          }
        }
        console.log(chalk.green(`  Retried ${retried}/${items.length} items.`));
      } catch (err) {
        const msg = err instanceof EngineClientError ? err.message : String(err);
        console.log(chalk.red(`  Error: ${msg}`));
      }
      return { handled: true };
    }

    default:
      return {
        handled: true,
        sendMessage: `Use the workflow engine tools to: workflows ${parts.join(' ')}`,
      };
  }
}
