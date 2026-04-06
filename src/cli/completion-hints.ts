export const STATIC_FLAG_HINTS: Record<string, string[]> = {
  'webhooks list': ['--limit'],
  'webhooks create': ['--events', '--enabled'],
  'webhooks update': ['--url', '--events', '--enabled'],
  'webhooks deliveries': ['--limit'],
  'webhooks logs': ['--limit'],
  'engine connectors plan': ['--source'],
  'engine connectors sync': ['--source'],
  'evals list': ['--limit', '--offset'],
  'evals create': [
    '--name',
    '--type',
    '--ticket-id',
    '--description',
    '--message',
    '--preferred',
    '--rejected',
    '--reason',
    '--impact',
  ],
  'evals create-from-response': [
    '--name',
    '--type',
    '--ticket-id',
    '--description',
    '--message',
    '--preferred',
    '--rejected',
    '--reason',
    '--impact',
  ],
  'evals update': [
    '--name',
    '--type',
    '--ticket-id',
    '--description',
    '--message',
    '--preferred',
    '--rejected',
    '--reason',
    '--impact',
  ],
  'evals export': ['--out'],
  'datasets list': ['--limit', '--offset'],
  'datasets create': ['--name', '--description', '--metadata'],
  'datasets update': ['--name', '--description', '--metadata'],
  'datasets add-entry': ['--messages', '--file'],
  'datasets update-entry': ['--messages', '--file'],
  'datasets export': ['--out'],
  'finetune export': ['--validation-ratio'],
  'agents create': [
    '--all',
    '--model',
    '--name',
    '--type',
    '--description',
    '--role',
    '--goal',
    '--instructions',
    '--voice-model',
    '--voice-model-id',
    '--voice-model-provider',
  ],
  'agents update': [
    '--all',
    '--model',
    '--name',
    '--type',
    '--description',
    '--role',
    '--goal',
    '--instructions',
    '--voice-model',
    '--voice-model-id',
    '--voice-model-provider',
  ],
  'deployments list': ['--limit', '--offset'],
  'deployments approve': ['--from', '--dry-run', '--yes', '--strict', '--include-secrets'],
  'deployments retry': ['--from', '--dry-run', '--yes', '--strict', '--include-secrets'],
  'deployments reschedule': ['--schedule'],
  'engine dispatch-health': ['--tenant-id', '--limit', '--offset'],
  'engine dispatch-guard': ['--tenant-id', '--apply', '--minimum-health-status', '--max-actions'],
  'engine connectors env': ['--unsafe-path'],
  'engine local apply': ['--write-only', '--unsafe-path'],
};

const LOOP_MODE_VALUES = ['subscriptions', 'returns', 'both'] as const;
const SECRET_FORMAT_VALUES = ['dotenv', 'shell', 'json'] as const;
const LOCAL_APPLY_ASSIGNMENT_HINTS = ['out=', 'compose=', 'services='] as const;
const CONNECTOR_ENV_ASSIGNMENT_HINTS = ['out='] as const;
const WORKFLOW_STUDIO_TEMPLATE_VALUES = ['ecommerce', 'subscription', 'knowledge_base'] as const;
const ENGINE_EXECUTION_STATUS_VALUES = [
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'cancelled',
] as const;
const ONBOARDING_STATUS_VALUES = ['pending', 'completed', 'failed', 'cancelled'] as const;
const DLQ_STATUS_VALUES = ['pending', 'resolved', 'retried', 'failed'] as const;
const DLQ_RESOLUTION_ACTION_VALUES = ['resolved'] as const;

export const STATIC_FLAG_VALUE_HINTS: Record<string, Record<string, string[]>> = {
  '': {
    '--model': ['sonnet', 'haiku', 'opus'],
    '--output': ['json', 'pretty', 'minimal'],
  },
  'webhooks create': {
    '--enabled': ['true', 'false'],
  },
  'webhooks update': {
    '--enabled': ['true', 'false'],
  },
  'engine connectors plan': {
    '--source': ['local', 'platform'],
  },
  'engine connectors sync': {
    '--source': ['local', 'platform'],
  },
  'evals list': {
    '--status': ['pending', 'approved', 'rejected'],
  },
  'evals create': {
    '--status': ['pending', 'approved', 'rejected'],
  },
  'evals create-from-response': {
    '--seed': ['preferred', 'rejected', 'none'],
    '--status': ['pending', 'approved', 'rejected'],
  },
  'evals update': {
    '--status': ['pending', 'approved', 'rejected'],
  },
  'evals review': {
    '--status': ['pending', 'approved', 'rejected'],
  },
  'datasets create': {
    '--status': ['active', 'archived', 'draft'],
  },
  'datasets update': {
    '--status': ['active', 'archived', 'draft'],
  },
  'finetune export': {
    '--format': [
      'all',
      'sft',
      'dpo',
      'openai-sft',
      'studio-sft',
      'trl-sft',
      'studio-dpo',
      'pair-dpo',
    ],
    '--status': ['approved', 'pending', 'rejected'],
  },
  'finetune validate': {
    '--format': ['auto', 'openai-sft', 'studio-sft', 'trl-sft', 'studio-dpo', 'pair-dpo'],
  },
  'finetune create': {
    '--method': ['supervised', 'dpo'],
  },
  'agents create': {
    '--active': ['on', 'off'],
  },
  'agents update': {
    '--active': ['on', 'off'],
  },
  'deployments list': {
    '--mode': ['deploy', 'rollback'],
    '--status': ['scheduled', 'approved', 'applied', 'failed', 'cancelled'],
  },
  'engine connector-plan': {
    '--loop-mode': ['subscriptions', 'returns', 'both'],
    '--source': ['local', 'platform'],
  },
  'engine connector-sync': {
    '--loop-mode': ['subscriptions', 'returns', 'both'],
    '--source': ['local', 'platform'],
  },
  'engine connector-env': {
    '--loop-mode': ['subscriptions', 'returns', 'both'],
    '--format': ['dotenv', 'shell', 'json'],
  },
  'engine dispatch-guard': {
    '--apply': ['true', 'false'],
    '--minimum-health-status': ['warning', 'critical'],
  },
  'engine local-apply': {
    '--loop-mode': ['subscriptions', 'returns', 'both'],
  },
};

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export function getCompletionFlagValues(path: string, flag: string): string[] {
  const normalizedFlag = flag.trim();
  if (!normalizedFlag.startsWith('--')) {
    return [];
  }

  let currentPath = path.trim();
  while (currentPath) {
    const entry = STATIC_FLAG_VALUE_HINTS[currentPath];
    const values = entry?.[normalizedFlag];
    if (values && values.length > 0) {
      return uniqueSorted(values);
    }

    const nextBoundary = currentPath.lastIndexOf(' ');
    currentPath = nextBoundary >= 0 ? currentPath.slice(0, nextBoundary) : '';
  }

  if (!path.trim()) {
    const values = STATIC_FLAG_VALUE_HINTS['']?.[normalizedFlag];
    if (values && values.length > 0) {
      return uniqueSorted(values);
    }
  }

  return [];
}

export function getCompletionFlags(path: string): string[] {
  const values = new Set<string>();
  let currentPath = path.trim();

  while (currentPath) {
    for (const flag of STATIC_FLAG_HINTS[currentPath] ?? []) {
      values.add(flag);
    }
    for (const flag of Object.keys(STATIC_FLAG_VALUE_HINTS[currentPath] ?? {})) {
      values.add(flag);
    }

    const nextBoundary = currentPath.lastIndexOf(' ');
    currentPath = nextBoundary >= 0 ? currentPath.slice(0, nextBoundary) : '';
  }

  if (!path.trim()) {
    for (const flag of STATIC_FLAG_HINTS[''] ?? []) {
      values.add(flag);
    }
    for (const flag of Object.keys(STATIC_FLAG_VALUE_HINTS[''] ?? {})) {
      values.add(flag);
    }
  }

  return uniqueSorted([...values]);
}

function collectSlashPositionals(parts: string[]): string[] {
  const positionals: string[] = [];
  for (let index = 1; index < parts.length; index++) {
    const token = parts[index];
    if (!token) {
      continue;
    }
    if (token.startsWith('--')) {
      index++;
      continue;
    }
    if (index > 1 && parts[index - 1]?.startsWith('--')) {
      continue;
    }
    positionals.push(token);
  }
  return positionals;
}

function isLoopModeToken(token: string): boolean {
  return LOOP_MODE_VALUES.includes(token as (typeof LOOP_MODE_VALUES)[number]);
}

function isSecretFormatToken(token: string): boolean {
  return SECRET_FORMAT_VALUES.includes(token as (typeof SECRET_FORMAT_VALUES)[number]);
}

function isWorkflowStudioTemplateToken(token: string): boolean {
  return WORKFLOW_STUDIO_TEMPLATE_VALUES.includes(
    token as (typeof WORKFLOW_STUDIO_TEMPLATE_VALUES)[number],
  );
}

function isOnboardingStatusToken(token: string): boolean {
  return ONBOARDING_STATUS_VALUES.includes(token as (typeof ONBOARDING_STATUS_VALUES)[number]);
}

function isDlqStatusToken(token: string): boolean {
  return DLQ_STATUS_VALUES.includes(token as (typeof DLQ_STATUS_VALUES)[number]);
}

function isDlqResolutionActionToken(token: string): boolean {
  return DLQ_RESOLUTION_ACTION_VALUES.includes(
    token as (typeof DLQ_RESOLUTION_ACTION_VALUES)[number],
  );
}

function collectEngineConnectorEnvHints(positionals: string[]): string[] {
  let hasLoopMode = false;
  let hasFormat = false;

  for (const token of positionals.slice(3)) {
    if (isLoopModeToken(token) && !hasLoopMode) {
      hasLoopMode = true;
      continue;
    }
    if (isSecretFormatToken(token) && !hasFormat) {
      hasFormat = true;
      continue;
    }
    if (token.startsWith('out=')) {
      continue;
    }
    return [];
  }

  const hints: string[] = [];
  if (!hasLoopMode) {
    hints.push(...LOOP_MODE_VALUES);
  }
  if (!hasFormat) {
    hints.push(...SECRET_FORMAT_VALUES);
  }
  hints.push(...CONNECTOR_ENV_ASSIGNMENT_HINTS);
  return uniqueSorted(hints);
}

function collectEngineLocalApplyHints(positionals: string[]): string[] {
  let hasLoopMode = false;

  for (const token of positionals.slice(3)) {
    if (isLoopModeToken(token) && !hasLoopMode) {
      hasLoopMode = true;
      continue;
    }
    if (token.startsWith('out=') || token.startsWith('compose=') || token.startsWith('services=')) {
      continue;
    }
    return [];
  }

  const hints: string[] = [...LOCAL_APPLY_ASSIGNMENT_HINTS];
  if (!hasLoopMode) {
    hints.push(...LOOP_MODE_VALUES);
  }
  return uniqueSorted(hints);
}

function collectEngineBrandBootstrapHints(positionals: string[]): string[] {
  let hasTemplate = false;
  let hasActivate = false;

  for (const token of positionals.slice(3)) {
    if (token === 'activate' && !hasActivate) {
      hasActivate = true;
      continue;
    }
    if (isWorkflowStudioTemplateToken(token) && !hasTemplate) {
      hasTemplate = true;
      continue;
    }
    return [];
  }

  const hints: string[] = [];
  if (!hasTemplate) {
    hints.push(...WORKFLOW_STUDIO_TEMPLATE_VALUES);
  }
  if (!hasActivate) {
    hints.push('activate');
  }
  return uniqueSorted(hints);
}

export function getSlashPositionalHints(parts: string[]): string[] {
  const command = parts[0]?.replace(/^\//, '') ?? '';
  if (command !== 'engine') {
    return [];
  }

  const positionals = collectSlashPositionals(parts);
  const group = positionals[0];
  if (group === 'brands' && positionals[1] === 'bootstrap' && positionals[2]) {
    return collectEngineBrandBootstrapHints(positionals);
  }

  if (group === 'executions' && positionals[1]) {
    return positionals.length === 2 ? [...ENGINE_EXECUTION_STATUS_VALUES] : [];
  }

  if (group === 'onboard' && positionals[1] === 'update' && positionals[2] && positionals[3]) {
    const status = positionals[4];
    if (!status) {
      return [...ONBOARDING_STATUS_VALUES];
    }
    return isOnboardingStatusToken(status) ? [] : [];
  }

  if (group === 'dlq') {
    if (positionals[1] === 'resolve' && positionals[2] && positionals[3]) {
      const resolutionAction = positionals[4];
      if (!resolutionAction) {
        return [...DLQ_RESOLUTION_ACTION_VALUES];
      }
      return isDlqResolutionActionToken(resolutionAction) ? [] : [];
    }
    if (
      positionals[1] &&
      positionals[1] !== 'retry' &&
      positionals[1] !== 'resolve' &&
      !isDlqStatusToken(positionals[1])
    ) {
      return positionals.length === 2 ? [...DLQ_STATUS_VALUES] : [];
    }
  }

  if (group === 'connectors') {
    const brandRef = positionals[1];
    const action = positionals[2];
    if (!brandRef || !action) {
      return [];
    }
    if (action === 'plan' || action === 'sync') {
      return positionals.length === 3 ? [...LOOP_MODE_VALUES] : [];
    }
    if (action === 'env') {
      return collectEngineConnectorEnvHints(positionals);
    }
    return [];
  }

  if (group === 'local' && positionals[1] === 'apply' && positionals[2]) {
    return collectEngineLocalApplyHints(positionals);
  }

  return [];
}

export function resolveSlashCompletionHintPath(parts: string[]): string {
  const command = parts[0]?.replace(/^\//, '') ?? '';
  if (!command) {
    return '';
  }

  const positionals = collectSlashPositionals(parts);

  switch (command) {
    case 'evals':
    case 'webhooks':
    case 'datasets':
    case 'finetune':
    case 'agents':
    case 'deployments': {
      if (positionals.length >= 1) {
        return `${command} ${positionals[0]}`;
      }
      return command;
    }

    case 'engine': {
      const group = positionals[0];
      if (!group) {
        return 'engine';
      }
      if (group === 'connectors') {
        if (positionals.length >= 3) {
          return `engine connectors ${positionals[2]}`;
        }
        return 'engine connectors';
      }
      if (group === 'local') {
        if (positionals[1] === 'apply') {
          return 'engine local apply';
        }
        return 'engine local';
      }
      if (positionals.length >= 2) {
        return `engine ${group} ${positionals[1]}`;
      }
      return `engine ${group}`;
    }

    default:
      return command;
  }
}
