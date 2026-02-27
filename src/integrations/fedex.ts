import { requestJsonWithRetry, normalizePath, applyQueryParams, throwOnHttpError } from './http.js';
import type { FedExConfig } from './config.js';
import { ValidationError } from '../lib/errors.js';

const FEDEX_TOKEN_PATH = '/oauth/token';

interface FedExTokenCacheEntry {
  token: string;
  expiresAtMs: number;
}

const fedexTokenCache = new Map<string, FedExTokenCacheEntry>();

export interface FedExRequestOptions {
  fedex: FedExConfig;
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined> | null;
  body?: Record<string, unknown> | null;
}

function normalizeBaseUrl(input: string): string {
  const trimmed = String(input || '').trim();
  return trimmed.replace(/\/$/, '');
}

function tokenCacheKey(fedex: FedExConfig): string {
  return `${fedex.clientId}::${fedex.clientSecret}::${fedex.baseUrl}`;
}

async function getFedExAccessToken(fedex: FedExConfig): Promise<string> {
  const key = tokenCacheKey(fedex);
  const now = Date.now();
  const cached = fedexTokenCache.get(key);
  if (cached && cached.expiresAtMs > now + 30_000) {
    return cached.token;
  }

  const url = `${normalizeBaseUrl(fedex.baseUrl)}${FEDEX_TOKEN_PATH}`;
  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: fedex.clientId,
    client_secret: fedex.clientSecret,
  });

  const { status, data } = await requestJsonWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: form.toString(),
    timeoutMs: 30_000,
  });

  throwOnHttpError(status, data, 'FedEx OAuth');

  if (!data || typeof data !== 'object') {
    throw new ValidationError('FedEx OAuth response was not an object');
  }

  const token = String((data as Record<string, unknown>).access_token || '').trim();
  if (!token) {
    throw new ValidationError('FedEx OAuth response missing access_token');
  }

  const expiresInRaw = Number((data as Record<string, unknown>).expires_in || 3600);
  const expiresIn = Number.isFinite(expiresInRaw) && expiresInRaw > 60 ? expiresInRaw : 3600;

  fedexTokenCache.set(key, {
    token,
    expiresAtMs: now + (expiresIn - 30) * 1000,
  });

  return token;
}

export async function fedexRequest(
  options: FedExRequestOptions,
): Promise<{ status: number; data: unknown }> {
  const method = String(options.method || '').toUpperCase();
  if (!method) throw new ValidationError('Method is required');

  const path = normalizePath(
    options.path,
    '/track/v1/trackingnumbers, /rate/v1/rates/quotes, /ship/v1/shipments',
  );
  const baseUrl = normalizeBaseUrl(options.fedex.baseUrl);
  const url = new URL(`${baseUrl}${path}`);

  applyQueryParams(url, options.query);

  const accessToken = await getFedExAccessToken(options.fedex);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-locale': options.fedex.locale || 'en_US',
  };

  if (options.fedex.accountNumber) {
    headers['X-customer-transaction-id'] = options.fedex.accountNumber;
  }

  const { status, data } = await requestJsonWithRetry(url.toString(), {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    timeoutMs: 30_000,
  });

  throwOnHttpError(status, data, 'FedEx');

  return { status, data };
}
