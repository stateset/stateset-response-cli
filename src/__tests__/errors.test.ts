import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  StateSetError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  NetworkError,
  TimeoutError,
  ServiceUnavailableError,
  ConfigurationError,
  InternalError,
  isRetryable,
  toStateSetError,
  getUserMessage,
  installGlobalErrorHandlers,
} from '../lib/errors.js';

describe('StateSetError', () => {
  it('constructs with all fields', () => {
    const err = new StateSetError('test message', 'TEST_CODE', 418, true, { foo: 'bar' });
    expect(err.message).toBe('test message');
    expect(err.code).toBe('TEST_CODE');
    expect(err.statusCode).toBe(418);
    expect(err.retryable).toBe(true);
    expect(err.context).toEqual({ foo: 'bar' });
  });

  it('has default statusCode and retryable', () => {
    const err = new StateSetError('msg', 'CODE');
    expect(err.statusCode).toBe(500);
    expect(err.retryable).toBe(false);
  });

  it('serializes to JSON', () => {
    const err = new StateSetError('test', 'TEST', 400, false, { key: 'val' });
    const json = err.toJSON();
    expect(json.name).toBe('StateSetError');
    expect(json.message).toBe('test');
    expect(json.code).toBe('TEST');
    expect(json.statusCode).toBe(400);
    expect(json.retryable).toBe(false);
    expect(json.context).toEqual({ key: 'val' });
  });

  it('omits context from JSON when undefined', () => {
    const err = new StateSetError('msg', 'CODE');
    const json = err.toJSON();
    expect('context' in json).toBe(false);
  });

  it('is instanceof Error', () => {
    expect(new StateSetError('msg', 'CODE')).toBeInstanceOf(Error);
  });
});

describe('error subclasses', () => {
  it('ValidationError has correct defaults', () => {
    const err = new ValidationError('bad input');
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.statusCode).toBe(400);
    expect(err.retryable).toBe(false);
    expect(err.name).toBe('ValidationError');
  });

  it('AuthenticationError has correct defaults', () => {
    const err = new AuthenticationError('unauthorized');
    expect(err.code).toBe('AUTH_ERROR');
    expect(err.statusCode).toBe(401);
    expect(err.retryable).toBe(false);
  });

  it('AuthorizationError has correct defaults', () => {
    const err = new AuthorizationError('forbidden');
    expect(err.code).toBe('FORBIDDEN');
    expect(err.statusCode).toBe(403);
  });

  it('NotFoundError has correct defaults', () => {
    const err = new NotFoundError('not found');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.statusCode).toBe(404);
  });

  it('ConflictError has correct defaults', () => {
    const err = new ConflictError('conflict');
    expect(err.code).toBe('CONFLICT');
    expect(err.statusCode).toBe(409);
  });

  it('RateLimitError stores retryAfterMs', () => {
    const err = new RateLimitError('slow down', 5000);
    expect(err.retryAfterMs).toBe(5000);
    expect(err.retryable).toBe(true);
    expect(err.statusCode).toBe(429);
  });

  it('NetworkError is retryable', () => {
    const err = new NetworkError('connection failed');
    expect(err.retryable).toBe(true);
    expect(err.statusCode).toBe(503);
  });

  it('TimeoutError is retryable', () => {
    const err = new TimeoutError('timed out');
    expect(err.retryable).toBe(true);
    expect(err.statusCode).toBe(504);
  });

  it('ServiceUnavailableError is retryable', () => {
    const err = new ServiceUnavailableError('down');
    expect(err.retryable).toBe(true);
  });

  it('ConfigurationError is not retryable', () => {
    const err = new ConfigurationError('bad config');
    expect(err.retryable).toBe(false);
    expect(err.code).toBe('CONFIG_ERROR');
  });

  it('InternalError is not retryable', () => {
    const err = new InternalError('oops');
    expect(err.retryable).toBe(false);
    expect(err.code).toBe('INTERNAL_ERROR');
  });
});

describe('isRetryable', () => {
  it('returns true for retryable StateSetError', () => {
    expect(isRetryable(new NetworkError('fail'))).toBe(true);
    expect(isRetryable(new TimeoutError('timeout'))).toBe(true);
    expect(isRetryable(new RateLimitError('limit'))).toBe(true);
  });

  it('returns false for non-retryable StateSetError', () => {
    expect(isRetryable(new ValidationError('bad'))).toBe(false);
    expect(isRetryable(new AuthenticationError('no auth'))).toBe(false);
    expect(isRetryable(new NotFoundError('missing'))).toBe(false);
  });

  it('returns true for ECONNRESET error', () => {
    const err = new Error('fail') as NodeJS.ErrnoException;
    err.code = 'ECONNRESET';
    expect(isRetryable(err)).toBe(true);
  });

  it('returns true for ECONNREFUSED error', () => {
    const err = new Error('fail') as NodeJS.ErrnoException;
    err.code = 'ECONNREFUSED';
    expect(isRetryable(err)).toBe(true);
  });

  it('returns true for 502 response status', () => {
    const err = new Error('bad gateway') as Error & { response: { status: number } };
    err.response = { status: 502 };
    expect(isRetryable(err)).toBe(true);
  });

  it('returns false for unknown error', () => {
    expect(isRetryable('random string')).toBe(false);
    expect(isRetryable(null)).toBe(false);
    expect(isRetryable(42)).toBe(false);
  });

  it('returns false for regular Error without code', () => {
    expect(isRetryable(new Error('generic'))).toBe(false);
  });
});

describe('toStateSetError', () => {
  it('returns same if already StateSetError', () => {
    const err = new ValidationError('bad');
    expect(toStateSetError(err)).toBe(err);
  });

  it('converts ECONNRESET to NetworkError', () => {
    const err = new Error('reset') as NodeJS.ErrnoException;
    err.code = 'ECONNRESET';
    const result = toStateSetError(err);
    expect(result).toBeInstanceOf(NetworkError);
    expect(result.message).toBe('reset');
  });

  it('converts 401 to AuthenticationError', () => {
    const err = new Error('unauth') as Error & { response: { status: number } };
    err.response = { status: 401 };
    const result = toStateSetError(err);
    expect(result).toBeInstanceOf(AuthenticationError);
  });

  it('converts 404 to NotFoundError', () => {
    const err = new Error('not found') as Error & { response: { status: number } };
    err.response = { status: 404 };
    expect(toStateSetError(err)).toBeInstanceOf(NotFoundError);
  });

  it('converts 429 to RateLimitError', () => {
    const err = new Error('rate limit') as Error & { response: { status: number } };
    err.response = { status: 429 };
    expect(toStateSetError(err)).toBeInstanceOf(RateLimitError);
  });

  it('converts unknown Error to InternalError', () => {
    const result = toStateSetError(new Error('generic'));
    expect(result).toBeInstanceOf(InternalError);
  });

  it('converts non-Error to InternalError', () => {
    const result = toStateSetError('string error');
    expect(result).toBeInstanceOf(InternalError);
    expect(result.message).toBe('string error');
  });

  it('converts 400 to ValidationError', () => {
    const err = new Error('bad request') as Error & { response: { status: number } };
    err.response = { status: 400 };
    expect(toStateSetError(err)).toBeInstanceOf(ValidationError);
  });

  it('converts 403 to AuthorizationError', () => {
    const err = new Error('forbidden') as Error & { response: { status: number } };
    err.response = { status: 403 };
    expect(toStateSetError(err)).toBeInstanceOf(AuthorizationError);
  });

  it('converts 409 to ConflictError', () => {
    const err = new Error('conflict') as Error & { response: { status: number } };
    err.response = { status: 409 };
    expect(toStateSetError(err)).toBeInstanceOf(ConflictError);
  });

  it('converts 503 to ServiceUnavailableError', () => {
    const err = new Error('unavailable') as Error & { response: { status: number } };
    err.response = { status: 503 };
    expect(toStateSetError(err)).toBeInstanceOf(ServiceUnavailableError);
  });

  it('converts 504 to TimeoutError', () => {
    const err = new Error('gateway timeout') as Error & { response: { status: number } };
    err.response = { status: 504 };
    expect(toStateSetError(err)).toBeInstanceOf(TimeoutError);
  });

  it('converts ETIMEDOUT to NetworkError', () => {
    const err = new Error('timeout') as NodeJS.ErrnoException;
    err.code = 'ETIMEDOUT';
    expect(toStateSetError(err)).toBeInstanceOf(NetworkError);
  });

  it('converts ENOTFOUND to NetworkError', () => {
    const err = new Error('dns fail') as NodeJS.ErrnoException;
    err.code = 'ENOTFOUND';
    expect(toStateSetError(err)).toBeInstanceOf(NetworkError);
  });
});

describe('getUserMessage', () => {
  it('returns friendly message for AUTH_ERROR', () => {
    const msg = getUserMessage(new AuthenticationError('invalid'));
    expect(msg).toContain('Authentication failed');
  });

  it('returns error.message for NotFoundError', () => {
    expect(getUserMessage(new NotFoundError('Agent xyz not found'))).toBe('Agent xyz not found');
  });

  it('returns friendly message for NETWORK_ERROR', () => {
    const msg = getUserMessage(new NetworkError('fail'));
    expect(msg).toContain('connect');
  });

  it('returns friendly message for RATE_LIMIT', () => {
    const msg = getUserMessage(new RateLimitError('limit'));
    expect(msg).toContain('many requests');
  });

  it('handles non-Error values', () => {
    expect(getUserMessage('random')).toBe('An unexpected error occurred.');
    expect(getUserMessage(null)).toBe('An unexpected error occurred.');
  });

  it('returns message for regular Error', () => {
    expect(getUserMessage(new Error('something broke'))).toBe('something broke');
  });

  it('returns friendly message for FORBIDDEN', () => {
    const msg = getUserMessage(new AuthorizationError('no perm'));
    expect(msg).toContain('permission');
  });

  it('returns friendly message for TIMEOUT', () => {
    const msg = getUserMessage(new TimeoutError('slow'));
    expect(msg).toContain('timed out');
  });

  it('returns friendly message for SERVICE_UNAVAILABLE', () => {
    const msg = getUserMessage(new ServiceUnavailableError('down'));
    expect(msg).toContain('temporarily unavailable');
  });

  it('returns friendly message for CONFIG_ERROR', () => {
    const msg = getUserMessage(new ConfigurationError('missing key'));
    expect(msg).toContain('Configuration error');
    expect(msg).toContain('missing key');
  });

  it('returns friendly message for VALIDATION_ERROR', () => {
    const msg = getUserMessage(new ValidationError('bad field'));
    expect(msg).toContain('Invalid input');
    expect(msg).toContain('bad field');
  });

  it('returns error.message for default code', () => {
    const err = new StateSetError('custom msg', 'CUSTOM_CODE');
    expect(getUserMessage(err)).toBe('custom msg');
  });
});

describe('installGlobalErrorHandlers', () => {
  const listeners: Map<string, ((...args: unknown[]) => void)[]> = new Map();

  afterEach(() => {
    // Remove any listeners we registered
    for (const [event, fns] of listeners) {
      for (const fn of fns) {
        process.removeListener(event, fn as never);
      }
    }
    listeners.clear();
    vi.restoreAllMocks();
  });

  it('registers uncaughtException handler', () => {
    const spy = vi.spyOn(process, 'on').mockImplementation(((
      event: string | symbol,
      fn: (...args: any[]) => void,
    ) => {
      const key = String(event);
      const existing = listeners.get(key) || [];
      existing.push(fn);
      listeners.set(key, existing);
      return process;
    }) as any);
    installGlobalErrorHandlers();
    expect(spy).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
  });

  it('registers unhandledRejection handler', () => {
    const spy = vi.spyOn(process, 'on').mockImplementation(((
      event: string | symbol,
      fn: (...args: any[]) => void,
    ) => {
      const key = String(event);
      const existing = listeners.get(key) || [];
      existing.push(fn);
      listeners.set(key, existing);
      return process;
    }) as any);
    installGlobalErrorHandlers();
    expect(spy).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
  });
});
