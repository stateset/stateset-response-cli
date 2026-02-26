import { createHash, createHmac } from 'node:crypto';
import { requestJsonWithRetry, normalizePath, applyQueryParams, throwOnHttpError } from './http.js';
import type { AmazonConfig } from './config.js';
import { ValidationError } from '../lib/errors.js';

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const AWS_SERVICE = 'execute-api';

interface LwaTokenCacheEntry {
  token: string;
  expiresAtMs: number;
}

const lwaTokenCache = new Map<string, LwaTokenCacheEntry>();

export interface AmazonRequestOptions {
  amazon: AmazonConfig;
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined> | null;
  body?: Record<string, unknown> | null;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmacSha256(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalUri(pathname: string): string {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return normalized
    .split('/')
    .map((segment) => encodeRfc3986(segment))
    .join('/');
}

function canonicalQuery(url: URL): string {
  const pairs = Array.from(url.searchParams.entries()).sort((a, b) => {
    if (a[0] === b[0]) return a[1].localeCompare(b[1]);
    return a[0].localeCompare(b[0]);
  });
  return pairs.map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`).join('&');
}

function getSigningKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, AWS_SERVICE);
  return hmacSha256(kService, 'aws4_request');
}

function tokenCacheKey(amazon: AmazonConfig): string {
  return [amazon.lwaClientId, amazon.lwaClientSecret, amazon.lwaRefreshToken].join('::');
}

async function getLwaAccessToken(amazon: AmazonConfig): Promise<string> {
  const key = tokenCacheKey(amazon);
  const now = Date.now();
  const cached = lwaTokenCache.get(key);
  if (cached && cached.expiresAtMs > now + 30_000) {
    return cached.token;
  }

  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: amazon.lwaRefreshToken,
    client_id: amazon.lwaClientId,
    client_secret: amazon.lwaClientSecret,
  });

  const { status, data } = await requestJsonWithRetry(LWA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: form.toString(),
    timeoutMs: 30_000,
  });

  throwOnHttpError(status, data, 'Amazon LWA');

  if (!data || typeof data !== 'object') {
    throw new ValidationError('Amazon LWA token response was not an object');
  }

  const token = String((data as Record<string, unknown>).access_token || '').trim();
  if (!token) {
    throw new ValidationError('Amazon LWA token response missing access_token');
  }

  const expiresInRaw = Number((data as Record<string, unknown>).expires_in || 3600);
  const expiresIn = Number.isFinite(expiresInRaw) && expiresInRaw > 60 ? expiresInRaw : 3600;

  lwaTokenCache.set(key, {
    token,
    expiresAtMs: now + (expiresIn - 30) * 1000,
  });

  return token;
}

interface SignedHeadersResult {
  authorization: string;
  amzDate: string;
  signedHeaders: string;
}

function signRequest(params: {
  method: string;
  url: URL;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  lwaAccessToken: string;
  payloadHash: string;
}): SignedHeadersResult {
  const method = params.method.toUpperCase();
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);

  const canonicalHeadersMap: Record<string, string> = {
    host: params.url.host,
    'x-amz-access-token': params.lwaAccessToken,
    'x-amz-content-sha256': params.payloadHash,
    'x-amz-date': amzDate,
  };
  if (params.sessionToken) {
    canonicalHeadersMap['x-amz-security-token'] = params.sessionToken;
  }

  const sortedHeaderNames = Object.keys(canonicalHeadersMap).sort();
  const canonicalHeaders = sortedHeaderNames
    .map((name) => `${name}:${canonicalHeadersMap[name].trim().replace(/\s+/g, ' ')}`)
    .join('\n');
  const signedHeaders = sortedHeaderNames.join(';');

  const canonicalRequest = [
    method,
    canonicalUri(params.url.pathname),
    canonicalQuery(params.url),
    `${canonicalHeaders}\n`,
    signedHeaders,
    params.payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${params.region}/${AWS_SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = getSigningKey(params.secretAccessKey, dateStamp, params.region);
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    amzDate,
    signedHeaders,
  };
}

export async function amazonRequest(
  options: AmazonRequestOptions,
): Promise<{ status: number; data: unknown }> {
  const method = String(options.method || '').toUpperCase();
  if (!method) throw new ValidationError('Method is required');

  const path = normalizePath(options.path, '/orders/v0/orders');
  const baseUrl = String(options.amazon.endpoint || '')
    .trim()
    .replace(/\/$/, '');
  if (!baseUrl) {
    throw new ValidationError('Amazon endpoint is required');
  }

  const url = new URL(`${baseUrl}${path}`);
  applyQueryParams(url, options.query);

  const bodyText = options.body ? JSON.stringify(options.body) : '';
  const payloadHash = sha256Hex(bodyText);

  const lwaAccessToken = await getLwaAccessToken(options.amazon);
  const signed = signRequest({
    method,
    url,
    region: options.amazon.awsRegion,
    accessKeyId: options.amazon.awsAccessKeyId,
    secretAccessKey: options.amazon.awsSecretAccessKey,
    sessionToken: options.amazon.awsSessionToken,
    lwaAccessToken,
    payloadHash,
  });

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: signed.authorization,
    'x-amz-access-token': lwaAccessToken,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': signed.amzDate,
  };

  if (options.amazon.awsSessionToken) {
    headers['x-amz-security-token'] = options.amazon.awsSessionToken;
  }

  const { status, data } = await requestJsonWithRetry(url.toString(), {
    method,
    headers,
    body: bodyText || undefined,
    timeoutMs: 30_000,
  });

  throwOnHttpError(status, data, 'Amazon SP-API');

  return { status, data };
}
