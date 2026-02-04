import { requestJsonWithRetry } from './http.js';
import type { ZendeskConfig } from './config.js';

export interface ZendeskRequestOptions {
  zendesk: ZendeskConfig;
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
    throw new Error('Path must be relative (e.g., /tickets/123.json)');
  }
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  return path;
}

export async function zendeskRequest(options: ZendeskRequestOptions): Promise<{ status: number; data: unknown }> {
  const method = String(options.method || '').toUpperCase();
  if (!method) throw new Error('Method is required');

  const path = normalizePath(options.path);
  const baseUrl = `https://${options.zendesk.subdomain}.zendesk.com/api/v2`;
  const url = new URL(`${baseUrl}${path}`);

  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  const auth = Buffer.from(`${options.zendesk.email}/token:${options.zendesk.apiToken}`).toString('base64');

  const { status, data } = await requestJsonWithRetry(url.toString(), {
    method,
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    timeoutMs: 30_000,
  });

  if (status >= 400) {
    const msg = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`Zendesk API error (${status}): ${msg}`);
  }

  return { status, data };
}
