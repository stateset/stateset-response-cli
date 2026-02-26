import { requestJsonWithRetry, normalizePath, applyQueryParams, throwOnHttpError } from './http.js';
import type { SkioConfig } from './config.js';
import { ValidationError } from '../lib/errors.js';

export interface SkioRequestOptions {
  skio: SkioConfig;
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined> | null;
  body?: Record<string, unknown> | null;
  version?: string | null;
}

function normalizeBaseUrl(input: string): string {
  const trimmed = String(input || '').trim();
  return trimmed.replace(/\/$/, '');
}

export async function skioRequest(
  options: SkioRequestOptions,
): Promise<{ status: number; data: unknown }> {
  const method = String(options.method || '').toUpperCase();
  if (!method) throw new ValidationError('Method is required');

  const baseUrl = normalizeBaseUrl(options.skio.baseUrl);
  const path = normalizePath(options.path, '/subscriptions, /customers/123');
  const url = new URL(`${baseUrl}${path}`);

  applyQueryParams(url, options.query);

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${options.skio.apiKey}`,
  };

  const version = options.version || options.skio.apiVersion;
  if (version) {
    headers['X-Skio-Version'] = version;
  }

  const { status, data } = await requestJsonWithRetry(url.toString(), {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    timeoutMs: 30_000,
  });

  throwOnHttpError(status, data, 'Skio');

  return { status, data };
}
