import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { requestJsonWithRetry } from './http.js';
import type { KlaviyoConfig } from './config.js';

const BASE_URL = 'https://a.klaviyo.com/api';

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

function normalizePath(rawPath: string): string {
  let path = String(rawPath || '').trim();
  if (!path) {
    throw new Error('Path is required');
  }
  if (path.startsWith('http://') || path.startsWith('https://')) {
    throw new Error('Path must be relative (e.g., /profiles, /lists/123)');
  }
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  return path;
}

export async function klaviyoRequest(options: KlaviyoRequestOptions): Promise<{ status: number; data: unknown }> {
  const method = String(options.method || '').toUpperCase();
  if (!method) throw new Error('Method is required');

  const path = normalizePath(options.path);
  const url = new URL(`${BASE_URL}${path}`);

  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  const revision = options.revision || options.klaviyo.revision;
  if (!revision) {
    throw new Error('Klaviyo revision header is required. Set KLAVIYO_REVISION.');
  }

  const headers: Record<string, string> = {
    'Accept': 'application/vnd.api+json',
    'Content-Type': 'application/vnd.api+json',
    'Authorization': `Klaviyo-API-Key ${options.klaviyo.apiKey}`,
    'revision': revision,
  };

  const { status, data } = await requestJsonWithRetry(url.toString(), {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    timeoutMs: 30_000,
  });

  if (status >= 400) {
    const msg = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`Klaviyo API error (${status}): ${msg}`);
  }

  return { status, data };
}

export async function klaviyoUploadImageFromFile(
  options: KlaviyoFileUploadOptions
): Promise<{ status: number; data: unknown }> {
  const filePath = String(options.filePath || '').trim();
  if (!filePath) {
    throw new Error('filePath is required');
  }

  const revision = options.revision || options.klaviyo.revision;
  if (!revision) {
    throw new Error('Klaviyo revision header is required. Set KLAVIYO_REVISION.');
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
    'Accept': 'application/vnd.api+json',
    'Authorization': `Klaviyo-API-Key ${options.klaviyo.apiKey}`,
    'revision': revision,
  };

  const { status, data } = await requestJsonWithRetry(`${BASE_URL}/image-upload`, {
    method: 'POST',
    headers,
    body: form,
    timeoutMs: 30_000,
  });

  if (status >= 400) {
    const msg = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`Klaviyo API error (${status}): ${msg}`);
  }

  return { status, data };
}
