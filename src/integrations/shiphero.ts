import { requestJsonWithRetry } from './http.js';
import type { ShipHeroConfig } from './config.js';

const BASE_URL = 'https://public-api.shiphero.com/graphql';

export interface ShipHeroGraphqlOptions {
  shiphero: ShipHeroConfig;
  query: string;
  variables?: Record<string, unknown> | null;
}

export async function shipheroGraphql(options: ShipHeroGraphqlOptions): Promise<{ status: number; data: unknown }> {
  const query = String(options.query || '').trim();
  if (!query) {
    throw new Error('GraphQL query is required');
  }

  const { status, data } = await requestJsonWithRetry(BASE_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${options.shiphero.accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: options.variables || {},
    }),
    timeoutMs: 30_000,
  });

  if (status >= 400) {
    const msg = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`ShipHero API error (${status}): ${msg}`);
  }

  if (data && typeof data === 'object' && 'errors' in (data as Record<string, unknown>)) {
    const errors = (data as { errors?: Array<{ message?: string }> }).errors;
    const msg = errors?.[0]?.message || 'Unknown ShipHero GraphQL error';
    throw new Error(`ShipHero GraphQL error: ${msg}`);
  }

  const payload = data && typeof data === 'object' && 'data' in (data as Record<string, unknown>)
    ? (data as { data?: unknown }).data
    : data;

  return { status, data: payload };
}
