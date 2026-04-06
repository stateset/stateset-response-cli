import chalk from 'chalk';

export interface CapabilityWorkflow {
  name: string;
  steps: string[];
}

export interface CapabilityArea {
  id: string;
  title: string;
  summary: string;
  commands: string[];
}

const CAPABILITY_AREAS: CapabilityArea[] = [
  {
    id: 'setup',
    title: 'Setup & Access',
    summary: 'Authenticate, verify the environment, and configure integrations and engine access.',
    commands: [
      'response init',
      'response auth login',
      'response auth switch <org-id>',
      'response doctor',
      'response integrations setup [integration]',
      'response engine setup',
    ],
  },
  {
    id: 'runtime',
    title: 'Agent Runtime',
    summary:
      'Run the assistant interactively, one-shot, in batch mode, or as local webhook/event workers.',
    commands: [
      'response chat',
      'response ask "..."',
      'response batch <file>',
      'response serve --forward-to-engine',
      'response events',
    ],
  },
  {
    id: 'workflow-studio',
    title: 'Workflow Studio',
    summary:
      'Bootstrap brands, manage local .stateset config, sync connectors, and apply local Temporal env.',
    commands: [
      'response engine brand-bootstrap <brand>',
      'response engine config pull <brand>',
      'response engine config validate <brand>',
      'response engine config push <brand>',
      'response engine connector-plan <brand>',
      'response engine connector-sync <brand>',
      'response engine connector-env <brand>',
      'response engine local-apply <brand>',
      'response engine test <brand> <ticket-id>',
    ],
  },
  {
    id: 'curation',
    title: 'Curation & Training Data',
    summary:
      'Inspect responses, create evals from real outputs, review them, and export SFT/DPO datasets.',
    commands: [
      'response datasets list',
      'response datasets create --name "<dataset>"',
      'response datasets import <dataset-id> <jsonl-file>',
      'response responses list',
      'response responses get <response-id>',
      'response evals create-from-response <response-id> --seed rejected',
      'response evals review',
      'response evals export --out .stateset/evals.json',
      'response finetune export --format all --validation-ratio 0.1',
      'response finetune validate .stateset/finetune',
      'response finetune create [dataset-file]',
      'response finetune deploy <model-id>',
    ],
  },
  {
    id: 'operations',
    title: 'Operations & Control Plane',
    summary:
      'Inspect live engine state, runs, DLQ, migrations, parity, templates, and policy sets.',
    commands: [
      'response engine brands',
      'response engine brand-show <brand>',
      'response engine executions <brand>',
      'response engine onboard-runs <brand>',
      'response engine dlq <brand>',
      'response engine migration <brand>',
      'response engine parity <brand>',
      'response engine templates',
      'response engine policy-sets',
      'response engine event <brand> <file>',
    ],
  },
  {
    id: 'resources',
    title: 'Resources & Config State',
    summary:
      'Manage rules, KB, agents, channels, conversations, messages, and config snapshots/deployments.',
    commands: [
      'response rules list',
      'response kb ingest <path>',
      'response agents list',
      'response channels list',
      'response convos recent',
      'response messages list',
      'response status',
      'response analytics',
      'response pull [dir]',
      'response push [source]',
      'response deployments',
    ],
  },
];

const CAPABILITY_WORKFLOWS: CapabilityWorkflow[] = [
  {
    name: 'Bootstrap a brand locally',
    steps: [
      'response init',
      'response engine brand-bootstrap <brand> --template ecommerce',
      'response engine config pull <brand>',
      'response engine connector-plan <brand>',
      'response engine local-apply <brand>',
    ],
  },
  {
    name: 'Iterate on workflow automation',
    steps: [
      'response engine config pull <brand>',
      'edit .stateset/<brand>/automation-config.json and rules/*.json',
      'response engine config validate <brand>',
      'response engine config push <brand>',
      'response engine activate <brand>',
    ],
  },
  {
    name: 'Curate live responses into finetuning data',
    steps: [
      'response datasets create --name "<dataset>"',
      'response datasets import <dataset-id> <jsonl-file>',
      'response responses list',
      'response evals create-from-response <response-id> --seed rejected',
      'response evals review',
      'response finetune export --format all --validation-ratio 0.1',
      'response finetune validate .stateset/finetune',
      'response finetune create [dataset-file]',
    ],
  },
];

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

export function listCapabilityAreas(): CapabilityArea[] {
  return [...CAPABILITY_AREAS];
}

export function listCapabilityWorkflows(): CapabilityWorkflow[] {
  return [...CAPABILITY_WORKFLOWS];
}

export function findCapabilityArea(query: string): CapabilityArea | null {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return null;
  }

  const direct = CAPABILITY_AREAS.find(
    (area) => area.id === normalized || normalizeQuery(area.title) === normalized,
  );
  if (direct) {
    return direct;
  }

  const prefix = CAPABILITY_AREAS.find(
    (area) => area.id.startsWith(normalized) || normalizeQuery(area.title).startsWith(normalized),
  );
  return prefix ?? null;
}

export function renderCapabilityMap(query?: string, json = false): string {
  const selectedAreas = query
    ? ([findCapabilityArea(query)].filter(Boolean) as CapabilityArea[])
    : CAPABILITY_AREAS;

  if (json) {
    return JSON.stringify(
      {
        areas: selectedAreas,
        workflows: CAPABILITY_WORKFLOWS,
      },
      null,
      2,
    );
  }

  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.bold('  CLI Capability Map'));
  lines.push(chalk.gray('  Grouped by jobs-to-be-done rather than raw command count.'));
  lines.push('');

  if (selectedAreas.length === 0) {
    lines.push(chalk.yellow(`  No capability area matched "${query}".`));
    lines.push('');
    return lines.join('\n');
  }

  for (const area of selectedAreas) {
    lines.push(chalk.bold(`  ${area.title}`));
    lines.push(chalk.gray(`  ${area.summary}`));
    for (const command of area.commands) {
      lines.push(chalk.cyan(`    ${command}`));
    }
    lines.push('');
  }

  if (!query) {
    lines.push(chalk.bold('  Common Workflows'));
    for (const workflow of CAPABILITY_WORKFLOWS) {
      lines.push(chalk.white(`  ${workflow.name}`));
      for (const step of workflow.steps) {
        lines.push(chalk.gray(`    ${step}`));
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

export function printCapabilityMap(query?: string, json = false): void {
  console.log(renderCapabilityMap(query, json));
}
