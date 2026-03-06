import { describe, it, expect, vi, beforeAll } from 'vitest';
import { registerAllCommands } from '../cli/command-registry.js';

vi.mock('../cli/session-meta.js', () => ({
  listSessionSummaries: vi.fn(() => [
    { id: 'default', dir: '', updatedAtMs: 0, messageCount: 0, tags: [], archived: false },
    { id: 'my-session', dir: '', updatedAtMs: 0, messageCount: 0, tags: [], archived: false },
    { id: 'test-run', dir: '', updatedAtMs: 0, messageCount: 0, tags: [], archived: false },
  ]),
}));

vi.mock('../resources.js', () => ({
  listPromptTemplates: vi.fn(() => [
    { name: 'incident', path: '', displayPath: '', content: '', variables: [] },
    { name: 'refund', path: '', displayPath: '', content: '', variables: [] },
  ]),
  listSkills: vi.fn(() => [
    { name: 'ops', path: '', displayPath: '', description: '', content: '' },
    { name: 'triage', path: '', displayPath: '', description: '', content: '' },
  ]),
}));

import { smartCompleter, invalidateCompleterCache } from '../cli/completer.js';

beforeAll(() => {
  registerAllCommands();
});

describe('smartCompleter', () => {
  it('completes slash command names', () => {
    const [hits] = smartCompleter('/he');
    expect(hits).toContain('/help');
  });

  it('returns all commands when no match', () => {
    const [hits] = smartCompleter('/');
    expect(hits.length).toBeGreaterThan(0);
  });

  it('does not complete non-slash input', () => {
    const [hits, line] = smartCompleter('hello');
    expect(hits).toEqual([]);
    expect(line).toBe('hello');
  });

  it('completes model names for /model', () => {
    const [hits, partial] = smartCompleter('/model s');
    expect(hits).toContain('sonnet');
    expect(partial).toBe('s');
  });

  it('completes all model aliases when no partial', () => {
    const [hits] = smartCompleter('/model ');
    expect(hits).toContain('sonnet');
    expect(hits).toContain('haiku');
    expect(hits).toContain('opus');
  });

  it('completes session IDs for /resume', () => {
    invalidateCompleterCache();
    const [hits] = smartCompleter('/resume ');
    expect(hits).toContain('default');
    expect(hits).toContain('my-session');
  });

  it('filters session IDs by prefix', () => {
    invalidateCompleterCache();
    const [hits] = smartCompleter('/resume my');
    expect(hits).toContain('my-session');
    expect(hits).not.toContain('default');
  });

  it('completes toggle values for /apply', () => {
    const [hits] = smartCompleter('/apply ');
    expect(hits).toContain('on');
    expect(hits).toContain('off');
  });

  it('completes rules subcommands', () => {
    const [hits] = smartCompleter('/rules l');
    expect(hits).toContain('list');
  });

  it('completes kb subcommands', () => {
    const [hits] = smartCompleter('/kb ');
    expect(hits).toContain('search');
    expect(hits).toContain('add');
  });

  it('completes agents subcommands', () => {
    const [hits] = smartCompleter('/agents ');
    expect(hits).toContain('list');
    expect(hits).toContain('get');
  });

  it('completes policy subcommands', () => {
    const [hits] = smartCompleter('/policy ');
    expect(hits).toContain('list');
    expect(hits).toContain('set');
  });

  it('completes export formats and sessions', () => {
    invalidateCompleterCache();
    const [hits] = smartCompleter('/export ');
    expect(hits).toContain('md');
    expect(hits).toContain('json');
    expect(hits).toContain('jsonl');
    expect(hits).toContain('default');
  });

  it('completes tag subcommands', () => {
    const [hits] = smartCompleter('/tag ');
    expect(hits).toContain('list');
    expect(hits).toContain('add');
    expect(hits).toContain('remove');
  });

  it('includes extension commands in name completion', () => {
    const [hits] = smartCompleter('/my', ['myext']);
    expect(hits).toContain('/myext');
  });

  it('completes help topics including categories and hidden command names', () => {
    const [hits] = smartCompleter('/help int');
    expect(hits).toContain('integrations');
    expect(hits).toContain('/integrations health');
    expect(hits).toContain('/integrations logs');
  });

  it('completes integration subcommands and integration ids', () => {
    const [subcommands] = smartCompleter('/integrations ');
    expect(subcommands).toContain('status');
    expect(subcommands).toContain('health');
    expect(subcommands).toContain('logs');

    const [integrations] = smartCompleter('/integrations health sh');
    expect(integrations).toContain('shopify');
  });

  it('completes integration flags for health/logs subcommands', () => {
    const [healthFlags] = smartCompleter('/integrations health --');
    expect(healthFlags).toContain('--detailed');

    const [logFlags] = smartCompleter('/integrations logs --');
    expect(logFlags).toContain('--last');
  });

  it('completes prompt template names', () => {
    const [hits] = smartCompleter('/prompt re');
    expect(hits).toContain('refund');
  });

  it('completes prompt validation targets', () => {
    const [hits] = smartCompleter('/prompt-validate ');
    expect(hits).toContain('all');
    expect(hits).toContain('incident');
  });

  it('completes skill names', () => {
    const [hits] = smartCompleter('/skill tr');
    expect(hits).toContain('triage');
  });
});
