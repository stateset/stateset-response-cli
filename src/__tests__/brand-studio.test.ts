import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildBrandStudioBundle,
  loadBrandStudioBundle,
  normalizeBrandSlugOrThrow,
  validateBrandSlug,
  validateBrandStudioBundle,
  writeBrandStudioBundle,
} from '../lib/brand-studio.js';
import {
  buildConnector,
  buildDefaultAutomationConfig,
  buildDefaultManifest,
} from '../lib/manifest-builder.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-brand-studio-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('brand-studio helpers', () => {
  it('accepts valid brand slugs and rejects traversal input', () => {
    expect(normalizeBrandSlugOrThrow('acme-2')).toBe('acme-2');
    expect(validateBrandSlug('acme')).toBe(true);
    expect(validateBrandSlug('..')).toMatch(/Brand slug must use lowercase letters/);
    expect(() => normalizeBrandSlugOrThrow('../acme')).toThrow(
      /Brand slug must use lowercase letters/,
    );
  });

  it('writes and reloads a canonical brand bundle', () => {
    const cwd = makeTempDir();
    const brandSlug = 'acme';
    const automationConfig = buildDefaultAutomationConfig({
      brandSlug,
      brandName: 'Acme',
      model: 'gpt-4.1',
      provider: 'openai',
    });
    const skipRules = [{ rule_type: 'agent_filter', params: {} }] as const;
    const escalationPatterns = [
      { pattern: 'lawyer', category: 'legal_threat', is_regex: false },
    ] as const;
    const connectors = [
      buildConnector('shopify', {
        baseUrl: 'https://acme.myshopify.com',
        secretRef: 'env://SHOPIFY_ACCESS_TOKEN',
      }),
    ];
    const manifest = buildDefaultManifest(brandSlug, 'Acme', automationConfig);
    const bundle = buildBrandStudioBundle({
      brandSlug,
      cwd,
      displayName: 'Acme',
      manifest,
      automationConfig,
      connectors,
      skipRules: [...skipRules],
      escalationPatterns: [...escalationPatterns],
    });

    writeBrandStudioBundle(bundle);

    const loaded = loadBrandStudioBundle(brandSlug, cwd);
    expect(loaded.automationConfig.model).toBe('gpt-4.1');
    expect(loaded.automationConfig.skip_rules).toEqual(skipRules);
    expect(loaded.automationConfig.escalation_rules.patterns).toEqual(escalationPatterns);
    expect(loaded.manifest.workflow_bindings[0].deterministic_config.skip_rules).toEqual(skipRules);
    expect(loaded.manifest.connectors).toEqual(connectors);
    expect(fs.existsSync(path.join(cwd, '.stateset', brandSlug, 'connectors.json'))).toBe(true);
    expect(
      fs.existsSync(path.join(cwd, '.stateset', brandSlug, 'connectors', 'connectors.json')),
    ).toBe(true);
  });

  it('detects drift between automation-config and sidecar rules', () => {
    const cwd = makeTempDir();
    const brandSlug = 'acme';
    const automationConfig = buildDefaultAutomationConfig({
      brandSlug,
      brandName: 'Acme',
    });
    const bundle = buildBrandStudioBundle({
      brandSlug,
      cwd,
      displayName: 'Acme',
      automationConfig,
      skipRules: [{ rule_type: 'agent_filter', params: {} }],
      escalationPatterns: [],
    });

    writeBrandStudioBundle(bundle);

    const automationPath = path.join(cwd, '.stateset', brandSlug, 'automation-config.json');
    const onDiskConfig = JSON.parse(fs.readFileSync(automationPath, 'utf-8')) as {
      skip_rules: unknown[];
    };
    onDiskConfig.skip_rules = [];
    fs.writeFileSync(automationPath, JSON.stringify(onDiskConfig, null, 2) + '\n', 'utf-8');

    const reloaded = loadBrandStudioBundle(brandSlug, cwd);
    const issues = validateBrandStudioBundle(reloaded);
    expect(issues).toContain(
      'automation-config.json skip_rules are out of sync with rules/skip-rules.json.',
    );
  });
});
