import { describe, it, expect } from 'vitest';
import { formatElapsed, formatTable } from '../utils/display.js';

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
