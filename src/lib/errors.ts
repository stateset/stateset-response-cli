/**
 * Error hierarchy for StateSet Response CLI
 *
 * Provides categorized errors with:
 * - Error codes for tracking
 * - HTTP status codes for API responses
 * - Retryable flag for automatic retry logic
 */

import { logger } from './logger.js';

/**
 * Process exit codes for structured error classification.
 */
export const EXIT_CODES = {
  SUCCESS: 0,
  USER_ERROR: 1,
  OPERATIONAL: 2,
  INTERNAL: 3,
  TIMEOUT: 4,
  CANCELLED: 5,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

let isExiting = false;

const onUncaughtException = (error: unknown) => {
  const ssError = toStateSetError(error);
  const userMsg = getUserMessage(ssError);
  shutdownWithError(`Fatal error: ${userMsg}`);
};

const onUnhandledRejection = (reason: unknown) => {
  const userMsg = getUserMessage(toStateSetError(reason));
  shutdownWithError(`Unhandled error: ${userMsg}`);
};

function ensureProcessHandler(
  event: 'uncaughtException' | 'unhandledRejection',
  handler: (...args: unknown[]) => void,
): void {
  const listeners = (process.listeners as (event: string) => Array<(...args: unknown[]) => void>)(
    event,
  );
  if (!listeners.includes(handler)) {
    if (event === 'uncaughtException') {
      process.on('uncaughtException', handler as NodeJS.UncaughtExceptionListener);
    } else {
      process.on('unhandledRejection', handler as NodeJS.UnhandledRejectionListener);
    }
  }
}

function shutdownWithError(message: string): void {
  logger.error(message, { exitReason: 'fatal' });
  if (isExiting) {
    return;
  }
  isExiting = true;
  process.exitCode = 1;
  // Fatal exceptions leave the process in an unknown state. Exit on next tick.
  setImmediate(() => {
    process.exit(1);
  });
}

/**
 * Base error class for all StateSet errors
 */
export class StateSetError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly exitCode: ExitCode;
  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    statusCode: number = 500,
    retryable: boolean = false,
    context?: Record<string, unknown>,
    exitCode?: ExitCode,
  ) {
    super(message);
    this.name = 'StateSetError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.exitCode = exitCode ?? (retryable ? EXIT_CODES.OPERATIONAL : EXIT_CODES.INTERNAL);
    this.context = context;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Return actionable suggestions for recovering from this error.
   * Subclasses can override for domain-specific hints.
   */
  getSuggestions(): string[] {
    return [];
  }

  toJSON(): Record<string, unknown> {
    const suggestions = this.getSuggestions();
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      retryable: this.retryable,
      exitCode: this.exitCode,
      ...(suggestions.length > 0 && { suggestions }),
      ...(this.context && { context: this.context }),
    };
  }
}

/**
 * Validation errors - bad input data
 */
export class ValidationError extends StateSetError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, false, context, EXIT_CODES.USER_ERROR);
    this.name = 'ValidationError';
  }

  getSuggestions(): string[] {
    return ['Check that all required fields are provided and correctly formatted.'];
  }
}

/**
 * Authentication errors - invalid or missing credentials
 */
export class AuthenticationError extends StateSetError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'AUTH_ERROR', 401, false, context, EXIT_CODES.USER_ERROR);
    this.name = 'AuthenticationError';
  }

  getSuggestions(): string[] {
    return [
      'Run "response auth login" to set up your credentials.',
      'Check that your API key or CLI token is valid and not expired.',
    ];
  }
}

/**
 * Authorization errors - insufficient permissions
 */
export class AuthorizationError extends StateSetError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'FORBIDDEN', 403, false, context, EXIT_CODES.USER_ERROR);
    this.name = 'AuthorizationError';
  }

  getSuggestions(): string[] {
    return ['Verify your account has the required permissions for this operation.'];
  }
}

/**
 * Not found errors - resource doesn't exist
 */
export class NotFoundError extends StateSetError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'NOT_FOUND', 404, false, context, EXIT_CODES.USER_ERROR);
    this.name = 'NotFoundError';
  }

  getSuggestions(): string[] {
    return ['Check the resource ID or name. Use list commands to see available resources.'];
  }
}

/**
 * Conflict errors - resource already exists or version mismatch
 */
export class ConflictError extends StateSetError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONFLICT', 409, false, context, EXIT_CODES.USER_ERROR);
    this.name = 'ConflictError';
  }
}

/**
 * Rate limit errors - too many requests
 */
export class RateLimitError extends StateSetError {
  readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number, context?: Record<string, unknown>) {
    super(message, 'RATE_LIMIT', 429, true, context, EXIT_CODES.OPERATIONAL);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }

  getSuggestions(): string[] {
    if (this.retryAfterMs) {
      return [`Wait ${Math.ceil(this.retryAfterMs / 1000)}s and try again.`];
    }
    return ['Wait a moment and try again.'];
  }
}

/**
 * Network errors - connection failures, timeouts
 */
export class NetworkError extends StateSetError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'NETWORK_ERROR', 503, true, context, EXIT_CODES.OPERATIONAL);
    this.name = 'NetworkError';
  }

  getSuggestions(): string[] {
    return [
      'Check your internet connection.',
      'Verify the endpoint URL is correct (run "response config show").',
      'Run "response doctor" for diagnostics.',
    ];
  }
}

/**
 * Timeout errors - operation took too long
 */
export class TimeoutError extends StateSetError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'TIMEOUT', 504, true, context, EXIT_CODES.TIMEOUT);
    this.name = 'TimeoutError';
  }

  getSuggestions(): string[] {
    return ['The operation timed out. Try again or check service status.'];
  }
}

/**
 * Service unavailable errors - upstream service down
 */
export class ServiceUnavailableError extends StateSetError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'SERVICE_UNAVAILABLE', 503, true, context, EXIT_CODES.OPERATIONAL);
    this.name = 'ServiceUnavailableError';
  }

  getSuggestions(): string[] {
    return ['The service is temporarily unavailable. Try again in a few minutes.'];
  }
}

/**
 * Configuration errors - missing or invalid config
 */
export class ConfigurationError extends StateSetError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONFIG_ERROR', 500, false, context, EXIT_CODES.USER_ERROR);
    this.name = 'ConfigurationError';
  }

  getSuggestions(): string[] {
    return [
      'Run "response auth login" to configure credentials.',
      'Run "response config show" to inspect your configuration.',
      'Run "response doctor" for diagnostics.',
    ];
  }
}

/**
 * Internal errors - unexpected failures
 */
export class InternalError extends StateSetError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'INTERNAL_ERROR', 500, false, context, EXIT_CODES.INTERNAL);
    this.name = 'InternalError';
  }

  getSuggestions(): string[] {
    return [
      'This is an unexpected error. Please report it at https://github.com/stateset/response-cli/issues.',
    ];
  }
}

/**
 * Cancelled errors - user cancelled the operation
 */
export class CancelledError extends StateSetError {
  constructor(message: string = 'Operation cancelled', context?: Record<string, unknown>) {
    super(message, 'CANCELLED', 499, false, context, EXIT_CODES.CANCELLED);
    this.name = 'CancelledError';
  }
}

// ============================================================================
// Error Message Helpers
// ============================================================================

/** Extract a human-readable message from an unknown catch value. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// ============================================================================
// Error Classification Helpers
// ============================================================================

/**
 * Check if an error is retryable
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof StateSetError) {
    return error.retryable;
  }

  // Check for known retryable error patterns
  if (error instanceof Error) {
    const errWithCode = error as Error & { code?: string; response?: { status?: number } };

    // Network error codes
    if (['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(errWithCode.code ?? '')) {
      return true;
    }

    // HTTP status codes that indicate transient failures
    const status = errWithCode.response?.status;
    if (status && [502, 503, 504, 429].includes(status)) {
      return true;
    }
  }

  return false;
}

/**
 * Convert unknown error to StateSetError
 */
export function toStateSetError(error: unknown): StateSetError {
  if (error instanceof StateSetError) {
    return error;
  }

  if (error instanceof Error) {
    const errWithMeta = error as Error & {
      code?: string;
      response?: { status?: number };
    };

    // Network errors
    if (['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(errWithMeta.code ?? '')) {
      return new NetworkError(error.message, { originalCode: errWithMeta.code });
    }

    // HTTP status-based classification
    const status = errWithMeta.response?.status;
    if (status) {
      switch (status) {
        case 400:
          return new ValidationError(error.message);
        case 401:
          return new AuthenticationError(error.message);
        case 403:
          return new AuthorizationError(error.message);
        case 404:
          return new NotFoundError(error.message);
        case 409:
          return new ConflictError(error.message);
        case 429:
          return new RateLimitError(error.message);
        case 502:
        case 503:
          return new ServiceUnavailableError(error.message);
        case 504:
          return new TimeoutError(error.message);
      }
    }

    return new InternalError(error.message);
  }

  return new InternalError(String(error));
}

/**
 * Install global process error handlers for uncaught exceptions
 * and unhandled promise rejections. Call once at startup.
 */
export function installGlobalErrorHandlers(): void {
  ensureProcessHandler('uncaughtException', onUncaughtException);
  ensureProcessHandler('unhandledRejection', onUnhandledRejection);
}

/**
 * Get user-friendly error message
 */
export function getUserMessage(error: unknown): string {
  if (error instanceof StateSetError) {
    switch (error.code) {
      case 'AUTH_ERROR':
        return 'Authentication failed. Please check your credentials or run `response auth login`.';
      case 'FORBIDDEN':
        return 'You do not have permission to perform this action.';
      case 'NOT_FOUND':
        return error.message;
      case 'RATE_LIMIT':
        return 'Too many requests. Please wait a moment and try again.';
      case 'NETWORK_ERROR':
        return 'Unable to connect to the server. Please check your internet connection.';
      case 'TIMEOUT':
        return 'The request timed out. Please try again.';
      case 'SERVICE_UNAVAILABLE':
        return 'The service is temporarily unavailable. Please try again later.';
      case 'CONFIG_ERROR':
        return `Configuration error: ${error.message}`;
      case 'VALIDATION_ERROR':
        return `Invalid input: ${error.message}`;
      default:
        return error.message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'An unexpected error occurred.';
}

/**
 * Get the user-friendly message with appended recovery suggestions.
 */
export function getUserMessageWithSuggestions(error: unknown): string {
  const msg = getUserMessage(error);
  if (error instanceof StateSetError) {
    const suggestions = error.getSuggestions();
    if (suggestions.length > 0) {
      return `${msg}\n\nSuggestions:\n${suggestions.map((s) => `  - ${s}`).join('\n')}`;
    }
  }
  return msg;
}

/**
 * Get the exit code for an error. Returns INTERNAL for non-StateSet errors.
 */
export function getExitCode(error: unknown): ExitCode {
  if (error instanceof StateSetError) {
    return error.exitCode;
  }
  return EXIT_CODES.INTERNAL;
}
