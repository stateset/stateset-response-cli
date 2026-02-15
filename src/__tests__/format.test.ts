import { describe, it, expect } from 'vitest';
import { formatMoney } from '../integrations/format.js';

describe('formatMoney', () => {
  it('formats a number to two decimal places', () => {
    expect(formatMoney(10.5)).toBe('10.50');
    expect(formatMoney(7)).toBe('7.00');
    expect(formatMoney(0)).toBe('0.00');
    expect(formatMoney(99.999)).toBe('100.00');
  });

  it('formats a numeric string to two decimal places', () => {
    expect(formatMoney('7')).toBe('7.00');
    expect(formatMoney('3.14159')).toBe('3.14');
  });

  it('returns the stringified input for non-finite values', () => {
    expect(formatMoney('not-a-number')).toBe('not-a-number');
    expect(formatMoney(null)).toBe('0.00'); // Number(null) === 0
    expect(formatMoney(undefined)).toBe('undefined'); // Number(undefined) === NaN
    expect(formatMoney(Infinity)).toBe('Infinity');
  });
});
