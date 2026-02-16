import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatElapsed,
  formatTable,
  formatDate,
  formatRelativeTime,
  formatBytes,
  formatDuration,
  printHelp,
  printWelcome,
} from '../utils/display.js';

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

describe('cli help text', () => {
  it('includes /exit and /quit in printHelp', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printHelp();
    const output = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('/exit /quit');
    expect(output).toContain('[limit=100]');
    expect(output).toContain('scans up to 5000 entries');
    spy.mockRestore();
  });

  it('includes /exit and /quit in printWelcome', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printWelcome('org-id', '1.2.3', 'model-id');
    const output = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('/exit /quit');
    spy.mockRestore();
  });
});
