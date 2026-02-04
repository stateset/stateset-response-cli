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

function getTimeoutMs(options?: RequestOptions): number {
  const timeout = options?.timeoutMs;
  return Number.isFinite(timeout) && (timeout as number) > 0 ? (timeout as number) : 30_000;
}

export async function requestText(url: string, options: RequestOptions = {}): Promise<HttpTextResponse> {
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

export async function requestJson(url: string, options: RequestOptions = {}): Promise<HttpJsonResponse> {
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
  { maxRetries = 6 }: { maxRetries?: number } = {}
): Promise<HttpJsonResponse> {
  let attempt = 0;
  let backoffMs = 800;

  while (attempt < maxRetries) {
    attempt++;

    let res: HttpJsonResponse;
    try {
      res = await requestJson(url, options);
    } catch (error) {
      if (attempt < maxRetries) {
        const waitMs = backoffMs + Math.random() * 250;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        backoffMs = Math.min(backoffMs * 1.8, 30_000);
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
        : backoffMs + Math.random() * 250;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      backoffMs = Math.min(backoffMs * 1.8, 30_000);
      continue;
    }

    return res;
  }

  throw new Error('requestJsonWithRetry: exceeded maxRetries');
}
