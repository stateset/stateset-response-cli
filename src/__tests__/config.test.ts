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
import {
  resolveModel,
  resolveModelOrThrow,
  formatUnknownModelError,
  DEFAULT_MODEL,
  getModelAliasText,
  MODEL_ALIASES,
  getRuntimeContext,
  getAnthropicApiKey,
} from '../config.js';

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

describe('getRuntimeContext', () => {
  it('returns org + API key together', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        currentOrg: 'org-1',
        model: DEFAULT_MODEL,
        organizations: {
          'org-1': {
            name: 'Primary Org',
            graphqlEndpoint: 'https://api.example.com',
            adminSecret: 'admin',
            cliToken: 'cli',
          },
        },
        anthropicApiKey: 'sk-anthropic',
      }),
    );

    const context = getRuntimeContext();
    expect(context.orgId).toBe('org-1');
    expect(context.orgConfig.name).toBe('Primary Org');
    expect(context.orgConfig.graphqlEndpoint).toBe('https://api.example.com');
    expect(context.anthropicApiKey).toBe('sk-anthropic');
  });
});

describe('resolveModel', () => {
  it('resolves alias "sonnet"', () => {
    expect(resolveModel('sonnet')).toBe('claude-sonnet-4-6-20250514');
  });

  it('resolves alias "haiku"', () => {
    expect(resolveModel('haiku')).toBe('claude-haiku-4-5-20251001');
  });

  it('resolves alias "opus"', () => {
    expect(resolveModel('opus')).toBe('claude-opus-4-6-20250514');
  });

  it('is case-insensitive', () => {
    expect(resolveModel('SONNET')).toBe('claude-sonnet-4-6-20250514');
    expect(resolveModel('Haiku')).toBe('claude-haiku-4-5-20251001');
  });

  it('accepts full model ID', () => {
    expect(resolveModel('claude-sonnet-4-6-20250514')).toBe('claude-sonnet-4-6-20250514');
  });

  it('returns null for unknown model', () => {
    expect(resolveModel('gpt-4')).toBeNull();
    expect(resolveModel('')).toBeNull();
    expect(resolveModel('nonexistent')).toBeNull();
  });

  it('trims whitespace', () => {
    expect(resolveModel('  sonnet  ')).toBe('claude-sonnet-4-6-20250514');
  });

  it('throws for invalid model in strict resolver', () => {
    expect(() => resolveModelOrThrow('bad-model')).toThrow(
      'Unknown model "bad-model". Use sonnet, haiku, or opus',
    );
  });

  it('formats unknown model errors in valid style', () => {
    expect(formatUnknownModelError('bad-model', 'valid')).toBe(
      'Unknown model "bad-model". Valid: sonnet, haiku, opus',
    );
  });
});

describe('constants', () => {
  it('DEFAULT_MODEL is a valid model', () => {
    expect(resolveModel(DEFAULT_MODEL)).toBe(DEFAULT_MODEL);
  });

  it('MODEL_ALIASES has all three aliases', () => {
    expect(Object.keys(MODEL_ALIASES)).toEqual(['sonnet', 'haiku', 'opus']);
  });

  it('getModelAliasText("list") returns list aliases', () => {
    expect(getModelAliasText('list')).toBe('sonnet, haiku, opus');
  });

  it('getModelAliasText("or") returns or-separated aliases', () => {
    expect(getModelAliasText('or')).toBe('sonnet, haiku, or opus');
  });
});
