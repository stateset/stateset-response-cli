import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import {
  configExists,
  getCurrentOrg,
  getAnthropicApiKey,
  getConfigPath,
  getConfiguredModel,
  MODEL_IDS,
} from '../config.js';
import { requestText } from '../integrations/http.js';
import { getIntegrationReadiness, getIntegrationSnapshots } from './commands-integrations.js';
import { getErrorMessage } from '../lib/errors.js';
import { getStateSetDir, getSessionStorageStats, cleanupSessions } from '../session.js';
import { getWorkflowEngineConfig } from '../config.js';

export interface DoctorCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  fix?: () => void;
  fixDescription?: string;
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
      message: `GraphQL endpoint unreachable: ${getErrorMessage(e)}`,
    };
  }
}

function checkIntegrations(): DoctorCheck[] {
  return getIntegrationSnapshots(process.cwd()).map((snapshot) => {
    const readiness = getIntegrationReadiness(snapshot);
    if (readiness === 'ready') {
      return {
        name: snapshot.label,
        status: 'pass' as const,
        message: `${snapshot.label}: configured`,
      };
    }
    if (readiness === 'invalid-config') {
      return {
        name: snapshot.label,
        status: 'warn' as const,
        message: `${snapshot.label}: invalid configuration`,
      };
    }
    if (readiness === 'disabled') {
      return {
        name: snapshot.label,
        status: 'warn' as const,
        message: `${snapshot.label}: disabled`,
      };
    }
    if (readiness === 'partial') {
      return {
        name: snapshot.label,
        status: 'warn' as const,
        message: `${snapshot.label}: partially configured (missing required fields)`,
      };
    }
    return {
      name: snapshot.label,
      status: 'warn' as const,
      message: `${snapshot.label}: not configured`,
    };
  });
}

// ---------------------------------------------------------------------------
// New checks
// ---------------------------------------------------------------------------

function checkFilePermissions(): DoctorCheck {
  if (process.platform === 'win32') {
    return { name: 'Permissions', status: 'pass', message: 'Skipped on Windows' };
  }

  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return { name: 'Permissions', status: 'warn', message: 'Config file does not exist yet' };
  }

  try {
    const stat = fs.statSync(configPath);
    const mode = stat.mode & 0o777;
    if (mode !== 0o600) {
      return {
        name: 'Permissions',
        status: 'warn',
        message: `Config file permissions are 0o${mode.toString(8)} (expected 0o600)`,
        fix: () => {
          fs.chmodSync(configPath, 0o600);
          const statesetDir = getStateSetDir();
          if (fs.existsSync(statesetDir)) {
            fs.chmodSync(statesetDir, 0o700);
          }
        },
        fixDescription: 'Set config file to 0o600 and directory to 0o700',
      };
    }
    return { name: 'Permissions', status: 'pass', message: 'Config file permissions OK (0o600)' };
  } catch (e) {
    return {
      name: 'Permissions',
      status: 'warn',
      message: `Could not check permissions: ${getErrorMessage(e)}`,
    };
  }
}

function checkModelAvailability(): DoctorCheck {
  try {
    const model = getConfiguredModel();
    const modelSet = new Set<string>(MODEL_IDS);
    if (modelSet.has(model)) {
      return {
        name: 'Model',
        status: 'pass',
        message: `Configured model: ${model}`,
      };
    }
    return {
      name: 'Model',
      status: 'warn',
      message: `Unknown model "${model}". Valid: ${MODEL_IDS.join(', ')}`,
    };
  } catch {
    return { name: 'Model', status: 'pass', message: 'Using default model' };
  }
}

function checkSessionHealth(): DoctorCheck {
  try {
    const stats = getSessionStorageStats();
    const sizeMB = (stats.totalBytes / (1024 * 1024)).toFixed(1);
    const message = `${stats.totalSessions} sessions (${sizeMB} MB), ${stats.emptySessions} empty`;

    if (stats.emptySessions > 20) {
      return {
        name: 'Sessions',
        status: 'warn',
        message: `${message}. Consider running "response doctor --fix" or "/session cleanup".`,
        fix: () => {
          cleanupSessions({ maxAgeDays: 90 });
        },
        fixDescription: 'Remove empty sessions older than 90 days',
      };
    }
    return { name: 'Sessions', status: 'pass', message };
  } catch {
    return { name: 'Sessions', status: 'pass', message: 'No sessions found' };
  }
}

function checkKnowledgeBase(): DoctorCheck {
  const kbHost = process.env.STATESET_KB_HOST?.trim();
  if (!kbHost) {
    return {
      name: 'Knowledge Base',
      status: 'warn',
      message: 'STATESET_KB_HOST not set (knowledge base disabled)',
    };
  }
  return {
    name: 'Knowledge Base',
    status: 'pass',
    message: `Knowledge base host: ${kbHost}`,
  };
}

function checkDiskSpace(): DoctorCheck {
  const statesetDir = getStateSetDir();
  if (!fs.existsSync(statesetDir)) {
    return { name: 'Disk', status: 'pass', message: 'StateSet directory not yet created' };
  }

  try {
    let totalBytes = 0;
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = `${dir}/${entry.name}`;
        if (entry.isFile()) {
          try {
            totalBytes += fs.statSync(full).size;
          } catch {
            // skip
          }
        } else if (entry.isDirectory()) {
          walk(full);
        }
      }
    };
    walk(statesetDir);

    const sizeMB = totalBytes / (1024 * 1024);
    if (sizeMB > 500) {
      return {
        name: 'Disk',
        status: 'warn',
        message: `~/.stateset uses ${sizeMB.toFixed(0)} MB (> 500 MB threshold)`,
      };
    }
    return {
      name: 'Disk',
      status: 'pass',
      message: `~/.stateset uses ${sizeMB.toFixed(1)} MB`,
    };
  } catch (e) {
    return {
      name: 'Disk',
      status: 'warn',
      message: `Could not measure disk usage: ${getErrorMessage(e)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Main check runner
// ---------------------------------------------------------------------------

async function checkWorkflowEngine(): Promise<DoctorCheck> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    return {
      name: 'Workflow Engine',
      status: 'warn',
      message: 'Workflow engine not configured (optional)',
    };
  }

  try {
    const { EngineClient } = await import('../lib/engine-client.js');
    const client = new EngineClient(config);
    await client.health();
    return {
      name: 'Workflow Engine',
      status: 'pass',
      message: `Workflow engine connected (${config.url})`,
    };
  } catch (err) {
    return {
      name: 'Workflow Engine',
      status: 'fail',
      message: `Workflow engine unreachable: ${getErrorMessage(err)}`,
    };
  }
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

  // New checks
  checks.push(checkFilePermissions());
  checks.push(checkModelAvailability());
  checks.push(checkSessionHealth());
  checks.push(checkKnowledgeBase());
  checks.push(checkDiskSpace());

  try {
    checks.push(await checkWorkflowEngine());
  } catch {
    checks.push({
      name: 'Workflow Engine',
      status: 'warn',
      message: 'Could not check workflow engine',
    });
  }

  checks.push(checkMetricsStorageSize());
  checks.push(checkSessionIntegrity());

  return checks;
}

function checkMetricsStorageSize(): DoctorCheck {
  try {
    const metricsDir = `${getStateSetDir()}/metrics`;
    if (!fs.existsSync(metricsDir)) {
      return {
        name: 'Metrics Storage',
        status: 'pass',
        message: 'Metrics directory not yet created',
      };
    }
    let totalSize = 0;
    const entries = fs.readdirSync(metricsDir);
    for (const entry of entries) {
      try {
        const stat = fs.statSync(`${metricsDir}/${entry}`);
        totalSize += stat.size;
      } catch {
        // skip
      }
    }
    const sizeMb = totalSize / (1024 * 1024);
    if (sizeMb > 100) {
      return {
        name: 'Metrics Storage',
        status: 'warn',
        message: `Metrics directory is ${sizeMb.toFixed(0)}MB. Consider pruning old session metrics.`,
      };
    }
    return {
      name: 'Metrics Storage',
      status: 'pass',
      message: `Metrics storage: ${entries.length} files (${sizeMb.toFixed(1)}MB)`,
    };
  } catch {
    return { name: 'Metrics Storage', status: 'pass', message: 'Metrics storage check skipped' };
  }
}

function checkSessionIntegrity(): DoctorCheck {
  try {
    const stats = getSessionStorageStats();
    if (stats.emptySessions > 10) {
      return {
        name: 'Session Integrity',
        status: 'warn',
        message: `${stats.emptySessions} empty sessions found. Run "/session cleanup" to remove stale sessions.`,
      };
    }
    return {
      name: 'Session Integrity',
      status: 'pass',
      message: `${stats.totalSessions} sessions (${stats.emptySessions} empty)`,
    };
  } catch {
    return {
      name: 'Session Integrity',
      status: 'pass',
      message: 'Session integrity check skipped',
    };
  }
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Run pre-flight diagnostics to verify configuration and connectivity')
    .option('--fix', 'Attempt to auto-fix issues that have a known fix')
    .action(async (opts: { fix?: boolean }) => {
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

      if (opts.fix) {
        const fixable = checks.filter((c) => c.status !== 'pass' && c.fix);
        if (fixable.length === 0) {
          console.log(chalk.gray('  No auto-fixable issues found.'));
        } else {
          console.log('');
          console.log(chalk.bold('  Applying fixes:'));
          for (const check of fixable) {
            try {
              check.fix!();
              console.log(chalk.green(`  [FIXED] ${check.name}: ${check.fixDescription}`));
            } catch (e) {
              console.log(chalk.red(`  [ERROR] ${check.name}: ${getErrorMessage(e)}`));
            }
          }
        }
      }

      console.log('');

      if (failed > 0) {
        process.exitCode = 1;
        return;
      }
    });
}
