import { Command } from 'commander';
import chalk from 'chalk';
import { configExists, getCurrentOrg, getAnthropicApiKey } from '../config.js';
import { requestText } from '../integrations/http.js';
import { listIntegrations } from '../integrations/registry.js';
import { getIntegrationEnvStatus } from './commands-integrations.js';

export interface DoctorCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

const STATUS_ICONS: Record<DoctorCheck['status'], string> = {
  pass: chalk.green('[PASS]'),
  fail: chalk.red('[FAIL]'),
  warn: chalk.yellow('[WARN]'),
};

function checkNodeVersion(): DoctorCheck {
  const raw = process.versions.node || '0.0.0';
  const major = Number.parseInt(raw.split('.')[0] || '0', 10);
  if (!Number.isFinite(major) || major < 18) {
    return { name: 'Node.js', status: 'fail', message: `Node.js ${raw} (>= 18 required)` };
  }
  return { name: 'Node.js', status: 'pass', message: `Node.js v${raw} (>= 18 required)` };
}

function checkConfigFile(): DoctorCheck {
  if (!configExists()) {
    return {
      name: 'Config',
      status: 'fail',
      message: 'Configuration file not found. Run "response auth login".',
    };
  }
  return { name: 'Config', status: 'pass', message: 'Configuration file found' };
}

function checkApiKey(): DoctorCheck {
  try {
    getAnthropicApiKey();
    return { name: 'API Key', status: 'pass', message: 'Anthropic API key configured' };
  } catch {
    return {
      name: 'API Key',
      status: 'fail',
      message: 'No Anthropic API key. Set ANTHROPIC_API_KEY or run "response auth login".',
    };
  }
}

function checkCurrentOrg(): DoctorCheck {
  try {
    const { orgId, config } = getCurrentOrg();
    return {
      name: 'Organization',
      status: 'pass',
      message: `Current org: ${orgId} (${config.name})`,
    };
  } catch (e) {
    return {
      name: 'Organization',
      status: 'fail',
      message: e instanceof Error ? e.message : 'No organization configured',
    };
  }
}

async function checkGraphQLEndpoint(): Promise<DoctorCheck> {
  try {
    const { config } = getCurrentOrg();
    const endpoint = config.graphqlEndpoint;
    if (!endpoint) {
      return { name: 'GraphQL', status: 'fail', message: 'No GraphQL endpoint configured' };
    }
    const start = Date.now();
    const res = await requestText(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
      timeoutMs: 5000,
    });
    const elapsed = Date.now() - start;
    if (res.status >= 200 && res.status < 400) {
      return {
        name: 'GraphQL',
        status: 'pass',
        message: `GraphQL endpoint reachable (${elapsed}ms)`,
      };
    }
    return {
      name: 'GraphQL',
      status: 'warn',
      message: `GraphQL endpoint returned HTTP ${res.status} (${elapsed}ms)`,
    };
  } catch (e) {
    return {
      name: 'GraphQL',
      status: 'fail',
      message: `GraphQL endpoint unreachable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function checkIntegrations(): DoctorCheck[] {
  const integrations = listIntegrations();
  return integrations.map((def) => {
    const { status } = getIntegrationEnvStatus(def);
    if (status === 'set') {
      return { name: def.label, status: 'pass' as const, message: `${def.label}: configured` };
    }
    if (status === 'partial') {
      return {
        name: def.label,
        status: 'warn' as const,
        message: `${def.label}: partially configured (missing required fields)`,
      };
    }
    return {
      name: def.label,
      status: 'warn' as const,
      message: `${def.label}: not configured`,
    };
  });
}

export async function runDoctorChecks(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  checks.push(checkNodeVersion());
  checks.push(checkConfigFile());
  checks.push(checkApiKey());
  checks.push(checkCurrentOrg());

  // Only check endpoint if config + org are available
  if (checks.every((c) => c.status !== 'fail' || c.name === 'API Key')) {
    try {
      checks.push(await checkGraphQLEndpoint());
    } catch {
      checks.push({ name: 'GraphQL', status: 'fail', message: 'Could not check endpoint' });
    }
  }

  checks.push(...checkIntegrations());

  return checks;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Run pre-flight diagnostics to verify configuration and connectivity')
    .action(async () => {
      console.log('');
      console.log(chalk.bold('  response doctor'));
      console.log('');

      const checks = await runDoctorChecks();

      for (const check of checks) {
        console.log(`  ${STATUS_ICONS[check.status]} ${check.message}`);
      }

      const passed = checks.filter((c) => c.status === 'pass').length;
      const warnings = checks.filter((c) => c.status === 'warn').length;
      const failed = checks.filter((c) => c.status === 'fail').length;

      console.log('');
      console.log(chalk.gray(`  ${passed} passed, ${warnings} warning(s), ${failed} failed`));
      console.log('');

      if (failed > 0) {
        process.exit(1);
      }
    });
}
