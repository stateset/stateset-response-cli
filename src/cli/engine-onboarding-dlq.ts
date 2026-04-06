import chalk from 'chalk';
import { getWorkflowEngineConfig } from '../config.js';
import { EngineClient, EngineClientError } from '../lib/engine-client.js';
import { formatTable } from '../utils/display.js';
import {
  cacheDlqItemIds,
  cacheOnboardingRunIds,
  rememberDlqItemId,
  rememberOnboardingRunId,
} from './engine-completion-cache.js';
import {
  asItems,
  formatDateTime,
  getBrandId,
  getBrandSlug,
  printNotConfigured,
  resolveRemoteBrand,
} from './engine-support.js';

async function startOnboarding(
  brandRef: string,
  notes?: string,
  cwd: string = process.cwd(),
): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(brand);
    const brandSlug = getBrandSlug(brand) || brandRef;
    if (!brandId) {
      throw new Error('Remote brand is missing id.');
    }

    const result = await client.createOnboardingRun(brandId, notes);
    rememberOnboardingRunId(
      [brandSlug, brandId],
      String((result as Record<string, unknown>)?.id ?? ''),
      cwd,
    );
    console.log(chalk.green('  Onboarding run created.'));
    console.log(chalk.gray(`  Brand: ${brandSlug}`));
    console.log(chalk.gray(`  ${JSON.stringify(result, null, 2)}`));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function startOnboardingRun(
  brandRef: string,
  notes?: string,
  cwd: string = process.cwd(),
): Promise<void> {
  await startOnboarding(brandRef, notes, cwd);
}

export async function listOnboardingRunsView(
  brandRef: string,
  cwd: string = process.cwd(),
): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(brand);
    const brandSlug = getBrandSlug(brand) || brandRef;
    if (!brandId) {
      throw new Error('Remote brand is missing id.');
    }

    const result = await client.listOnboardingRuns(brandId);
    const items = asItems(result);
    cacheOnboardingRunIds(
      [brandSlug, brandId],
      items.map((item) => String(item.id ?? '').trim()),
      cwd,
    );
    if (!items.length) {
      console.log(chalk.gray(`  No onboarding runs found for ${brandSlug}.`));
      return;
    }

    console.log(chalk.bold(`  Onboarding Runs: ${brandSlug}`));
    const rows = items.map((item) => ({
      id: String(item.id ?? '').slice(0, 8),
      status: String(item.status ?? 'unknown'),
      created_at: formatDateTime(item.created_at),
      updated_at: formatDateTime(item.updated_at),
      notes: String(item.notes ?? '').slice(0, 40) || '-',
    }));
    console.log(formatTable(rows, ['id', 'status', 'created_at', 'updated_at', 'notes']));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function showOnboardingRunView(
  brandRef: string,
  runId: string,
  cwd: string = process.cwd(),
): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(brand);
    const brandSlug = getBrandSlug(brand) || brandRef;
    if (!brandId) {
      throw new Error('Remote brand is missing id.');
    }

    const result = await client.getOnboardingRun(brandId, runId);
    rememberOnboardingRunId([brandSlug, brandId], runId, cwd);
    console.log(chalk.bold(`  Onboarding Run: ${brandSlug}/${runId}`));
    console.log(chalk.gray(`  ${JSON.stringify(result, null, 2)}`));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function updateOnboardingRunView(
  brandRef: string,
  runId: string,
  patch: { status?: string; notes?: string },
  cwd: string = process.cwd(),
): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(brand);
    const brandSlug = getBrandSlug(brand) || brandRef;
    if (!brandId) {
      throw new Error('Remote brand is missing id.');
    }

    const result = await client.updateOnboardingRun(brandId, runId, patch);
    rememberOnboardingRunId([brandSlug, brandId], runId, cwd);
    console.log(chalk.green(`  Updated onboarding run ${runId} for ${brandSlug}.`));
    console.log(chalk.gray(`  ${JSON.stringify(result, null, 2)}`));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function showBrandDlq(
  brandRef: string,
  filters: { status?: string; limit?: number; offset?: number } = {},
  cwd: string = process.cwd(),
): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(brand);
    const brandSlug = getBrandSlug(brand) || brandRef;
    if (!brandId) {
      throw new Error('Remote brand is missing id.');
    }

    const result = (await client.listDlq(brandId, {
      status: filters.status,
      limit: filters.limit ?? 20,
      offset: filters.offset ?? 0,
    })) as {
      items?: Array<Record<string, unknown>>;
    };
    const items = result?.items ?? (Array.isArray(result) ? result : []);
    cacheDlqItemIds(
      [brandSlug, brandId],
      items.map((item) => String(item.id ?? '').trim()),
      cwd,
    );
    if (!items.length) {
      console.log(chalk.gray(`  No DLQ items found for ${brandSlug}.`));
      return;
    }
    console.log(chalk.bold(`  DLQ Items: ${brandSlug} (${items.length})`));
    const rows = items.map((item) => ({
      id: String(item.id ?? '').slice(0, 8),
      status: String(item.status ?? 'unknown'),
      action: String(item.action ?? '-'),
      created_at: formatDateTime(item.created_at),
      error: String(item.error_message ?? item.error ?? '-').slice(0, 60),
    }));
    console.log(formatTable(rows, ['id', 'status', 'action', 'created_at', 'error']));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function retryBrandDlqItem(
  brandRef: string,
  dlqId: string,
  cwd: string = process.cwd(),
): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(brand);
    const brandSlug = getBrandSlug(brand) || brandRef;
    if (!brandId) {
      throw new Error('Remote brand is missing id.');
    }

    const result = await client.retryDlqItem(brandId, dlqId);
    rememberDlqItemId([brandSlug, brandId], dlqId, cwd);
    console.log(chalk.green(`  Retried DLQ item ${dlqId} for ${brandSlug}.`));
    console.log(chalk.gray(`  ${JSON.stringify(result, null, 2)}`));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}

export async function resolveBrandDlqItem(
  brandRef: string,
  dlqId: string,
  opts: { action?: string; notes?: string } = {},
  cwd: string = process.cwd(),
): Promise<void> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return;
  }

  const client = new EngineClient(config);
  try {
    const brand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(brand);
    const brandSlug = getBrandSlug(brand) || brandRef;
    if (!brandId) {
      throw new Error('Remote brand is missing id.');
    }

    const result = await client.resolveDlqItem(brandId, dlqId, opts);
    rememberDlqItemId([brandSlug, brandId], dlqId, cwd);
    console.log(chalk.green(`  Resolved DLQ item ${dlqId} for ${brandSlug}.`));
    console.log(chalk.gray(`  ${JSON.stringify(result, null, 2)}`));
  } catch (err) {
    const msg = err instanceof EngineClientError ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
  }
}
