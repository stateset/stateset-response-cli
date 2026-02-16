vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    statSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn(),
  },
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import { resolveModel, DEFAULT_MODEL, MODEL_ALIASES, getAnthropicApiKey } from '../config.js';

const mockedFs = vi.mocked(fs);

beforeEach(() => {
  mockedFs.existsSync.mockReturnValue(false);
  mockedFs.readFileSync.mockReturnValue('');
  delete process.env.ANTHROPIC_API_KEY;
});

describe('getAnthropicApiKey', () => {
  it('prefers trimmed ANTHROPIC_API_KEY env var', () => {
    process.env.ANTHROPIC_API_KEY = '  sk-ant-env  ';
    expect(getAnthropicApiKey()).toBe('sk-ant-env');
  });

  it('falls back to trimmed config key when env var is not set', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        currentOrg: 'org-1',
        organizations: {
          org: {
            name: 'Org',
            graphqlEndpoint: 'http://localhost',
            adminSecret: 'admin',
            cliToken: 'cli',
          },
        },
        anthropicApiKey: '  sk-ant-config  ',
      }),
    );

    expect(getAnthropicApiKey()).toBe('sk-ant-config');
  });
});

describe('resolveModel', () => {
  it('resolves alias "sonnet"', () => {
    expect(resolveModel('sonnet')).toBe('claude-sonnet-4-20250514');
  });

  it('resolves alias "haiku"', () => {
    expect(resolveModel('haiku')).toBe('claude-haiku-35-20241022');
  });

  it('resolves alias "opus"', () => {
    expect(resolveModel('opus')).toBe('claude-opus-4-20250514');
  });

  it('is case-insensitive', () => {
    expect(resolveModel('SONNET')).toBe('claude-sonnet-4-20250514');
    expect(resolveModel('Haiku')).toBe('claude-haiku-35-20241022');
  });

  it('accepts full model ID', () => {
    expect(resolveModel('claude-sonnet-4-20250514')).toBe('claude-sonnet-4-20250514');
  });

  it('returns null for unknown model', () => {
    expect(resolveModel('gpt-4')).toBeNull();
    expect(resolveModel('')).toBeNull();
    expect(resolveModel('nonexistent')).toBeNull();
  });

  it('trims whitespace', () => {
    expect(resolveModel('  sonnet  ')).toBe('claude-sonnet-4-20250514');
  });
});

describe('constants', () => {
  it('DEFAULT_MODEL is a valid model', () => {
    expect(resolveModel(DEFAULT_MODEL)).toBe(DEFAULT_MODEL);
  });

  it('MODEL_ALIASES has all three aliases', () => {
    expect(Object.keys(MODEL_ALIASES)).toEqual(['sonnet', 'haiku', 'opus']);
  });
});
