import { requestJsonWithRetry } from './http.js';
import type { ShipHawkConfig } from './config.js';

const BASE_URL = 'https://api.shiphawk.com/v4';

export interface ShipHawkRequestOptions {
  shiphawk: ShipHawkConfig;
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined> | null;
  body?: Record<string, unknown> | null;
}

function normalizePath(rawPath: string): string {
  let path = String(rawPath || '').trim();
  if (!path) {
    throw new Error('Path is required');
  }
  if (path.startsWith('http://') || path.startsWith('https://')) {
    throw new Error('Path must be relative (e.g., /shipments, /rates)');
  }
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  return path;
}

export async function shiphawkRequest(options: ShipHawkRequestOptions): Promise<{ status: number; data: unknown }> {
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

  const { status, data } = await requestJsonWithRetry(url.toString(), {
    method,
    headers: {
      'X-Api-Key': options.shiphawk.apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    timeoutMs: 30_000,
  });

  if (status >= 400) {
    const msg = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`ShipHawk API error (${status}): ${msg}`);
  }

  return { status, data };
}
