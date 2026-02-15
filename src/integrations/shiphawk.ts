import { requestJsonWithRetry, normalizePath, applyQueryParams, throwOnHttpError } from './http.js';
import type { ShipHawkConfig } from './config.js';
import { ValidationError } from '../lib/errors.js';

const BASE_URL = 'https://api.shiphawk.com/v4';

export interface ShipHawkRequestOptions {
  shiphawk: ShipHawkConfig;
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined> | null;
  body?: Record<string, unknown> | null;
}

export async function shiphawkRequest(
  options: ShipHawkRequestOptions,
): Promise<{ status: number; data: unknown }> {
  const method = String(options.method || '').toUpperCase();
  if (!method) throw new ValidationError('Method is required');

  const path = normalizePath(options.path, '/shipments, /rates');
  const url = new URL(`${BASE_URL}${path}`);

  applyQueryParams(url, options.query);

  const { status, data } = await requestJsonWithRetry(url.toString(), {
    method,
    headers: {
      'X-Api-Key': options.shiphawk.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    timeoutMs: 30_000,
  });

  throwOnHttpError(status, data, 'ShipHawk');

  return { status, data };
}
