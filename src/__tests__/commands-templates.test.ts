import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  escapeRegExp,
  applyConditionals,
  handleTemplateCommand,
} from '../cli/commands-templates.js';
import type { ChatContext } from '../cli/types.js';

const {
  mockPrompt,
  mockListPromptTemplates,
  mockGetPromptTemplate,
  mockGetPromptTemplateFile,
  mockReadPromptHistory,
  mockAppendPromptHistory,
} = vi.hoisted(() => ({
  mockPrompt: vi.fn(),
  mockListPromptTemplates: vi.fn((_cwd?: string) => [] as Array<Record<string, unknown>>),
  mockGetPromptTemplate: vi.fn(
    (_name?: string, _cwd?: string) => null as Record<string, unknown> | null,
  ),
  mockGetPromptTemplateFile: vi.fn(
    (_name?: string, _cwd?: string) => null as Record<string, unknown> | null,
  ),
  mockReadPromptHistory: vi.fn((_limit?: number) => [] as Array<Record<string, unknown>>),
  mockAppendPromptHistory: vi.fn((_entry?: unknown) => undefined),
}));

vi.mock('inquirer', () => ({
  default: {
    prompt: (questions: unknown) => mockPrompt(questions),
  },
}));

vi.mock('../resources.js', () => ({
  listPromptTemplates: (cwd?: string) => mockListPromptTemplates(cwd),
  getPromptTemplate: (name: string, cwd?: string) => mockGetPromptTemplate(name, cwd),
  getPromptTemplateFile: (name: string, cwd?: string) => mockGetPromptTemplateFile(name, cwd),
}));

vi.mock('../cli/audit.js', () => ({
  readPromptHistory: (limit?: number) => mockReadPromptHistory(limit),
  appendPromptHistory: (entry: unknown) => mockAppendPromptHistory(entry),
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
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrompt.mockResolvedValue({});
    mockListPromptTemplates.mockReturnValue([]);
    mockGetPromptTemplate.mockReturnValue(null);
    mockGetPromptTemplateFile.mockReturnValue(null);
    mockReadPromptHistory.mockReturnValue([]);
  });

  it('returns unhandled for non-template commands', async () => {
    const ctx = createMockCtx();
    expect(await handleTemplateCommand('/help', ctx)).toEqual({ handled: false });
    expect(await handleTemplateCommand('/audit on', ctx)).toEqual({ handled: false });
    expect(await handleTemplateCommand('/promptsx', ctx)).toEqual({ handled: false });
    expect(await handleTemplateCommand('/prompt-historyx', ctx)).toEqual({ handled: false });
    expect(await handleTemplateCommand('/prompt-validatex', ctx)).toEqual({ handled: false });
  });

  it('/prompts shows empty list', async () => {
    const ctx = createMockCtx();
    const result = await handleTemplateCommand('/prompts', ctx);
    expect(result).toEqual({ handled: true });
    expect(ctx.rl.prompt).toHaveBeenCalled();
  });

  it('matches prompt commands with trailing whitespace', async () => {
    const ctx = createMockCtx();
    expect(await handleTemplateCommand('/prompts ', ctx)).toEqual({ handled: true });
    expect(await handleTemplateCommand('/prompt-history\t', ctx)).toEqual({ handled: true });
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

  it('/prompt-validate with specific template and no file shows warning', async () => {
    const ctx = createMockCtx();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handleTemplateCommand('/prompt-validate unknown-template', ctx);

    expect(result).toEqual({ handled: true });
    expect(
      consoleSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('No prompt templates found'),
      ),
    ).toBe(true);
  });

  it('/prompt-validate all with no templates shows warning', async () => {
    const ctx = createMockCtx();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handleTemplateCommand('/prompt-validate all', ctx);

    expect(result).toEqual({ handled: true });
    expect(
      consoleSpy.mock.calls.some(
        ([line]) => typeof line === 'string' && line.includes('No prompt templates found'),
      ),
    ).toBe(true);
  });

  it('/prompt without template name shows usage warning', async () => {
    const ctx = createMockCtx();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handleTemplateCommand('/prompt ', ctx);

    expect(result).toEqual({ handled: true });
    expect(
      consoleSpy.mock.calls.some(([line]) => typeof line === 'string' && line.includes('Usage')),
    ).toBe(true);
  });

  it('/prompt resumes readline when variable prompt throws', async () => {
    mockGetPromptTemplate.mockReturnValue({
      name: 'followup',
      content: 'Hello {{name}}',
      variables: [{ name: 'name', defaultValue: 'friend' }],
    });
    mockPrompt.mockRejectedValueOnce(new Error('prompt failed'));
    const ctx = createMockCtx();

    await expect(handleTemplateCommand('/prompt followup', ctx)).rejects.toThrow('prompt failed');
    expect(ctx.rl.pause).toHaveBeenCalledTimes(1);
    expect(ctx.rl.resume).toHaveBeenCalledTimes(1);
  });

  it('/prompt resumes readline when send confirmation prompt throws', async () => {
    mockGetPromptTemplate.mockReturnValue({
      name: 'followup',
      content: 'Hello',
      variables: [],
    });
    mockPrompt.mockRejectedValueOnce(new Error('confirm failed'));
    const ctx = createMockCtx();

    await expect(handleTemplateCommand('/prompt followup', ctx)).rejects.toThrow('confirm failed');
    expect(ctx.rl.pause).toHaveBeenCalledTimes(1);
    expect(ctx.rl.resume).toHaveBeenCalledTimes(1);
    expect(mockAppendPromptHistory).not.toHaveBeenCalled();
  });
});
