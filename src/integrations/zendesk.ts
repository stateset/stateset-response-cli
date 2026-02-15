import { requestJsonWithRetry, normalizePath, applyQueryParams, throwOnHttpError } from './http.js';
import type { ZendeskConfig } from './config.js';
import { ValidationError } from '../lib/errors.js';

export interface ZendeskRequestOptions {
  zendesk: ZendeskConfig;
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined> | null;
  body?: Record<string, unknown> | null;
}

export async function zendeskRequest(
  options: ZendeskRequestOptions,
): Promise<{ status: number; data: unknown }> {
  const method = String(options.method || '').toUpperCase();
  if (!method) throw new ValidationError('Method is required');

  const path = normalizePath(options.path, '/tickets/123.json');
  const baseUrl = `https://${options.zendesk.subdomain}.zendesk.com/api/v2`;
  const url = new URL(`${baseUrl}${path}`);

  applyQueryParams(url, options.query);

  const auth = Buffer.from(`${options.zendesk.email}/token:${options.zendesk.apiToken}`).toString(
    'base64',
  );

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

  throwOnHttpError(status, data, 'Zendesk');

  return { status, data };
}
