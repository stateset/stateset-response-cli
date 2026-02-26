import { requestJsonWithRetry, normalizePath, applyQueryParams, throwOnHttpError } from './http.js';
import type { StayAiConfig } from './config.js';
import { ValidationError } from '../lib/errors.js';

export interface StayAiRequestOptions {
  stayai: StayAiConfig;
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

export async function stayAiRequest(
  options: StayAiRequestOptions,
): Promise<{ status: number; data: unknown }> {
  const method = String(options.method || '').toUpperCase();
  if (!method) throw new ValidationError('Method is required');

  const baseUrl = normalizeBaseUrl(options.stayai.baseUrl);
  const path = normalizePath(options.path, '/subscriptions, /customers/123');
  const url = new URL(`${baseUrl}${path}`);

  applyQueryParams(url, options.query);

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${options.stayai.apiKey}`,
  };

  const version = options.version || options.stayai.apiVersion;
  if (version) {
    headers['X-StayAI-Version'] = version;
  }

  const { status, data } = await requestJsonWithRetry(url.toString(), {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    timeoutMs: 30_000,
  });

  throwOnHttpError(status, data, 'Stay.ai');

  return { status, data };
}
