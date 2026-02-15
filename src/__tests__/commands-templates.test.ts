import { describe, it, expect, vi } from 'vitest';
import {
  escapeRegExp,
  applyConditionals,
  handleTemplateCommand,
} from '../cli/commands-templates.js';
import type { ChatContext } from '../cli/types.js';

vi.mock('../resources.js', () => ({
  listPromptTemplates: vi.fn(() => []),
  getPromptTemplate: vi.fn(() => null),
  getPromptTemplateFile: vi.fn(() => null),
}));

vi.mock('../cli/audit.js', () => ({
  readPromptHistory: vi.fn(() => []),
  appendPromptHistory: vi.fn(),
}));

function createMockCtx(overrides: Partial<ChatContext> = {}): ChatContext {
  return {
    rl: { prompt: vi.fn(), pause: vi.fn(), resume: vi.fn() } as any,
    cwd: '/tmp/test',
    sessionId: 'test-session',
    ...overrides,
  } as unknown as ChatContext;
}

describe('escapeRegExp', () => {
  it('escapes special regex characters', () => {
    expect(escapeRegExp('hello.world')).toBe('hello\\.world');
    expect(escapeRegExp('a+b*c?')).toBe('a\\+b\\*c\\?');
    expect(escapeRegExp('foo(bar)')).toBe('foo\\(bar\\)');
    expect(escapeRegExp('test[1]')).toBe('test\\[1\\]');
  });

  it('returns plain strings unchanged', () => {
    expect(escapeRegExp('hello')).toBe('hello');
    expect(escapeRegExp('my-variable_name')).toBe('my-variable_name');
  });
});

describe('applyConditionals', () => {
  it('keeps if block body when variable has value', () => {
    const content = '{{#if name}}Hello {{name}}!{{/if}}';
    const result = applyConditionals(content, { name: 'World' });
    expect(result).toBe('Hello {{name}}!');
  });

  it('removes if block body when variable is empty', () => {
    const content = '{{#if name}}Hello {{name}}!{{/if}}';
    const result = applyConditionals(content, { name: '' });
    expect(result).toBe('');
  });

  it('removes if block body when variable is missing', () => {
    const content = '{{#if name}}Hello!{{/if}}';
    const result = applyConditionals(content, {});
    expect(result).toBe('');
  });

  it('keeps unless block body when variable is empty', () => {
    const content = '{{#unless name}}No name provided.{{/unless}}';
    const result = applyConditionals(content, { name: '' });
    expect(result).toBe('No name provided.');
  });

  it('removes unless block body when variable has value', () => {
    const content = '{{#unless name}}No name provided.{{/unless}}';
    const result = applyConditionals(content, { name: 'Alice' });
    expect(result).toBe('');
  });

  it('uses default value from if block when variable missing', () => {
    const content = '{{#if color = "blue"}}Color is set{{/if}}';
    const result = applyConditionals(content, {});
    expect(result).toBe('Color is set');
  });

  it('handles multiple conditionals', () => {
    const content = '{{#if a}}A{{/if}} {{#unless b}}no-B{{/unless}}';
    const result = applyConditionals(content, { a: 'yes', b: '' });
    expect(result).toBe('A no-B');
  });
});

describe('handleTemplateCommand', () => {
  it('returns null for non-template commands', async () => {
    const ctx = createMockCtx();
    expect(await handleTemplateCommand('/help', ctx)).toBeNull();
    expect(await handleTemplateCommand('/audit on', ctx)).toBeNull();
  });

  it('/prompts shows empty list', async () => {
    const ctx = createMockCtx();
    const result = await handleTemplateCommand('/prompts', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.rl.prompt).toHaveBeenCalled();
  });

  it('/prompt-history shows empty history', async () => {
    const ctx = createMockCtx();
    const result = await handleTemplateCommand('/prompt-history', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.rl.prompt).toHaveBeenCalled();
  });

  it('/prompt-validate without target shows warning', async () => {
    const ctx = createMockCtx();
    const result = await handleTemplateCommand('/prompt-validate', ctx);
    expect(result).toEqual({ handled: true });
  });

  it('/prompt with unknown template shows warning', async () => {
    const ctx = createMockCtx();
    const result = await handleTemplateCommand('/prompt unknown', ctx);
    expect(result).toEqual({ handled: true });
  });
});
