import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

function makeBrandStudioFixture(
  cwd: string,
  brandSlug: string,
  connectors: Array<Record<string, unknown>> = [],
): void {
  const dir = path.join(cwd, '.stateset', brandSlug);
  fs.mkdirSync(path.join(dir, 'connectors'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'connectors.json'), JSON.stringify(connectors, null, 2), 'utf-8');
}

function makeFileFixture(cwd: string, relativePath: string, contents = '{}'): void {
  const filePath = path.join(cwd, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf-8');
}

function makeEngineCompletionCacheFixture(
  cwd: string,
  brandRef: string,
  data: { onboardingRunIds?: string[]; dlqItemIds?: string[] },
): void {
  const filePath = path.join(
    cwd,
    '.stateset',
    'cache',
    'engine',
    `${encodeURIComponent(brandRef)}.json`,
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        brandRef,
        updatedAt: '2026-04-06T00:00:00.000Z',
        onboardingRunIds: data.onboardingRunIds ?? [],
        dlqItemIds: data.dlqItemIds ?? [],
      },
      null,
      2,
    ),
    'utf-8',
  );
}

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

  it('completes webhooks subcommands', () => {
    const [hits] = smartCompleter('/webhooks ');
    expect(hits).toContain('list');
    expect(hits).toContain('get');
    expect(hits).toContain('create');
    expect(hits).toContain('update');
    expect(hits).toContain('deliveries');
    expect(hits).toContain('logs');
    expect(hits).toContain('delete');
  });

  it('completes webhook flags and values', () => {
    const [createFlags] = smartCompleter('/webhooks create --');
    expect(createFlags).toContain('--events');
    expect(createFlags).toContain('--enabled');

    const [updateFlags] = smartCompleter('/webhooks update --');
    expect(updateFlags).toContain('--url');
    expect(updateFlags).toContain('--events');
    expect(updateFlags).toContain('--enabled');

    const [enabledValues] = smartCompleter('/webhooks update --enabled ');
    expect(enabledValues).toContain('true');
    expect(enabledValues).toContain('false');
  });

  it('completes evals subcommands', () => {
    const [hits] = smartCompleter('/evals ');
    expect(hits).toContain('list');
    expect(hits).toContain('create');
    expect(hits).toContain('create-from-response');
    expect(hits).toContain('update');
    expect(hits).toContain('delete');
    expect(hits).toContain('export');
    expect(hits).toContain('review');
    expect(hits).toContain('suggest');
  });

  it('completes evals flag values', () => {
    const [seedHits, seedPartial] = smartCompleter('/evals create-from-response --seed r');
    expect(seedHits).toContain('rejected');
    expect(seedPartial).toBe('r');

    const [statusHits] = smartCompleter('/evals review --status ');
    expect(statusHits).toContain('pending');
    expect(statusHits).toContain('approved');
    expect(statusHits).toContain('rejected');
  });

  it('completes evals flags for curation subcommands', () => {
    const [fromResponseFlags] = smartCompleter('/evals create-from-response --');
    expect(fromResponseFlags).toContain('--seed');
    expect(fromResponseFlags).toContain('--name');
    expect(fromResponseFlags).toContain('--type');
    expect(fromResponseFlags).toContain('--status');

    const [exportFlags] = smartCompleter('/evals export --');
    expect(exportFlags).toContain('--out');
  });

  it('completes datasets subcommands', () => {
    const [hits] = smartCompleter('/datasets ');
    expect(hits).toContain('list');
    expect(hits).toContain('create');
    expect(hits).toContain('add-entry');
    expect(hits).toContain('import');
    expect(hits).toContain('export');
  });

  it('completes dataset status values', () => {
    const [hits] = smartCompleter('/datasets create --status a');
    expect(hits).toContain('active');
    expect(hits).toContain('archived');
  });

  it('completes dataset flags', () => {
    const [createFlags] = smartCompleter('/datasets create --');
    expect(createFlags).toContain('--name');
    expect(createFlags).toContain('--description');
    expect(createFlags).toContain('--status');
    expect(createFlags).toContain('--metadata');

    const [entryFlags] = smartCompleter('/datasets add-entry --');
    expect(entryFlags).toContain('--messages');
    expect(entryFlags).toContain('--file');
  });

  it('completes finetune subcommands', () => {
    const [hits] = smartCompleter('/finetune ');
    expect(hits).toContain('list');
    expect(hits).toContain('export');
    expect(hits).toContain('validate');
    expect(hits).toContain('create');
    expect(hits).toContain('deploy');
  });

  it('completes finetune flag values', () => {
    const [formatHits] = smartCompleter('/finetune export --format st');
    expect(formatHits).toContain('studio-sft');
    expect(formatHits).toContain('studio-dpo');

    const [methodHits] = smartCompleter('/finetune create --method ');
    expect(methodHits).toContain('supervised');
    expect(methodHits).toContain('dpo');
  });

  it('completes finetune flags', () => {
    const [exportFlags] = smartCompleter('/finetune export --');
    expect(exportFlags).toContain('--format');
    expect(exportFlags).toContain('--status');
    expect(exportFlags).toContain('--validation-ratio');

    const [createFlags] = smartCompleter('/finetune create --');
    expect(createFlags).toContain('--method');
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

  it('completes agents flag values', () => {
    const [hits] = smartCompleter('/agents update --active o');
    expect(hits).toContain('on');
    expect(hits).toContain('off');
  });

  it('completes agents update flags', () => {
    const [hits] = smartCompleter('/agents update --');
    expect(hits).toContain('--model');
    expect(hits).toContain('--active');
    expect(hits).toContain('--voice-model-provider');
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

  it('completes capability-area names', () => {
    const [hits] = smartCompleter('/capabilities wo');
    expect(hits).toContain('workflow-studio');

    const [aliasHits] = smartCompleter('/caps c');
    expect(aliasHits).toContain('curation');
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

  it('completes deployment status values', () => {
    const [hits] = smartCompleter('/deployments list --status app');
    expect(hits).toContain('approved');
    expect(hits).toContain('applied');
  });

  it('completes deployment list flags', () => {
    const [hits] = smartCompleter('/deployments list --');
    expect(hits).toContain('--mode');
    expect(hits).toContain('--status');
    expect(hits).toContain('--limit');
    expect(hits).toContain('--offset');
  });

  it('completes engine config subcommands', () => {
    const [engineSubs] = smartCompleter('/engine ');
    expect(engineSubs).toContain('config');
    expect(engineSubs).toContain('status');
    expect(engineSubs).toContain('activate');
    expect(engineSubs).toContain('dispatch-health');
    expect(engineSubs).toContain('dispatch-guard');
    expect(engineSubs).toContain('validate');
    expect(engineSubs).toContain('executions');
    expect(engineSubs).toContain('connectors');
    expect(engineSubs).toContain('local');
    expect(engineSubs).toContain('event');
    expect(engineSubs).toContain('migration');
    expect(engineSubs).toContain('parity');
    expect(engineSubs).toContain('policy-sets');
    expect(engineSubs).toContain('test');

    const [configSubs] = smartCompleter('/engine config ');
    expect(configSubs).toContain('show');
    expect(configSubs).toContain('pull');
    expect(configSubs).toContain('push');
    expect(configSubs).toContain('validate');
    expect(configSubs).toContain('history');
  });

  it('completes local brand refs for engine commands', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-completer-'));
    makeBrandStudioFixture(cwd, 'acme');
    makeBrandStudioFixture(cwd, 'globex');
    invalidateCompleterCache();

    const [configBrands] = smartCompleter('/engine config pull ', [], cwd);
    expect(configBrands).toContain('acme');
    expect(configBrands).toContain('globex');

    const [connectorBrands] = smartCompleter('/engine connectors g', [], cwd);
    expect(connectorBrands).toContain('globex');
    expect(connectorBrands).not.toContain('acme');

    const [localBrands] = smartCompleter('/engine local apply ', [], cwd);
    expect(localBrands).toContain('acme');

    const [activationBrands] = smartCompleter('/engine activate a', [], cwd);
    expect(activationBrands).toContain('acme');
  });

  it('completes local connector refs for engine health checks', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-completer-'));
    makeBrandStudioFixture(cwd, 'acme', [
      { id: 'connector-1', connector_key: 'shopify-primary' },
      { connector_id: 'connector-2', key: 'gorgias-primary' },
    ]);
    invalidateCompleterCache();

    const [hits] = smartCompleter('/engine connectors acme health ', [], cwd);
    expect(hits).toContain('connector-1');
    expect(hits).toContain('connector-2');
    expect(hits).toContain('shopify-primary');
    expect(hits).toContain('gorgias-primary');
  });

  it('completes cached engine onboarding and DLQ ids', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-completer-'));
    makeEngineCompletionCacheFixture(cwd, 'acme', {
      onboardingRunIds: ['run-1', 'run-2'],
      dlqItemIds: ['dlq-1', 'dlq-2'],
    });
    invalidateCompleterCache();

    const [runIds] = smartCompleter('/engine onboard show acme r', [], cwd);
    expect(runIds).toContain('run-1');
    expect(runIds).toContain('run-2');

    const [updateRunIds] = smartCompleter('/engine onboard update acme ', [], cwd);
    expect(updateRunIds).toContain('run-1');

    const [dlqIds] = smartCompleter('/engine dlq retry acme d', [], cwd);
    expect(dlqIds).toContain('dlq-1');
    expect(dlqIds).toContain('dlq-2');

    const [resolveDlqIds] = smartCompleter('/engine dlq resolve acme ', [], cwd);
    expect(resolveDlqIds).toContain('dlq-1');
  });

  it('completes engine file arguments and assignment paths', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-completer-'));
    makeFileFixture(cwd, 'brand.json');
    makeFileFixture(cwd, 'notes.txt', 'ignore');
    makeFileFixture(cwd, 'connector.json');
    makeFileFixture(cwd, 'event.json');
    makeFileFixture(cwd, 'deploy/docker-compose.yml', 'services:\n');
    fs.mkdirSync(path.join(cwd, 'exports'), { recursive: true });

    const [brandCreateFiles] = smartCompleter('/engine brands create ', [], cwd);
    expect(brandCreateFiles).toContain('brand.json');
    expect(brandCreateFiles).not.toContain('notes.txt');

    const [brandUpdateFiles] = smartCompleter('/engine brands update acme b', [], cwd);
    expect(brandUpdateFiles).toContain('brand.json');

    const [connectorCreateFiles] = smartCompleter('/engine connectors acme create c', [], cwd);
    expect(connectorCreateFiles).toContain('connector.json');

    const [eventFiles] = smartCompleter('/engine event acme e', [], cwd);
    expect(eventFiles).toContain('event.json');

    const [composeFiles] = smartCompleter('/engine local apply acme compose=', [], cwd);
    expect(composeFiles).toContain('compose=deploy/');

    const [composeNestedFiles] = smartCompleter(
      '/engine local apply acme compose=deploy/',
      [],
      cwd,
    );
    expect(composeNestedFiles).toContain('compose=deploy/docker-compose.yml');

    const [outPaths] = smartCompleter('/engine connectors acme env out=', [], cwd);
    expect(outPaths).toContain('out=exports/');
  });

  it('completes nested engine admin subcommands', () => {
    const [brandSubs] = smartCompleter('/engine brands ');
    expect(brandSubs).toContain('show');
    expect(brandSubs).toContain('create');
    expect(brandSubs).toContain('bootstrap');
    expect(brandSubs).toContain('update');

    const [connectorSubs] = smartCompleter('/engine connectors ');
    expect(connectorSubs).toContain('create');
    expect(connectorSubs).toContain('health');
    expect(connectorSubs).toContain('plan');
    expect(connectorSubs).toContain('sync');
    expect(connectorSubs).toContain('env');

    const [localSubs] = smartCompleter('/engine local ');
    expect(localSubs).toContain('apply');

    const [migrationSubs] = smartCompleter('/engine migration ');
    expect(migrationSubs).toContain('update');

    const [onboardSubs] = smartCompleter('/engine onboard ');
    expect(onboardSubs).toContain('list');
    expect(onboardSubs).toContain('show');
    expect(onboardSubs).toContain('update');

    const [templateSubs] = smartCompleter('/engine templates ');
    expect(templateSubs).toContain('create');
    expect(templateSubs).toContain('update');

    const [policySubs] = smartCompleter('/engine policy-sets ');
    expect(policySubs).toContain('get');
    expect(policySubs).toContain('create');
    expect(policySubs).toContain('update');

    const [dlqSubs] = smartCompleter('/engine dlq ');
    expect(dlqSubs).toContain('retry');
    expect(dlqSubs).toContain('resolve');
  });

  it('completes engine workflow-studio slash flags', () => {
    const [planFlags] = smartCompleter('/engine connectors acme plan --');
    expect(planFlags).toContain('--source');

    const [syncFlags] = smartCompleter('/engine connectors acme sync --');
    expect(syncFlags).toContain('--source');

    const [sourceValues] = smartCompleter('/engine connectors acme plan --source ');
    expect(sourceValues).toContain('local');
    expect(sourceValues).toContain('platform');

    const [envFlags] = smartCompleter('/engine connectors acme env --');
    expect(envFlags).toContain('--unsafe-path');
    expect(envFlags).not.toContain('--format');
    expect(envFlags).not.toContain('--loop-mode');

    const [localFlags] = smartCompleter('/engine local apply acme --');
    expect(localFlags).toContain('--write-only');
    expect(localFlags).toContain('--unsafe-path');
    expect(localFlags).not.toContain('--loop-mode');
  });

  it('completes engine dispatch flags and values', () => {
    const [healthFlags] = smartCompleter('/engine dispatch-health --');
    expect(healthFlags).toContain('--tenant-id');
    expect(healthFlags).toContain('--limit');
    expect(healthFlags).toContain('--offset');

    const [guardFlags] = smartCompleter('/engine dispatch-guard --');
    expect(guardFlags).toContain('--tenant-id');
    expect(guardFlags).toContain('--apply');
    expect(guardFlags).toContain('--minimum-health-status');
    expect(guardFlags).toContain('--max-actions');

    const [applyValues] = smartCompleter('/engine dispatch-guard --apply ');
    expect(applyValues).toContain('true');
    expect(applyValues).toContain('false');

    const [thresholdValues] = smartCompleter('/engine dispatch-guard --minimum-health-status ');
    expect(thresholdValues).toContain('warning');
    expect(thresholdValues).toContain('critical');
  });

  it('completes engine workflow-studio positional enums', () => {
    const [planHints] = smartCompleter('/engine connectors acme plan ');
    expect(planHints).toContain('subscriptions');
    expect(planHints).toContain('returns');
    expect(planHints).toContain('both');

    const [envHints] = smartCompleter('/engine connectors acme env ');
    expect(envHints).toContain('subscriptions');
    expect(envHints).toContain('returns');
    expect(envHints).toContain('both');
    expect(envHints).toContain('dotenv');
    expect(envHints).toContain('shell');
    expect(envHints).toContain('json');
    expect(envHints).toContain('out=');

    const [envAfterLoopMode] = smartCompleter('/engine connectors acme env returns ');
    expect(envAfterLoopMode).not.toContain('returns');
    expect(envAfterLoopMode).toContain('dotenv');
    expect(envAfterLoopMode).toContain('json');
    expect(envAfterLoopMode).toContain('out=');

    const [localHints] = smartCompleter('/engine local apply acme ');
    expect(localHints).toContain('subscriptions');
    expect(localHints).toContain('returns');
    expect(localHints).toContain('both');
    expect(localHints).toContain('out=');
    expect(localHints).toContain('compose=');
    expect(localHints).toContain('services=');

    const [localAfterLoopMode] = smartCompleter('/engine local apply acme subscriptions ');
    expect(localAfterLoopMode).not.toContain('subscriptions');
    expect(localAfterLoopMode).toContain('out=');
    expect(localAfterLoopMode).toContain('compose=');
    expect(localAfterLoopMode).toContain('services=');
  });

  it('completes engine admin positional enums', () => {
    const [bootstrapHints] = smartCompleter('/engine brands bootstrap acme ');
    expect(bootstrapHints).toContain('ecommerce');
    expect(bootstrapHints).toContain('subscription');
    expect(bootstrapHints).toContain('knowledge_base');
    expect(bootstrapHints).toContain('activate');

    const [bootstrapAfterTemplate] = smartCompleter('/engine brands bootstrap acme ecommerce ');
    expect(bootstrapAfterTemplate).not.toContain('ecommerce');
    expect(bootstrapAfterTemplate).toContain('activate');

    const [executionStatuses] = smartCompleter('/engine executions acme ');
    expect(executionStatuses).toContain('pending');
    expect(executionStatuses).toContain('running');
    expect(executionStatuses).toContain('completed');
    expect(executionStatuses).toContain('failed');
    expect(executionStatuses).toContain('skipped');
    expect(executionStatuses).toContain('cancelled');

    const [onboardStatuses] = smartCompleter('/engine onboard update acme run-1 ');
    expect(onboardStatuses).toContain('pending');
    expect(onboardStatuses).toContain('completed');
    expect(onboardStatuses).toContain('failed');
    expect(onboardStatuses).toContain('cancelled');

    const [dlqStatuses] = smartCompleter('/engine dlq acme ');
    expect(dlqStatuses).toContain('pending');
    expect(dlqStatuses).toContain('resolved');
    expect(dlqStatuses).toContain('retried');
    expect(dlqStatuses).toContain('failed');

    const [dlqActions] = smartCompleter('/engine dlq resolve acme dlq-1 ');
    expect(dlqActions).toContain('resolved');
  });

  it('completes workflow execution subcommands', () => {
    const [workflowSubs] = smartCompleter('/workflows ');
    expect(workflowSubs).toContain('list');
    expect(workflowSubs).toContain('status');
    expect(workflowSubs).toContain('restart');
    expect(workflowSubs).toContain('terminate');
    expect(workflowSubs).toContain('review');
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
