import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatToolCall,
  formatToolResult,
  formatError,
  formatSuccess,
  formatWarning,
  formatAssistantMessage,
  formatElapsed,
  formatUsage,
  formatTable,
  formatDate,
  formatRelativeTime,
  formatBytes,
  formatDuration,
  printHelp,
  printWelcome,
  printAuthHelp,
} from '../utils/display.js';
import { registerAllCommands } from '../cli/command-registry.js';

describe('formatElapsed', () => {
  it('formats milliseconds under 1000', () => {
    const result = formatElapsed(500);
    expect(result).toContain('500ms');
  });

  it('formats seconds for 1000+', () => {
    const result = formatElapsed(2500);
    expect(result).toContain('2.5s');
  });

  it('formats zero', () => {
    const result = formatElapsed(0);
    expect(result).toContain('0ms');
  });

  it('formats exact seconds', () => {
    const result = formatElapsed(3000);
    expect(result).toContain('3.0s');
  });
});

describe('formatTable', () => {
  it('formats a simple table with auto columns', () => {
    const rows = [
      { name: 'Alice', age: '30' },
      { name: 'Bob', age: '25' },
    ];
    const result = formatTable(rows);
    expect(result).toContain('NAME');
    expect(result).toContain('AGE');
    expect(result).toContain('Alice');
    expect(result).toContain('Bob');
  });

  it('formats with explicit columns', () => {
    const rows = [{ name: 'Alice', age: '30', extra: 'skip' }];
    const result = formatTable(rows, ['name', 'age']);
    expect(result).toContain('NAME');
    expect(result).toContain('Alice');
    expect(result).not.toContain('EXTRA');
  });

  it('returns no-results message for empty rows', () => {
    const result = formatTable([]);
    expect(result).toContain('no results');
  });
});

describe('formatDate', () => {
  it('formats an ISO string', () => {
    const result = formatDate('2024-06-15T14:30:45.000Z');
    // Exact output depends on timezone, but should contain date parts
    expect(result).toMatch(/2024/);
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('formats a timestamp in milliseconds', () => {
    const result = formatDate(0);
    // Epoch 0 is 1970 UTC but may render as 1969 in negative-offset timezones
    expect(result).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });

  it('returns invalid date for bad input', () => {
    expect(formatDate('not-a-date')).toBe('invalid date');
  });
});

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats seconds ago', () => {
    const ts = Date.now() - 30_000;
    expect(formatRelativeTime(ts)).toBe('30s ago');
  });

  it('formats minutes ago', () => {
    const ts = Date.now() - 5 * 60_000;
    expect(formatRelativeTime(ts)).toBe('5m ago');
  });

  it('formats hours ago', () => {
    const ts = Date.now() - 3 * 3_600_000;
    expect(formatRelativeTime(ts)).toBe('3h ago');
  });

  it('formats days ago', () => {
    const ts = Date.now() - 7 * 86_400_000;
    expect(formatRelativeTime(ts)).toBe('7d ago');
  });

  it('returns just now for future timestamps', () => {
    const ts = Date.now() + 10_000;
    expect(formatRelativeTime(ts)).toBe('just now');
  });

  it('returns unknown for invalid input', () => {
    expect(formatRelativeTime('bad')).toBe('unknown');
  });
});

describe('formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB');
  });

  it('returns 0 B for negative', () => {
    expect(formatBytes(-100)).toBe('0 B');
  });

  it('returns 0 B for NaN', () => {
    expect(formatBytes(NaN)).toBe('0 B');
  });
});

describe('formatDuration', () => {
  it('formats milliseconds', () => {
    expect(formatDuration(123)).toBe('123ms');
  });

  it('formats seconds', () => {
    expect(formatDuration(45_000)).toBe('45.0s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(83_000)).toBe('1m 23s');
  });

  it('returns 0ms for negative', () => {
    expect(formatDuration(-50)).toBe('0ms');
  });

  it('returns 0ms for NaN', () => {
    expect(formatDuration(NaN)).toBe('0ms');
  });
});

// =============================================================================
// formatToolCall
// =============================================================================

describe('formatToolCall', () => {
  it('formats tool call with no args', () => {
    const result = formatToolCall('get_status', {});
    expect(result).toContain('get_status');
  });

  it('formats tool call with args', () => {
    const result = formatToolCall('get_order', { orderId: '123' });
    expect(result).toContain('get_order');
    expect(result).toContain('orderId');
    expect(result).toContain('123');
  });

  it('truncates long argument values', () => {
    const longValue = 'a'.repeat(100);
    const result = formatToolCall('test', { data: longValue });
    expect(result).toContain('...');
  });

  it('redacts sensitive keys', () => {
    const result = formatToolCall('auth', { apiKey: 'secret123', name: 'test' });
    expect(result).toContain('[redacted]');
    expect(result).not.toContain('secret123');
    expect(result).toContain('test');
  });

  it('redacts password fields', () => {
    const result = formatToolCall('login', { password: 'pass123' });
    expect(result).toContain('[redacted]');
    expect(result).not.toContain('pass123');
  });

  it('redacts authorization fields', () => {
    const result = formatToolCall('call', { authorization: 'Bearer tok' });
    expect(result).toContain('[redacted]');
  });

  it('formats non-string args as JSON', () => {
    const result = formatToolCall('test', { count: 42, active: true });
    expect(result).toContain('42');
    expect(result).toContain('true');
  });

  it('redacts nested secret fields in objects', () => {
    const result = formatToolCall('test', { config: { api_key: 'hidden', name: 'ok' } });
    expect(result).not.toContain('hidden');
  });

  it('redacts token fields', () => {
    const result = formatToolCall('test', { token: 'abc' });
    expect(result).toContain('[redacted]');
    expect(result).not.toContain('abc');
  });
});

// =============================================================================
// formatToolResult
// =============================================================================

describe('formatToolResult', () => {
  it('returns short text as-is', () => {
    const result = formatToolResult('OK');
    expect(result).toContain('OK');
  });

  it('truncates very long text', () => {
    const longText = 'x'.repeat(3000);
    const result = formatToolResult(longText);
    expect(result).toContain('truncated');
  });

  it('returns text under 2000 chars without truncation', () => {
    const text = 'y'.repeat(1999);
    const result = formatToolResult(text);
    expect(result).not.toContain('truncated');
  });
});

// =============================================================================
// formatError / formatSuccess / formatWarning / formatAssistantMessage
// =============================================================================

describe('formatting helpers', () => {
  it('formatError wraps in error prefix', () => {
    const result = formatError('something went wrong');
    expect(result).toContain('something went wrong');
    expect(result).toContain('Error');
  });

  it('formatSuccess wraps message', () => {
    const result = formatSuccess('done');
    expect(result).toContain('done');
  });

  it('formatWarning wraps message', () => {
    const result = formatWarning('careful');
    expect(result).toContain('careful');
  });

  it('formatAssistantMessage returns text', () => {
    const result = formatAssistantMessage('hello');
    expect(result).toContain('hello');
  });
});

// =============================================================================
// formatUsage
// =============================================================================

describe('formatUsage', () => {
  it('formats basic input/output tokens', () => {
    const result = formatUsage({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
    });
    expect(result).toContain('in 100');
    expect(result).toContain('out 50');
    expect(result).not.toContain('cache');
  });

  it('includes cache read when present', () => {
    const result = formatUsage({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: null,
    });
    expect(result).toContain('cache read 30');
  });

  it('includes cache write when present', () => {
    const result = formatUsage({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: 20,
    });
    expect(result).toContain('cache write 20');
  });

  it('includes both cache fields when present', () => {
    const result = formatUsage({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: 20,
    });
    expect(result).toContain('cache read 30');
    expect(result).toContain('cache write 20');
  });
});

describe('cli help text', () => {
  it('includes /exit and /quit in printHelp', () => {
    registerAllCommands();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printHelp();
    const output = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('/exit /quit');
    expect(output).toContain('[limit=100]');
    expect(output).toContain('scans up to 5000 entries');
    spy.mockRestore();
  });

  it('includes essential commands in printWelcome', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printWelcome('org-id', '1.2.3', 'model-id');
    const output = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('/help');
    expect(output).toContain('/agents');
    expect(output).toContain('/rules');
    expect(output).toContain('/status');
    expect(output).toContain('org-id');
    expect(output).toContain('model-id');
    spy.mockRestore();
  });

  it('printAuthHelp shows setup instructions', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printAuthHelp();
    const output = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('response auth login');
    expect(output).toContain('Setup required');
    spy.mockRestore();
  });

  it('printWelcome omits model when not provided', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printWelcome('org-x', '1.0.0');
    const output = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('org-x');
    expect(output).toContain('v1.0.0');
    spy.mockRestore();
  });
});
