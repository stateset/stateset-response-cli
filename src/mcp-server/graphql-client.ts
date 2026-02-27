import { GraphQLClient } from 'graphql-request';

export type GraphQLAuth =
  | { type: 'admin_secret'; adminSecret: string }
  | { type: 'cli_token'; token: string };

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds
const MAX_RETRY_AFTER_MS = 60_000;

function getRetryAfterMs(error: unknown): number | null {
  const errWithHeaders = error as {
    response?: { headers?: { get?: (name: string) => string | null } & Record<string, unknown> };
  };
  const headers = errWithHeaders?.response?.headers;
  if (!headers) return null;

  let raw: string | null | undefined;
  if (typeof headers.get === 'function') {
    raw = headers.get('retry-after');
  } else {
    raw = (headers as Record<string, unknown>)['retry-after'] as string | undefined;
  }
  if (!raw) return null;

  const seconds = Number(raw);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }

  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) {
    const delayMs = dateMs - Date.now();
    return Math.min(Math.max(delayMs, 0), MAX_RETRY_AFTER_MS);
  }

  return null;
}

function isTransientError(error: unknown): boolean {
  if (error instanceof TypeError) return true; // network failures
  const gqlError = error as { response?: { status?: number }; code?: string };
  if (gqlError?.response?.status && RETRYABLE_STATUS_CODES.has(gqlError.response.status))
    return true;
  if (
    gqlError?.code === 'ECONNRESET' ||
    gqlError?.code === 'ECONNREFUSED' ||
    gqlError?.code === 'ETIMEDOUT'
  )
    return true;
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createGraphQLClient(
  endpoint: string,
  auth: GraphQLAuth,
  orgId?: string,
): GraphQLClient {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (auth.type === 'admin_secret') {
    headers['x-hasura-admin-secret'] = auth.adminSecret;
  } else if (auth.type === 'cli_token') {
    headers['Authorization'] = `Bearer ${auth.token}`;
  }

  if (orgId) {
    headers['x-stateset-org-id'] = orgId;
  }

  return new GraphQLClient(endpoint, { headers });
}

export interface ExecuteQueryOptions {
  /** Timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

export async function executeQuery<T = Record<string, unknown>>(
  client: GraphQLClient,
  query: string,
  variables?: Record<string, unknown>,
  options?: ExecuteQueryOptions,
): Promise<T> {
  const rawTimeout = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const result = await client.request<T>({
          document: query,
          variables,
          signal: controller.signal,
        });
        return result;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error: unknown) {
      lastError = error;

      // Check if it was a timeout
      const isTimeout =
        error instanceof Error &&
        (error.name === 'AbortError' || error.message.includes('timed out'));

      if (attempt < MAX_RETRIES && (isTimeout || isTransientError(error))) {
        const retryAfter = getRetryAfterMs(error);
        const backoff = retryAfter ?? BASE_DELAY_MS * Math.pow(2, attempt);
        await delay(backoff);
        continue;
      }
      break;
    }
  }

  const gqlError = lastError as {
    response?: { errors?: Array<{ message: string }> };
    message?: string;
  };
  const message =
    gqlError?.response?.errors?.[0]?.message || gqlError?.message || 'Unknown GraphQL error';
  throw new Error(message);
}
