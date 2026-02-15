import {
  ValidationError,
  NetworkError,
  NotFoundError,
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
  ServiceUnavailableError,
  StateSetError,
} from '../lib/errors.js';

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
  timeoutMs?: number;
}

export interface HttpTextResponse {
  status: number;
  headers: Headers;
  text: string;
}

export interface HttpJsonResponse {
  status: number;
  headers: Headers;
  data: unknown;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 6;
const INITIAL_BACKOFF_MS = 800;
const BACKOFF_JITTER_MS = 250;
const BACKOFF_MULTIPLIER = 1.8;
const MAX_BACKOFF_MS = 30_000;

function getTimeoutMs(options?: RequestOptions): number {
  const timeout = options?.timeoutMs;
  return Number.isFinite(timeout) && (timeout as number) > 0
    ? (timeout as number)
    : DEFAULT_TIMEOUT_MS;
}

export async function requestText(
  url: string,
  options: RequestOptions = {},
): Promise<HttpTextResponse> {
  const timeoutMs = getTimeoutMs(options);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });

    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      text,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestJson(
  url: string,
  options: RequestOptions = {},
): Promise<HttpJsonResponse> {
  const res = await requestText(url, options);
  let data: unknown;
  try {
    data = JSON.parse(res.text);
  } catch {
    data = res.text;
  }
  return { status: res.status, headers: res.headers, data };
}

export async function requestJsonWithRetry(
  url: string,
  options: RequestOptions = {},
  { maxRetries = DEFAULT_MAX_RETRIES }: { maxRetries?: number } = {},
): Promise<HttpJsonResponse> {
  let attempt = 0;
  let backoffMs = INITIAL_BACKOFF_MS;

  while (attempt < maxRetries) {
    attempt++;

    let res: HttpJsonResponse;
    try {
      res = await requestJson(url, options);
    } catch (error) {
      if (attempt < maxRetries) {
        const waitMs = backoffMs + Math.random() * BACKOFF_JITTER_MS;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        backoffMs = Math.min(backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
        continue;
      }
      throw error;
    }

    const retryAfterRaw = res.headers.get('retry-after');
    const retryAfterSeconds = retryAfterRaw ? Number(retryAfterRaw) : NaN;

    const shouldRetry = res.status === 429 || (res.status >= 500 && res.status < 600);
    if (shouldRetry && attempt < maxRetries) {
      const waitMs = Number.isFinite(retryAfterSeconds)
        ? retryAfterSeconds * 1000
        : backoffMs + Math.random() * BACKOFF_JITTER_MS;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      backoffMs = Math.min(backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
      continue;
    }

    return res;
  }

  throw new NetworkError('requestJsonWithRetry: exceeded maxRetries');
}

/**
 * Normalize a relative API path: ensure non-empty, relative, leading slash.
 */
export function normalizePath(rawPath: string, example?: string): string {
  let p = String(rawPath || '').trim();
  if (!p) {
    throw new ValidationError('Path is required');
  }
  if (p.startsWith('http://') || p.startsWith('https://')) {
    throw new ValidationError(`Path must be relative${example ? ` (e.g., ${example})` : ''}`);
  }
  if (!p.startsWith('/')) {
    p = `/${p}`;
  }
  return p;
}

/**
 * Throw a typed Error if the HTTP status indicates failure (>= 400).
 */
export function throwOnHttpError(status: number, data: unknown, serviceName: string): void {
  if (status < 400) return;
  const msg = typeof data === 'string' ? data : JSON.stringify(data);
  const fullMsg = `${serviceName} API error (${status}): ${msg}`;
  switch (status) {
    case 400:
      throw new ValidationError(fullMsg);
    case 401:
      throw new AuthenticationError(fullMsg);
    case 403:
      throw new AuthorizationError(fullMsg);
    case 404:
      throw new NotFoundError(fullMsg);
    case 429:
      throw new RateLimitError(fullMsg);
    default:
      if (status >= 500) throw new ServiceUnavailableError(fullMsg);
      throw new StateSetError(fullMsg, 'HTTP_ERROR', status);
  }
}

/**
 * Apply optional query parameters to a URL, skipping null/undefined values.
 */
export function applyQueryParams(
  url: URL,
  query?: Record<string, string | number | boolean | undefined | null> | null,
): void {
  if (!query) return;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
}
