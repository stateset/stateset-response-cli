import { requestJsonWithRetry, throwOnHttpError } from './http.js';
import type { ShipHeroConfig } from './config.js';
import { ValidationError, ServiceUnavailableError } from '../lib/errors.js';

const BASE_URL = 'https://public-api.shiphero.com/graphql';

export interface ShipHeroGraphqlOptions {
  shiphero: ShipHeroConfig;
  query: string;
  variables?: Record<string, unknown> | null;
}

export async function shipheroGraphql(
  options: ShipHeroGraphqlOptions,
): Promise<{ status: number; data: unknown }> {
  const query = String(options.query || '').trim();
  if (!query) {
    throw new ValidationError('GraphQL query is required');
  }

  const { status, data } = await requestJsonWithRetry(BASE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.shiphero.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: options.variables || {},
    }),
    timeoutMs: 30_000,
  });

  throwOnHttpError(status, data, 'ShipHero');

  if (data && typeof data === 'object' && 'errors' in (data as Record<string, unknown>)) {
    const errors = (data as { errors?: Array<{ message?: string }> }).errors;
    const msg = errors?.[0]?.message || 'Unknown ShipHero GraphQL error';
    throw new ServiceUnavailableError(`ShipHero GraphQL error: ${msg}`);
  }

  const payload =
    data && typeof data === 'object' && 'data' in (data as Record<string, unknown>)
      ? (data as { data?: unknown }).data
      : data;

  return { status, data: payload };
}
