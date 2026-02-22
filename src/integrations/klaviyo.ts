import { lstat, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { requestJsonWithRetry, normalizePath, applyQueryParams, throwOnHttpError } from './http.js';
import type { KlaviyoConfig } from './config.js';
import { ValidationError } from '../lib/errors.js';

const BASE_URL = 'https://a.klaviyo.com/api';
const MAX_KLAVIYO_FILE_BYTES = 5_000_000;

export interface KlaviyoRequestOptions {
  klaviyo: KlaviyoConfig;
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined> | null;
  body?: Record<string, unknown> | null;
  revision?: string | null;
}

export interface KlaviyoFileUploadOptions {
  klaviyo: KlaviyoConfig;
  filePath: string;
  fileField?: string | null;
  filename?: string | null;
  fields?: Record<string, string | number | boolean> | null;
  revision?: string | null;
}

export async function klaviyoRequest(
  options: KlaviyoRequestOptions,
): Promise<{ status: number; data: unknown }> {
  const method = String(options.method || '').toUpperCase();
  if (!method) throw new ValidationError('Method is required');

  const path = normalizePath(options.path, '/profiles, /lists/123');
  const url = new URL(`${BASE_URL}${path}`);

  applyQueryParams(url, options.query);

  const revision = options.revision || options.klaviyo.revision;
  if (!revision) {
    throw new ValidationError('Klaviyo revision header is required. Set KLAVIYO_REVISION.');
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.api+json',
    'Content-Type': 'application/vnd.api+json',
    Authorization: `Klaviyo-API-Key ${options.klaviyo.apiKey}`,
    revision: revision,
  };

  const { status, data } = await requestJsonWithRetry(url.toString(), {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    timeoutMs: 30_000,
  });

  throwOnHttpError(status, data, 'Klaviyo');

  return { status, data };
}

export async function klaviyoUploadImageFromFile(
  options: KlaviyoFileUploadOptions,
): Promise<{ status: number; data: unknown }> {
  const filePath = String(options.filePath || '').trim();
  if (!filePath) {
    throw new ValidationError('filePath is required');
  }

  const revision = options.revision || options.klaviyo.revision;
  if (!revision) {
    throw new ValidationError('Klaviyo revision header is required. Set KLAVIYO_REVISION.');
  }

  const stat = await lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new ValidationError('filePath must be a regular file.');
  }
  if (stat.size > MAX_KLAVIYO_FILE_BYTES) {
    throw new ValidationError(`File is too large (${stat.size} bytes).`);
  }

  const buffer = await readFile(filePath);
  const fileField = String(options.fileField || 'file').trim() || 'file';
  const filename = String(options.filename || basename(filePath)).trim() || basename(filePath);

  const form = new FormData();
  form.append(fileField, new Blob([buffer]), filename);
  if (options.fields) {
    for (const [key, value] of Object.entries(options.fields)) {
      if (value === undefined || value === null) continue;
      form.append(key, String(value));
    }
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.api+json',
    Authorization: `Klaviyo-API-Key ${options.klaviyo.apiKey}`,
    revision: revision,
  };

  const { status, data } = await requestJsonWithRetry(`${BASE_URL}/image-upload`, {
    method: 'POST',
    headers,
    body: form,
    timeoutMs: 30_000,
  });

  throwOnHttpError(status, data, 'Klaviyo');

  return { status, data };
}
