import chalk from 'chalk';
import path from 'node:path';
import { EngineClient } from '../lib/engine-client.js';
import type { ConnectorSpec } from '../lib/manifest-builder.js';
import { readJsonFile } from '../utils/file-read.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ENGINE_INPUT_FILE_BYTES = 8 * 1024 * 1024;

export type RemoteBrandRecord = Record<string, unknown>;

export function printNotConfigured(): void {
  console.log(chalk.yellow('  Workflow engine not configured.'));
  console.log(
    chalk.gray(
      '  Run /engine setup or set WORKFLOW_ENGINE_URL + WORKFLOW_ENGINE_API_KEY env vars.',
    ),
  );
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function asItems(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as Array<Record<string, unknown>>;
  }
  if (isObject(result) && Array.isArray(result.items)) {
    return result.items as Array<Record<string, unknown>>;
  }
  return [];
}

export function getBrandId(brand: RemoteBrandRecord): string {
  return String(brand.id ?? brand.brand_id ?? '');
}

export function getBrandSlug(brand: RemoteBrandRecord): string {
  return String(brand.slug ?? brand.brand_slug ?? '').trim();
}

export function getBrandDisplayName(brand: RemoteBrandRecord): string {
  return String(brand.display_name ?? brand.name ?? brand.slug ?? 'unnamed').trim();
}

export function parseConfigVersion(value: unknown): number | undefined {
  return Number.isInteger(value) ? (value as number) : undefined;
}

export function connectorIdentity(connector: Record<string, unknown> | ConnectorSpec): string {
  const raw = connector as Record<string, unknown>;
  const type = String(raw.connector_type ?? raw.type ?? '').trim() || 'unknown';
  const direction = String(raw.direction ?? '').trim() || 'outbound';
  return `${type}:${direction}`;
}

export function formatJsonBlock(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function findRemoteBrandBySlug(
  client: EngineClient,
  brandSlug: string,
): Promise<RemoteBrandRecord | undefined> {
  const result = await client.listBrands({ slug: brandSlug, limit: 50 });
  return asItems(result).find((brand) => getBrandSlug(brand) === brandSlug);
}

export async function resolveRemoteBrand(
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

  const brandId = getBrandId(brand);
  if (!brandId) {
    return brand;
  }
  return (await client.getBrand(brandId)) as RemoteBrandRecord;
}

export function formatDateTime(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '-';
  return value.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

export function resolveInputPath(filePath: string, cwd = process.cwd()): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}

export function readJsonObjectFromFile(
  filePath: string,
  cwd = process.cwd(),
): Record<string, unknown> {
  const resolved = resolveInputPath(filePath, cwd);
  return readJsonFile(resolved, {
    label: 'Engine input file',
    maxBytes: MAX_ENGINE_INPUT_FILE_BYTES,
    expectObject: true,
  }) as Record<string, unknown>;
}
