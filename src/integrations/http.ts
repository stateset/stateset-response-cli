import {
  ValidationError,
  NetworkError,
  NotFoundError,
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
  ServiceUnavailableError,
  StateSetError,
  TimeoutError,
} from '../lib/errors.js';
import { MAX_TEXT_FILE_SIZE_BYTES } from '../utils/file-read.js';
import { getCircuitBreaker } from '../lib/circuit-breaker.js';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { LookupAddress } from 'node:dns';

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
const MAX_RETRY_AFTER_MS = 60_000;
const MAX_TEXT_RESPONSE_BYTES = MAX_TEXT_FILE_SIZE_BYTES;
const RETRYABLE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE', 'PUT', 'DELETE']);
const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain']);
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.localdomain', '.internal'];

function normalizeHost(host: string): string {
  const lowered = host.toLowerCase();
  const bracketMatch = /^\[(.*)\]$/.exec(lowered);
  return (bracketMatch ? bracketMatch[1] : lowered).split('%')[0];
}

function isBlockedHostname(host: string): boolean {
  if (BLOCKED_HOSTS.has(host)) return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function parseIPv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
  return octets;
}

function isPrivateIPv4(host: string): boolean {
  const octets = parseIPv4(host);
  if (!octets) return false;
  const [a, b] = octets;

  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;

  return false;
}

function parseMappedIPv4(host: string): string | null {
  const normalized = host.toLowerCase();
  if (!normalized.startsWith('::ffff:')) return null;
  const mapped = normalized.slice('::ffff:'.length);
  const dotted = parseIPv4(mapped);
  if (dotted) return mapped;
  const hexParts = mapped.split(':');
  if (hexParts.length === 1) {
    const [part] = hexParts;
    if (!/^[0-9a-f]{1,8}$/.test(part)) return null;
    const value = Number.parseInt(part, 16);
    if (!Number.isFinite(value) || value < 0 || value > 0xffffffff) return null;
    return `${(value >>> 24) & 0xff}.${(value >>> 16) & 0xff}.${(value >>> 8) & 0xff}.${value & 0xff}`;
  }
  if (hexParts.length === 2) {
    const [highHex, lowHex] = hexParts;
    if (!/^[0-9a-f]{1,4}$/.test(highHex) || !/^[0-9a-f]{1,4}$/.test(lowHex)) return null;
    const high = Number.parseInt(highHex, 16);
    const low = Number.parseInt(lowHex, 16);
    const value = high * 0x10000 + low;
    return `${(value >>> 24) & 0xff}.${(value >>> 16) & 0xff}.${(value >>> 8) & 0xff}.${value & 0xff}`;
  }
  return null;
}

function isPrivateIPv6(host: string): boolean {
  const normalized = host.toLowerCase().split('%')[0];
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  const mapped = parseMappedIPv4(normalized);
  if (mapped && isPrivateIPv4(mapped)) return true;
  return false;
}

function isPrivateIpHost(host: string): boolean {
  const normalized = normalizeHost(host);
  const family = isIP(normalized);
  if (family === 4) return isPrivateIPv4(normalized);
  if (family === 6) return isPrivateIPv6(normalized);
  return false;
}

async function assertPublicRequestUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError(`Invalid request URL: "${url}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError(`Unsupported URL protocol: "${parsed.protocol}"`);
  }
  const host = normalizeHost(parsed.hostname);
  if (isBlockedHostname(host) || isPrivateIpHost(host)) {
    throw new ValidationError(`Blocked private network URL host: "${host}"`);
  }
  // Resolve hostnames to guard against DNS rebinding and private-network aliases.
  if (isIP(host) === 0) {
    let records: LookupAddress[];
    try {
      records = (await lookup(host, { all: true, verbatim: true })) as LookupAddress[];
    } catch (error) {
      throw new NetworkError(`Unable to resolve host "${host}": ${String(error)}`);
    }
    const addresses = records.map((record: LookupAddress) => normalizeHost(record.address));
    if (addresses.length === 0) {
      throw new NetworkError(`Unable to resolve host "${host}": no addresses returned`);
    }
    const privateAddress = addresses.find((address: string) => isPrivateIpHost(address));
    if (privateAddress) {
      throw new ValidationError(
        `Blocked private network URL host: "${host}" resolved to "${privateAddress}"`,
      );
    }
  }
}

function hasIdempotencyKey(headers?: Record<string, string>): boolean {
  if (!headers) return false;
  return Object.keys(headers).some((key) => key.toLowerCase() === 'idempotency-key');
}

async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new NetworkError(`Response too large (${contentLength} bytes).`);
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    if (typeof response.text !== 'function') return '';
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf-8') > maxBytes) {
      throw new NetworkError(`Response too large (over ${maxBytes} bytes).`);
    }
    return text;
  }

  const reader = response.body.getReader();
  let total = 0;
  const chunks: Uint8Array[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('Response too large');
        throw new NetworkError(`Response too large (over ${maxBytes} bytes).`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (!chunks.length) return '';
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf-8');
}

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

    const text = await readResponseText(response, MAX_TEXT_RESPONSE_BYTES);
    return {
      status: response.status,
      headers: response.headers,
      text,
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TimeoutError(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
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
  await assertPublicRequestUrl(url);

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = 'unknown';
  }
  const breaker = getCircuitBreaker(`http:${hostname}`);
  const method = String(options.method || 'GET').toUpperCase();
  const canRetry =
    RETRYABLE_METHODS.has(method) || (method === 'POST' && hasIdempotencyKey(options.headers));

  return breaker.execute(async () => {
    let attempt = 0;
    let backoffMs = INITIAL_BACKOFF_MS;

    while (attempt < maxRetries) {
      attempt++;

      let res: HttpJsonResponse;
      try {
        res = await requestJson(url, options);
      } catch (error) {
        if (canRetry && attempt < maxRetries) {
          const waitMs = backoffMs + Math.random() * BACKOFF_JITTER_MS;
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          backoffMs = Math.min(backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
          continue;
        }
        throw error;
      }

      const retryAfterRaw = res.headers.get('retry-after');
      let retryAfterMs = NaN;
      if (retryAfterRaw) {
        const numeric = Number(retryAfterRaw);
        if (Number.isFinite(numeric)) {
          retryAfterMs = numeric * 1000;
        } else {
          const dateMs = Date.parse(retryAfterRaw);
          if (Number.isFinite(dateMs)) {
            retryAfterMs = Math.max(0, dateMs - Date.now());
          }
        }
        if (Number.isFinite(retryAfterMs)) {
          retryAfterMs = Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);
        }
      }

      const shouldRetry = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (canRetry && shouldRetry && attempt < maxRetries) {
        const waitMs = Number.isFinite(retryAfterMs)
          ? retryAfterMs
          : backoffMs + Math.random() * BACKOFF_JITTER_MS;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        backoffMs = Math.min(backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
        continue;
      }

      return res;
    }

    throw new NetworkError('requestJsonWithRetry: exceeded maxRetries');
  });
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
