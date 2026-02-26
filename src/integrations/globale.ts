import { requestJsonWithRetry, normalizePath, applyQueryParams, throwOnHttpError } from './http.js';
import type { GlobalEConfig } from './config.js';
import { ValidationError } from '../lib/errors.js';

export interface GlobalERequestOptions {
  globale: GlobalEConfig;
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined> | null;
  body?: Record<string, unknown> | null;
}

function normalizeBaseUrl(input: string): string {
  const trimmed = String(input || '').trim();
  return trimmed.replace(/\/$/, '');
}

export async function globalERequest(
  options: GlobalERequestOptions,
): Promise<{ status: number; data: unknown }> {
  const method = String(options.method || '').toUpperCase();
  if (!method) throw new ValidationError('Method is required');

  const path = normalizePath(options.path, '/orders, /shipments, /returns');
  const baseUrl = normalizeBaseUrl(options.globale.baseUrl);
  const url = new URL(`${baseUrl}${path}`);

  applyQueryParams(url, options.query);

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-GlobalE-Merchant-Id': options.globale.merchantId,
    'X-GlobalE-Api-Key': options.globale.apiKey,
  };

  if (options.globale.channel) {
    headers['X-GlobalE-Channel'] = options.globale.channel;
  }

  const { status, data } = await requestJsonWithRetry(url.toString(), {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    timeoutMs: 30_000,
  });

  throwOnHttpError(status, data, 'Global-e');

  return { status, data };
}
