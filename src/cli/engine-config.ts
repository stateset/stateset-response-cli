import chalk from 'chalk';
import {
  buildBrandStudioBundle,
  loadBrandStudioBundle,
  validateBrandStudioBundle,
  writeBrandStudioBundle,
} from '../lib/brand-studio.js';
import {
  buildDefaultManifest,
  type AutomationConfig,
  type BrandManifest,
  type ConnectorSpec,
} from '../lib/manifest-builder.js';
import { getWorkflowEngineConfig } from '../config.js';
import { EngineClient, EngineClientError } from '../lib/engine-client.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RemoteBrandRecord = Record<string, unknown>;

function printNotConfigured(): void {
  console.log(chalk.yellow('  Workflow engine not configured.'));
  console.log(
    chalk.gray(
      '  Run /engine setup or set WORKFLOW_ENGINE_URL + WORKFLOW_ENGINE_API_KEY env vars.',
    ),
  );
}

function asItems(result: unknown): RemoteBrandRecord[] {
  if (Array.isArray(result)) {
    return result as RemoteBrandRecord[];
  }
  if (
    result &&
    typeof result === 'object' &&
    Array.isArray((result as { items?: unknown[] }).items)
  ) {
    return (result as { items: RemoteBrandRecord[] }).items;
  }
  return [];
}

function getBrandId(brand: RemoteBrandRecord): string {
  return String(brand.id ?? brand.brand_id ?? '');
}

function getBrandSlug(brand: RemoteBrandRecord): string {
  return String(brand.slug ?? brand.brand_slug ?? '').trim();
}

function getBrandDisplayName(brand: RemoteBrandRecord): string {
  return String(brand.display_name ?? brand.name ?? brand.slug ?? 'unnamed').trim();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toAutomationConfig(
  value: unknown,
  brandSlug: string,
  displayName: string,
): AutomationConfig | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  if (typeof value.workflow_name === 'string') {
    return value as unknown as AutomationConfig;
  }
  if (isObject(value.config) && typeof value.config.workflow_name === 'string') {
    return value.config as unknown as AutomationConfig;
  }
  return buildDefaultManifest(brandSlug, displayName).workflow_bindings[0].deterministic_config;
}

function parseRoutingMode(value: unknown): BrandManifest['routing_mode'] | undefined {
  if (value === 'legacy' || value === 'shadow' || value === 'canary' || value === 'live') {
    return value;
  }
  return undefined;
}

function parseStatus(value: unknown): BrandManifest['status'] | undefined {
  if (
    value === 'draft' ||
    value === 'validating' ||
    value === 'active' ||
    value === 'suspended' ||
    value === 'archived'
  ) {
    return value;
  }
  return undefined;
}

function parseConnectors(value: unknown): ConnectorSpec[] {
  return Array.isArray(value) ? (value as ConnectorSpec[]) : [];
}

async function findRemoteBrandBySlug(
  client: EngineClient,
  brandSlug: string,
): Promise<RemoteBrandRecord | undefined> {
  const result = await client.listBrands({ slug: brandSlug, limit: 50 });
  const items = asItems(result);
  return items.find((brand) => getBrandSlug(brand) === brandSlug);
}

async function resolveRemoteBrand(
  client: EngineClient,
  brandRef: string,
): Promise<RemoteBrandRecord> {
  if (UUID_PATTERN.test(brandRef)) {
    return (await client.getBrand(brandRef)) as RemoteBrandRecord;
  }

  const brand = await findRemoteBrandBySlug(client, brandRef);
  if (!brand) {
    throw new Error(`Brand not found: ${brandRef}`);
  }
  return brand;
}

export function validateBrandStudioConfig(brandSlug: string, cwd: string = process.cwd()): boolean {
  try {
    const bundle = loadBrandStudioBundle(brandSlug, cwd);
    const issues = validateBrandStudioBundle(bundle);
    if (issues.length === 0) {
      console.log(chalk.green(`  Brand config valid: ${bundle.dir}`));
      return true;
    }

    console.log(chalk.yellow(`  Brand config has ${issues.length} issue(s):`));
    for (const issue of issues) {
      console.log(chalk.yellow(`  - ${issue}`));
    }
    console.log(chalk.gray('  Run /engine config push <brand-slug> to rewrite canonical files.'));
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
    return false;
  }
}

export async function pullBrandStudioConfig(
  brandRef: string,
  cwd: string = process.cwd(),
): Promise<boolean> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return false;
  }

  const client = new EngineClient(config);
  try {
    const remoteBrand = await resolveRemoteBrand(client, brandRef);
    const brandId = getBrandId(remoteBrand);
    const brandSlug = getBrandSlug(remoteBrand);
    const displayName = getBrandDisplayName(remoteBrand);

    if (!brandId || !brandSlug) {
      throw new Error('Remote brand is missing id or slug.');
    }

    let remoteConfig: AutomationConfig | undefined;
    try {
      remoteConfig = toAutomationConfig(
        await client.getBrandConfig(brandId),
        brandSlug,
        displayName,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(chalk.yellow(`  Warning: could not fetch effective brand config (${msg}).`));
    }

    const connectors = parseConnectors(await client.listConnectors(brandId));
    const baseManifest = buildDefaultManifest(brandSlug, displayName, remoteConfig);
    const manifest: BrandManifest = {
      ...baseManifest,
      slug: brandSlug,
      display_name: displayName,
      status: parseStatus(remoteBrand.status) ?? baseManifest.status,
      routing_mode: parseRoutingMode(remoteBrand.routing_mode) ?? baseManifest.routing_mode,
      canary_percent:
        typeof remoteBrand.canary_percent === 'number'
          ? remoteBrand.canary_percent
          : baseManifest.canary_percent,
      region: typeof remoteBrand.region === 'string' ? remoteBrand.region : baseManifest.region,
      default_locale:
        typeof remoteBrand.default_locale === 'string'
          ? remoteBrand.default_locale
          : baseManifest.default_locale,
      quotas: isObject(remoteBrand.quotas)
        ? (remoteBrand.quotas as BrandManifest['quotas'])
        : baseManifest.quotas,
      metadata: isObject(remoteBrand.metadata)
        ? (remoteBrand.metadata as Record<string, unknown>)
        : baseManifest.metadata,
      workflow_bindings: Array.isArray(remoteBrand.workflow_bindings)
        ? (remoteBrand.workflow_bindings as BrandManifest['workflow_bindings'])
        : baseManifest.workflow_bindings,
      connectors,
    };

    const bundle = buildBrandStudioBundle({
      brandSlug,
      cwd,
      displayName,
      manifest,
      automationConfig: remoteConfig,
      connectors,
      skipRules: remoteConfig?.skip_rules ?? [],
      escalationPatterns: remoteConfig?.escalation_rules?.patterns ?? [],
    });

    writeBrandStudioBundle(bundle);
    console.log(chalk.green(`  Pulled brand config to ${bundle.dir}`));
    console.log(
      chalk.gray(
        `  Wrote manifest.json, automation-config.json, connectors.json, and rules/*.json for ${brandSlug}.`,
      ),
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
    return false;
  }
}

export async function pushBrandStudioConfig(
  brandSlug: string,
  cwd: string = process.cwd(),
): Promise<boolean> {
  const config = getWorkflowEngineConfig();
  if (!config) {
    printNotConfigured();
    return false;
  }

  try {
    const bundle = loadBrandStudioBundle(brandSlug, cwd);
    const issues = validateBrandStudioBundle(bundle);
    writeBrandStudioBundle(bundle);
    if (issues.length > 0) {
      console.log(chalk.gray(`  Synced ${issues.length} local config issue(s) before push.`));
    }

    const client = new EngineClient(config);
    let remoteBrand = await findRemoteBrandBySlug(client, bundle.brandSlug);

    if (!remoteBrand) {
      if (!config.tenantId) {
        throw new Error(
          'Brand create requires tenant_id. Set WORKFLOW_ENGINE_TENANT_ID in CLI config before pushing a new brand.',
        );
      }
      console.log(chalk.gray(`  Creating remote brand "${bundle.brandSlug}"...`));
      remoteBrand = (await client.createBrand({
        tenant_id: config.tenantId,
        slug: bundle.manifest.slug,
        display_name: bundle.manifest.display_name,
        region: bundle.manifest.region,
        default_locale: bundle.manifest.default_locale,
        routing_mode:
          bundle.manifest.routing_mode === 'live' ? 'shadow' : bundle.manifest.routing_mode,
        canary_percent:
          bundle.manifest.routing_mode === 'canary' ? bundle.manifest.canary_percent : undefined,
        quotas: bundle.manifest.quotas,
        metadata: bundle.manifest.metadata,
        workflow_bindings:
          bundle.manifest.workflow_bindings.length > 0
            ? bundle.manifest.workflow_bindings
            : buildDefaultManifest(bundle.manifest.slug, bundle.manifest.display_name)
                .workflow_bindings,
      })) as RemoteBrandRecord;
    }

    const brandId = getBrandId(remoteBrand);
    if (!brandId) {
      throw new Error('Remote brand did not return an id.');
    }

    await client.replaceConnectors(
      brandId,
      bundle.connectors as unknown as Array<Record<string, unknown>>,
    );

    const brandPatch: Record<string, unknown> = {
      workflow_bindings: bundle.manifest.workflow_bindings,
      metadata: bundle.manifest.metadata,
      quotas: bundle.manifest.quotas,
    };
    if (bundle.manifest.routing_mode !== 'live') {
      brandPatch.routing_mode = bundle.manifest.routing_mode;
    } else {
      console.log(
        chalk.yellow(
          '  Warning: local manifest requests live mode; config push does not auto-promote to live.',
        ),
      );
    }
    if (bundle.manifest.routing_mode === 'canary') {
      brandPatch.canary_percent = bundle.manifest.canary_percent;
    }

    await client.updateBrand(brandId, brandPatch);
    await client.validateBrand(brandId);

    console.log(
      chalk.green(`  Pushed brand config for ${bundle.brandSlug} (${brandId.slice(0, 8)}).`),
    );
    console.log(chalk.gray(`  Reconciled ${bundle.connectors.length} connector(s).`));
    return true;
  } catch (err) {
    const msg =
      err instanceof EngineClientError || err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`  Error: ${msg}`));
    return false;
  }
}
