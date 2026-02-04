import { requestJsonWithRetry } from './http.js';
import type { RechargeConfig } from './config.js';

const BASE_URL = 'https://api.rechargeapps.com';

export interface RechargeRequestOptions {
  recharge: RechargeConfig;
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined> | null;
  body?: Record<string, unknown> | null;
  version?: string | null;
}

function normalizePath(rawPath: string): string {
  let path = String(rawPath || '').trim();
  if (!path) {
    throw new Error('Path is required');
  }
  if (path.startsWith('http://') || path.startsWith('https://')) {
    throw new Error('Path must be relative (e.g., /subscriptions, /customers/123)');
  }
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  return path;
}

export async function rechargeRequest(options: RechargeRequestOptions): Promise<{ status: number; data: unknown }> {
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

  const headers: Record<string, string> = {
    'Accept': 'application/json',
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

  if (status >= 400) {
    const msg = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`Recharge API error (${status}): ${msg}`);
  }

  return { status, data };
}
