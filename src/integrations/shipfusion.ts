import { requestJsonWithRetry, normalizePath, applyQueryParams, throwOnHttpError } from './http.js';
import type { ShipFusionConfig } from './config.js';
import { ValidationError } from '../lib/errors.js';

const BASE_URL = 'https://api.shipfusion.com/v1';

export interface ShipFusionRequestOptions {
  shipfusion: ShipFusionConfig;
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined> | null;
  body?: Record<string, unknown> | null;
}

export async function shipfusionRequest(
  options: ShipFusionRequestOptions,
): Promise<{ status: number; data: unknown }> {
  const method = String(options.method || '').toUpperCase();
  if (!method) throw new ValidationError('Method is required');

  const path = normalizePath(options.path, '/orders, /inventory/sku');
  const url = new URL(`${BASE_URL}${path}`);

  applyQueryParams(url, options.query);

  const { status, data } = await requestJsonWithRetry(url.toString(), {
    method,
    headers: {
      'X-API-Key': options.shipfusion.apiKey,
      'X-Client-Id': options.shipfusion.clientId,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    timeoutMs: 30_000,
  });

  throwOnHttpError(status, data, 'ShipFusion');

  return { status, data };
}
