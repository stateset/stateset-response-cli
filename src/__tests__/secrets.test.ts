import { describe, it, expect } from 'vitest';
import {
  isEncrypted,
  encryptSecret,
  decryptSecret,
  encryptConfigSecrets,
  decryptConfigSecrets,
  redactSecret,
  SECRET_KEYS,
} from '../lib/secrets.js';

describe('isEncrypted', () => {
  it('returns true for enc: prefix', () => {
    expect(isEncrypted('enc:abc123')).toBe(true);
  });

  it('returns false for plaintext', () => {
    expect(isEncrypted('my-api-key')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isEncrypted('')).toBe(false);
  });
});

describe('encryptSecret / decryptSecret', () => {
  it('roundtrips a secret string', () => {
    const original = 'my-secret-api-key-12345';
    const encrypted = encryptSecret(original);
    expect(encrypted.startsWith('enc:')).toBe(true);
    expect(encrypted).not.toContain(original);
    expect(decryptSecret(encrypted)).toBe(original);
  });

  it('does not double-encrypt', () => {
    const original = 'test-secret-value-1234';
    const encrypted = encryptSecret(original);
    const doubleEncrypted = encryptSecret(encrypted);
    expect(doubleEncrypted).toBe(encrypted);
  });

  it('returns empty string as-is', () => {
    expect(encryptSecret('')).toBe('');
    expect(decryptSecret('')).toBe('');
  });

  it('returns plaintext from decryptSecret', () => {
    expect(decryptSecret('plaintext-value')).toBe('plaintext-value');
  });

  it('handles various string lengths', () => {
    for (const len of [1, 5, 16, 32, 100, 500]) {
      const original = 'x'.repeat(len);
      const encrypted = encryptSecret(original);
      expect(decryptSecret(encrypted)).toBe(original);
    }
  });

  it('throws on corrupt encrypted data', () => {
    expect(() => decryptSecret('enc:!!!invalid-base64!!!')).toThrow();
  });
});

describe('encryptConfigSecrets / decryptConfigSecrets', () => {
  it('encrypts and decrypts specified keys', () => {
    const config = { cliToken: 'token123456', name: 'My Org' };
    const encrypted = encryptConfigSecrets(config, ['cliToken']);
    expect(encrypted.name).toBe('My Org');
    expect((encrypted.cliToken as string).startsWith('enc:')).toBe(true);
    const decrypted = decryptConfigSecrets(encrypted, ['cliToken']);
    expect(decrypted.cliToken).toBe('token123456');
  });

  it('skips non-string fields', () => {
    const config = { count: 42, name: 'test' };
    const result = encryptConfigSecrets(config, ['count']);
    expect(result.count).toBe(42);
  });

  it('skips missing keys', () => {
    const config = { name: 'test' };
    const result = encryptConfigSecrets(config, ['missingKey']);
    expect(result).toEqual({ name: 'test' });
  });
});

describe('redactSecret', () => {
  it('returns (not set) for undefined', () => {
    expect(redactSecret(undefined)).toBe('(not set)');
  });

  it('fully masks short strings', () => {
    const result = redactSecret('abc');
    expect(result).toBe('***');
  });

  it('redacts middle of long strings', () => {
    const result = redactSecret('my-long-secret-key');
    expect(result).toBe('my-l...-key');
  });

  it('handles exactly 8 character strings', () => {
    const result = redactSecret('12345678');
    expect(result).toBe('********');
  });
});

describe('SECRET_KEYS', () => {
  it('includes expected keys', () => {
    expect(SECRET_KEYS).toContain('cliToken');
    expect(SECRET_KEYS).toContain('adminSecret');
    expect(SECRET_KEYS).toContain('anthropicApiKey');
  });
});
