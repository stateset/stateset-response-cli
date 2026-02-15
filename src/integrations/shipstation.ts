import { requestJsonWithRetry, normalizePath, applyQueryParams, throwOnHttpError } from './http.js';
import type { ShipStationConfig } from './config.js';
import { ValidationError } from '../lib/errors.js';

const BASE_URL = 'https://ssapi.shipstation.com';

export interface ShipStationRequestOptions {
  shipstation: ShipStationConfig;
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined> | null;
  body?: Record<string, unknown> | null;
}

export async function shipstationRequest(
  options: ShipStationRequestOptions,
): Promise<{ status: number; data: unknown }> {
  const method = String(options.method || '').toUpperCase();
  if (!method) throw new ValidationError('Method is required');

  const path = normalizePath(options.path, '/orders, /shipments');
  const url = new URL(`${BASE_URL}${path}`);

  applyQueryParams(url, options.query);

  const auth = Buffer.from(
    `${options.shipstation.apiKey}:${options.shipstation.apiSecret}`,
  ).toString('base64');

  const { status, data } = await requestJsonWithRetry(url.toString(), {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    timeoutMs: 30_000,
  });

  throwOnHttpError(status, data, 'ShipStation');

  return { status, data };
}
