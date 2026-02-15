import { requestJsonWithRetry, normalizePath, applyQueryParams, throwOnHttpError } from './http.js';
import type { RechargeConfig } from './config.js';
import { ValidationError } from '../lib/errors.js';

const BASE_URL = 'https://api.rechargeapps.com';

export interface RechargeRequestOptions {
  recharge: RechargeConfig;
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined> | null;
  body?: Record<string, unknown> | null;
  version?: string | null;
}

export async function rechargeRequest(
  options: RechargeRequestOptions,
): Promise<{ status: number; data: unknown }> {
  const method = String(options.method || '').toUpperCase();
  if (!method) throw new ValidationError('Method is required');

  const path = normalizePath(options.path, '/subscriptions, /customers/123');
  const url = new URL(`${BASE_URL}${path}`);

  applyQueryParams(url, options.query);

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Recharge-Access-Token': options.recharge.accessToken,
  };

  const version = options.version || options.recharge.apiVersion;
  if (version) {
    headers['X-Recharge-Version'] = version;
  }

  const { status, data } = await requestJsonWithRetry(url.toString(), {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    timeoutMs: 30_000,
  });

  throwOnHttpError(status, data, 'Recharge');

  return { status, data };
}
