import { requestJsonWithRetry, normalizePath, applyQueryParams, throwOnHttpError } from './http.js';
import type { DhlConfig } from './config.js';
import { ValidationError } from '../lib/errors.js';

export interface DhlRequestOptions {
  dhl: DhlConfig;
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined> | null;
  body?: Record<string, unknown> | null;
}

function normalizeBaseUrl(input: string): string {
  const trimmed = String(input || '').trim();
  return trimmed.replace(/\/$/, '');
}

export async function dhlRequest(
  options: DhlRequestOptions,
): Promise<{ status: number; data: unknown }> {
  const method = String(options.method || '').toUpperCase();
  if (!method) throw new ValidationError('Method is required');

  const path = normalizePath(options.path, '/shipments, /rates, /track/shipments');
  const baseUrl = normalizeBaseUrl(options.dhl.baseUrl);
  const url = new URL(`${baseUrl}${path}`);

  applyQueryParams(url, options.query);

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'DHL-API-Key': options.dhl.apiKey,
  };

  if (options.dhl.accountNumber) {
    headers['DHL-Account-Number'] = options.dhl.accountNumber;
  }
  if (options.dhl.accessToken) {
    headers.Authorization = `Bearer ${options.dhl.accessToken}`;
  }

  const { status, data } = await requestJsonWithRetry(url.toString(), {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    timeoutMs: 30_000,
  });

  throwOnHttpError(status, data, 'DHL');

  return { status, data };
}
