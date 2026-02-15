import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import {
  listIntegrations,
  type IntegrationDefinition,
  type IntegrationId,
} from '../integrations/registry.js';
import {
  loadIntegrationsStore,
  loadIntegrationsStoreForScope,
  saveIntegrationsStore,
  type IntegrationStoreScope,
} from '../integrations/store.js';
import { formatSuccess, formatWarning, formatTable } from '../utils/display.js';
import { readFirstEnvValue } from './utils.js';

export function getIntegrationEnvStatus(def: IntegrationDefinition): {
  status: string;
  anySet: boolean;
} {
  const requiredFields = def.fields.filter((field) => field.required !== false);
  const requiredSet = requiredFields.filter((field) =>
    Boolean(readFirstEnvValue(field.envVars)),
  ).length;
  const anySet = def.fields.some((field) => Boolean(readFirstEnvValue(field.envVars)));
  if (!anySet) return { status: '-', anySet };
  if (requiredSet === requiredFields.length) return { status: 'set', anySet };
  return { status: 'partial', anySet };
}

export function printIntegrationStatus(cwd: string): void {
  const integrations = listIntegrations();
  const { scope, path: storePath, store } = loadIntegrationsStore(cwd);
  const rows = integrations.map((def) => {
    const envStatus = getIntegrationEnvStatus(def).status;
    const entry = store.integrations[def.id];
    let configStatus = '-';
    if (entry) {
      if (entry.enabled === false) configStatus = 'disabled';
      else if (entry.config && Object.keys(entry.config).length > 0) configStatus = 'set';
      else configStatus = 'empty';
    }
    if (configStatus !== '-' && scope) {
      configStatus = `${configStatus} (${scope})`;
    }
    return {
      integration: def.label,
      env: envStatus,
      config: configStatus,
    };
  });

  console.log(formatSuccess('Integration status'));
  console.log(formatTable(rows, ['integration', 'env', 'config']));
  if (storePath) {
    console.log(chalk.gray(`  Config file: ${storePath}`));
  } else {
    console.log(chalk.gray('  No integrations config file found.'));
  }
  console.log(chalk.gray('  Tip: run "response integrations setup" to configure.'));
}

export async function runIntegrationsSetup(cwd: string): Promise<void> {
  const { scope: existingScope } = loadIntegrationsStore(cwd);
  const { scope } = await inquirer.prompt([
    {
      type: 'list',
      name: 'scope',
      message: 'Where should integration settings be saved?',
      choices: [
        { name: 'Global (~/.stateset/integrations.json)', value: 'global' },
        { name: 'Project (.stateset/integrations.json)', value: 'local' },
      ],
      default: existingScope ?? 'global',
    },
  ]);

  const { store } = loadIntegrationsStoreForScope(cwd, scope as IntegrationStoreScope);
  const definitions = listIntegrations();
  const defaults = definitions
    .filter((def) => store.integrations[def.id]?.enabled)
    .map((def) => def.id);

  const { selected } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selected',
      message: 'Select integrations to configure',
      pageSize: Math.min(12, definitions.length),
      choices: definitions.map((def) => ({
        name: `${def.label} — ${def.description}`,
        value: def.id,
        checked: defaults.includes(def.id),
      })),
    },
  ]);

  const selectedIds = (selected as IntegrationId[]) ?? [];
  const selectedSet = new Set(selectedIds);

  const disableCandidates = definitions
    .filter((def) => store.integrations[def.id] && !selectedSet.has(def.id))
    .map((def) => def.id);
  let disableOthers = false;
  if (disableCandidates.length > 0) {
    const response = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'disable',
        message: 'Disable integrations that were not selected?',
        default: true,
      },
    ]);
    disableOthers = Boolean(response.disable);
  }

  for (const def of definitions) {
    const existing = store.integrations[def.id]?.config ?? {};
    if (!selectedSet.has(def.id)) {
      if (disableOthers && store.integrations[def.id]) {
        store.integrations[def.id] = {
          ...store.integrations[def.id],
          enabled: false,
          updatedAt: new Date().toISOString(),
        };
      }
      continue;
    }

    const nextConfig: Record<string, string> = { ...existing };
    for (const field of def.fields) {
      const existingValue = existing[field.key];
      const defaultValue = existingValue || field.defaultValue || '';
      const isSecret = Boolean(field.secret);
      const envHint = field.envVars[0] ? ` (${field.envVars[0]})` : '';
      const promptLabel = `${def.label}: ${field.label}${envHint}`;
      const prompt = {
        type: isSecret ? 'password' : 'input',
        name: field.key,
        message:
          existingValue && isSecret ? `${promptLabel} (leave blank to keep existing)` : promptLabel,
        default: isSecret ? undefined : defaultValue,
        mask: isSecret ? '*' : undefined,
        validate: (value: string) => {
          const trimmed = String(value ?? '').trim();
          if (trimmed) return true;
          if (existingValue) return true;
          if (field.defaultValue) return true;
          if (field.required === false) return true;
          return `${field.label} is required.`;
        },
      } as const;

      const answers = await inquirer.prompt([prompt]);
      const raw = String(answers[field.key] ?? '').trim();
      if (raw) {
        nextConfig[field.key] = raw;
      } else if (!raw && existingValue) {
        nextConfig[field.key] = existingValue;
      } else if (!raw && field.defaultValue && !nextConfig[field.key]) {
        nextConfig[field.key] = field.defaultValue;
      }
    }

    store.integrations[def.id] = {
      enabled: true,
      config: nextConfig,
      updatedAt: new Date().toISOString(),
    };
  }

  const filePath = saveIntegrationsStore(cwd, scope as IntegrationStoreScope, store);
  console.log(formatSuccess(`Saved integrations to ${filePath}`));
  const enabled = definitions
    .filter((def) => store.integrations[def.id]?.enabled)
    .map((def) => def.label);
  console.log(chalk.gray(`  Enabled: ${enabled.length ? enabled.join(', ') : 'none'}`));
  console.log(chalk.gray('  Environment variables always override stored settings.'));
}

export function registerIntegrationsCommands(program: Command): void {
  const integrations = program
    .command('integrations')
    .description('Configure and inspect integrations');

  integrations
    .command('status')
    .description('Show integration configuration status')
    .action(() => {
      printIntegrationStatus(process.cwd());
    });

  integrations
    .command('setup')
    .description('Interactive integration configuration wizard')
    .action(async () => {
      await runIntegrationsSetup(process.cwd());
    });

  integrations
    .command('edit')
    .description('Open the integrations config file path')
    .action(() => {
      const { scope, path: storePath } = loadIntegrationsStore(process.cwd());
      if (!storePath) {
        const defaultPath = loadIntegrationsStoreForScope(process.cwd(), 'global').path;
        console.log(formatWarning('No integrations config file found.'));
        console.log(chalk.gray(`  Default path: ${defaultPath}`));
        return;
      }
      console.log(formatSuccess(`Integrations config (${scope}): ${storePath}`));
    });
}
