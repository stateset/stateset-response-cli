import fs from 'node:fs';
import path from 'node:path';
import { readJsonFile as readJsonFileSafe } from '../utils/file-read.js';
import { ensurePrivateDirectory, writePrivateTextFileSecure } from '../utils/secure-file.js';
import {
  buildDefaultAutomationConfig,
  buildDefaultManifest,
  type AutomationConfig,
  type BrandManifest,
  type ConnectorSpec,
  type EscalationPattern,
  type SkipRule,
} from './manifest-builder.js';

const PRIMARY_WORKFLOW_TYPE = 'response-automation-v2';
const PRIMARY_TEMPLATE_KEY = 'ResponseAutomationV2';
const PRIMARY_TASK_QUEUE = 'stateset-response-automation-v2';
const BRAND_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

type BrandWorkflowBinding = BrandManifest['workflow_bindings'][number];

export interface BrandStudioPaths {
  statesetDir: string;
  dir: string;
  manifest: string;
  automationConfig: string;
  connectors: string;
  legacyConnectors: string;
  skipRules: string;
  escalationPatterns: string;
}

export interface BrandStudioBundleSourceFiles {
  manifest: boolean;
  automationConfig: boolean;
  connectorsRoot: boolean;
  connectorsLegacy: boolean;
  skipRules: boolean;
  escalationPatterns: boolean;
}

export interface BrandStudioBundle {
  brandSlug: string;
  dir: string;
  paths: BrandStudioPaths;
  manifest: BrandManifest;
  automationConfig: AutomationConfig;
  connectors: ConnectorSpec[];
  skipRules: SkipRule[];
  escalationPatterns: EscalationPattern[];
  sourceFiles: BrandStudioBundleSourceFiles;
  rawManifest?: BrandManifest;
  rawAutomationConfig?: AutomationConfig;
  rawConnectors?: ConnectorSpec[];
  rawSkipRules?: SkipRule[];
  rawEscalationPatterns?: EscalationPattern[];
}

interface BuildBrandStudioBundleOptions {
  brandSlug: string;
  cwd?: string;
  displayName?: string;
  manifest?: BrandManifest;
  automationConfig?: AutomationConfig;
  connectors?: ConnectorSpec[];
  skipRules?: SkipRule[];
  escalationPatterns?: EscalationPattern[];
  sourceFiles?: BrandStudioBundleSourceFiles;
  rawManifest?: BrandManifest;
  rawAutomationConfig?: AutomationConfig;
  rawConnectors?: ConnectorSpec[];
  rawSkipRules?: SkipRule[];
  rawEscalationPatterns?: EscalationPattern[];
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeBrandSlugOrThrow(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('Brand slug is required.');
  }
  if (!BRAND_SLUG_PATTERN.test(normalized)) {
    throw new Error('Brand slug must use lowercase letters, numbers, and internal hyphens only.');
  }
  return normalized;
}

export function validateBrandSlug(value: string): true | string {
  try {
    normalizeBrandSlugOrThrow(value);
    return true;
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid brand slug.';
  }
}

function readJsonFile<T>(filePath: string): T {
  return readJsonFileSafe(filePath, {
    label: 'Brand studio file',
  }) as T;
}

function writeJsonFile(filePath: string, data: unknown): void {
  writePrivateTextFileSecure(filePath, JSON.stringify(data, null, 2) + '\n', {
    label: 'Brand studio file',
    atomic: true,
  });
}

function arraysEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function findPrimaryWorkflowBinding(
  bindings: BrandManifest['workflow_bindings'] | undefined,
): BrandWorkflowBinding | undefined {
  if (!Array.isArray(bindings)) {
    return undefined;
  }
  const exact = bindings.find(
    (binding) =>
      binding.workflow_type === PRIMARY_WORKFLOW_TYPE ||
      binding.template_key === PRIMARY_TEMPLATE_KEY,
  );
  return exact ?? bindings[0];
}

function syncAutomationConfig(
  brandSlug: string,
  displayName: string,
  automationConfig: AutomationConfig | undefined,
  skipRules: SkipRule[],
  escalationPatterns: EscalationPattern[],
): AutomationConfig {
  const defaults = buildDefaultAutomationConfig({ brandSlug, brandName: displayName });
  const base = automationConfig ? cloneJson(automationConfig) : defaults;

  return {
    ...defaults,
    ...base,
    brand_slug: brandSlug,
    skip_rules: cloneJson(skipRules),
    escalation_rules: {
      ...defaults.escalation_rules,
      ...(base.escalation_rules ?? {}),
      enabled: escalationPatterns.length > 0 || Boolean(base.escalation_rules?.enabled),
      patterns: cloneJson(escalationPatterns),
    },
    classification: {
      ...defaults.classification,
      ...(base.classification ?? {}),
      phases: Array.isArray(base.classification?.phases)
        ? cloneJson(base.classification.phases)
        : defaults.classification.phases,
    },
    review_gate: {
      ...defaults.review_gate,
      ...(base.review_gate ?? {}),
    },
    dispatch: {
      ...defaults.dispatch,
      ...(base.dispatch ?? {}),
    },
    context_sources: Array.isArray(base.context_sources)
      ? cloneJson(base.context_sources)
      : defaults.context_sources,
    tool_definitions: Array.isArray(base.tool_definitions)
      ? cloneJson(base.tool_definitions)
      : defaults.tool_definitions,
    post_actions: Array.isArray(base.post_actions) ? cloneJson(base.post_actions) : [],
  };
}

function syncWorkflowBindings(
  brandSlug: string,
  displayName: string,
  existingBindings: BrandManifest['workflow_bindings'] | undefined,
  automationConfig: AutomationConfig,
): BrandManifest['workflow_bindings'] {
  const nextBindings = Array.isArray(existingBindings) ? cloneJson(existingBindings) : [];
  const defaultBinding = buildDefaultManifest(brandSlug, displayName, automationConfig)
    .workflow_bindings[0];
  const targetIndex = nextBindings.findIndex(
    (binding) =>
      binding.workflow_type === PRIMARY_WORKFLOW_TYPE ||
      binding.template_key === PRIMARY_TEMPLATE_KEY,
  );

  const existingBinding = targetIndex >= 0 ? nextBindings[targetIndex] : undefined;
  const syncedBinding: BrandWorkflowBinding = {
    ...defaultBinding,
    ...(existingBinding ?? {}),
    workflow_type: existingBinding?.workflow_type ?? defaultBinding.workflow_type,
    template_key: existingBinding?.template_key ?? defaultBinding.template_key,
    template_version: existingBinding?.template_version ?? defaultBinding.template_version,
    task_queue: existingBinding?.task_queue ?? PRIMARY_TASK_QUEUE,
    enabled: existingBinding?.enabled ?? true,
    deterministic_config: cloneJson(automationConfig),
  };

  if (targetIndex >= 0) {
    nextBindings[targetIndex] = syncedBinding;
  } else {
    nextBindings.unshift(syncedBinding);
  }

  return nextBindings;
}

export function getBrandStudioPaths(
  brandSlug: string,
  cwd: string = process.cwd(),
): BrandStudioPaths {
  const normalizedBrandSlug = normalizeBrandSlugOrThrow(brandSlug);
  const statesetDir = path.resolve(cwd, '.stateset');
  const dir = path.join(statesetDir, normalizedBrandSlug);
  return {
    statesetDir,
    dir,
    manifest: path.join(dir, 'manifest.json'),
    automationConfig: path.join(dir, 'automation-config.json'),
    connectors: path.join(dir, 'connectors.json'),
    legacyConnectors: path.join(dir, 'connectors', 'connectors.json'),
    skipRules: path.join(dir, 'rules', 'skip-rules.json'),
    escalationPatterns: path.join(dir, 'rules', 'escalation-patterns.json'),
  };
}

export function brandStudioExists(brandSlug: string, cwd: string = process.cwd()): boolean {
  return fs.existsSync(getBrandStudioPaths(brandSlug, cwd).dir);
}

export function buildBrandStudioBundle(options: BuildBrandStudioBundleOptions): BrandStudioBundle {
  const brandSlug = normalizeBrandSlugOrThrow(options.brandSlug);
  const displayName =
    options.displayName?.trim() ||
    options.manifest?.display_name ||
    options.manifest?.slug ||
    brandSlug;
  const paths = getBrandStudioPaths(brandSlug, options.cwd);

  const connectors = cloneJson(
    options.connectors ?? options.manifest?.connectors ?? [],
  ) as ConnectorSpec[];
  const skipRules = cloneJson(
    options.skipRules ?? options.automationConfig?.skip_rules ?? [],
  ) as SkipRule[];
  const escalationPatterns = cloneJson(
    options.escalationPatterns ?? options.automationConfig?.escalation_rules?.patterns ?? [],
  ) as EscalationPattern[];
  const automationConfig = syncAutomationConfig(
    brandSlug,
    displayName,
    options.automationConfig,
    skipRules,
    escalationPatterns,
  );
  const defaultManifest = buildDefaultManifest(brandSlug, displayName, automationConfig);
  const manifestBase = options.manifest ? cloneJson(options.manifest) : defaultManifest;
  const manifest: BrandManifest = {
    ...defaultManifest,
    ...manifestBase,
    slug: brandSlug,
    display_name: manifestBase.display_name || displayName,
    workflow_bindings: syncWorkflowBindings(
      brandSlug,
      displayName,
      manifestBase.workflow_bindings,
      automationConfig,
    ),
    connectors: cloneJson(connectors),
  };

  return {
    brandSlug,
    dir: paths.dir,
    paths,
    manifest,
    automationConfig,
    connectors,
    skipRules,
    escalationPatterns,
    sourceFiles: options.sourceFiles ?? {
      manifest: false,
      automationConfig: false,
      connectorsRoot: false,
      connectorsLegacy: false,
      skipRules: false,
      escalationPatterns: false,
    },
    rawManifest: options.rawManifest,
    rawAutomationConfig: options.rawAutomationConfig,
    rawConnectors: options.rawConnectors,
    rawSkipRules: options.rawSkipRules,
    rawEscalationPatterns: options.rawEscalationPatterns,
  };
}

export function loadBrandStudioBundle(
  brandSlug: string,
  cwd: string = process.cwd(),
): BrandStudioBundle {
  const paths = getBrandStudioPaths(brandSlug, cwd);
  if (!fs.existsSync(paths.dir)) {
    throw new Error(`Brand config directory not found: ${paths.dir}`);
  }

  const sourceFiles: BrandStudioBundleSourceFiles = {
    manifest: fs.existsSync(paths.manifest),
    automationConfig: fs.existsSync(paths.automationConfig),
    connectorsRoot: fs.existsSync(paths.connectors),
    connectorsLegacy: fs.existsSync(paths.legacyConnectors),
    skipRules: fs.existsSync(paths.skipRules),
    escalationPatterns: fs.existsSync(paths.escalationPatterns),
  };

  const rawManifest = sourceFiles.manifest
    ? readJsonFile<BrandManifest>(paths.manifest)
    : undefined;
  const rawAutomationConfig = sourceFiles.automationConfig
    ? readJsonFile<AutomationConfig>(paths.automationConfig)
    : undefined;
  const rawRootConnectors = sourceFiles.connectorsRoot
    ? readJsonFile<ConnectorSpec[]>(paths.connectors)
    : undefined;
  const rawLegacyConnectors = sourceFiles.connectorsLegacy
    ? readJsonFile<ConnectorSpec[]>(paths.legacyConnectors)
    : undefined;
  const manifestBinding = findPrimaryWorkflowBinding(rawManifest?.workflow_bindings);
  const bindingConfig =
    manifestBinding &&
    typeof manifestBinding.deterministic_config === 'object' &&
    manifestBinding.deterministic_config !== null
      ? (manifestBinding.deterministic_config as AutomationConfig)
      : undefined;
  const automationConfig = rawAutomationConfig ?? bindingConfig;
  const rawConnectors = rawRootConnectors ?? rawLegacyConnectors ?? rawManifest?.connectors ?? [];
  const rawSkipRules = sourceFiles.skipRules
    ? readJsonFile<SkipRule[]>(paths.skipRules)
    : (automationConfig?.skip_rules ?? []);
  const rawEscalationPatterns = sourceFiles.escalationPatterns
    ? readJsonFile<EscalationPattern[]>(paths.escalationPatterns)
    : (automationConfig?.escalation_rules?.patterns ?? []);

  return buildBrandStudioBundle({
    brandSlug,
    cwd,
    displayName: rawManifest?.display_name,
    manifest: rawManifest,
    automationConfig,
    connectors: rawConnectors,
    skipRules: rawSkipRules,
    escalationPatterns: rawEscalationPatterns,
    sourceFiles,
    rawManifest,
    rawAutomationConfig,
    rawConnectors: rawRootConnectors ?? rawLegacyConnectors,
    rawSkipRules: sourceFiles.skipRules ? rawSkipRules : undefined,
    rawEscalationPatterns: sourceFiles.escalationPatterns ? rawEscalationPatterns : undefined,
  });
}

export function writeBrandStudioBundle(bundle: BrandStudioBundle): string {
  ensurePrivateDirectory(bundle.dir, {
    symlinkErrorPrefix: 'Brand studio directory must not be a symlink',
    nonDirectoryErrorPrefix: 'Brand studio path is not a directory',
  });
  writeJsonFile(bundle.paths.manifest, bundle.manifest);
  writeJsonFile(bundle.paths.automationConfig, bundle.automationConfig);
  writeJsonFile(bundle.paths.connectors, bundle.connectors);
  writeJsonFile(bundle.paths.legacyConnectors, bundle.connectors);
  writeJsonFile(bundle.paths.skipRules, bundle.skipRules);
  writeJsonFile(bundle.paths.escalationPatterns, bundle.escalationPatterns);
  return bundle.dir;
}

export function syncBrandStudioBundle(
  brandSlug: string,
  cwd: string = process.cwd(),
): BrandStudioBundle {
  const bundle = loadBrandStudioBundle(brandSlug, cwd);
  writeBrandStudioBundle(bundle);
  return bundle;
}

export function validateBrandStudioBundle(bundle: BrandStudioBundle): string[] {
  const issues: string[] = [];

  if (!bundle.sourceFiles.manifest) {
    issues.push('Missing manifest.json.');
  }
  if (!bundle.sourceFiles.automationConfig) {
    issues.push('Missing automation-config.json.');
  }
  if (!bundle.sourceFiles.connectorsRoot) {
    issues.push('Missing connectors.json.');
  }
  if (bundle.sourceFiles.connectorsLegacy && !bundle.sourceFiles.connectorsRoot) {
    issues.push('Using legacy connectors/connectors.json without root connectors.json.');
  }
  if (!bundle.sourceFiles.skipRules) {
    issues.push('Missing rules/skip-rules.json.');
  }
  if (!bundle.sourceFiles.escalationPatterns) {
    issues.push('Missing rules/escalation-patterns.json.');
  }

  if (
    bundle.rawManifest &&
    bundle.rawManifest.slug &&
    bundle.rawManifest.slug !== bundle.brandSlug
  ) {
    issues.push(
      `manifest.json slug "${bundle.rawManifest.slug}" does not match directory "${bundle.brandSlug}".`,
    );
  }
  if (
    bundle.rawAutomationConfig?.brand_slug &&
    bundle.rawAutomationConfig.brand_slug !== bundle.brandSlug
  ) {
    issues.push(
      `automation-config.json brand_slug "${bundle.rawAutomationConfig.brand_slug}" does not match directory "${bundle.brandSlug}".`,
    );
  }

  if (
    bundle.rawAutomationConfig &&
    !arraysEqual(bundle.rawAutomationConfig.skip_rules ?? [], bundle.skipRules)
  ) {
    issues.push('automation-config.json skip_rules are out of sync with rules/skip-rules.json.');
  }
  if (
    bundle.rawAutomationConfig &&
    !arraysEqual(
      bundle.rawAutomationConfig.escalation_rules?.patterns ?? [],
      bundle.escalationPatterns,
    )
  ) {
    issues.push(
      'automation-config.json escalation_rules.patterns are out of sync with rules/escalation-patterns.json.',
    );
  }

  const rawBinding = findPrimaryWorkflowBinding(bundle.rawManifest?.workflow_bindings);
  if (rawBinding && !arraysEqual(rawBinding.deterministic_config, bundle.automationConfig)) {
    issues.push(
      'manifest.json workflow binding deterministic_config is out of sync with automation-config.json.',
    );
  }

  if (bundle.rawManifest && !arraysEqual(bundle.rawManifest.connectors ?? [], bundle.connectors)) {
    issues.push('manifest.json connectors are out of sync with connectors.json.');
  }

  for (const connector of bundle.connectors) {
    if (connector.direction !== 'inbound' && connector.direction !== 'outbound') {
      issues.push(
        `Connector "${connector.connector_key}" direction must be "inbound" or "outbound".`,
      );
    }
    if (!connector.auth?.secret_ref?.startsWith('env://')) {
      issues.push(`Connector "${connector.connector_key}" auth.secret_ref must use env://VAR.`);
    }
  }

  if (bundle.sourceFiles.connectorsRoot && bundle.sourceFiles.connectorsLegacy) {
    const legacyConnectors = readJsonFile<ConnectorSpec[]>(bundle.paths.legacyConnectors);
    const rootConnectors = readJsonFile<ConnectorSpec[]>(bundle.paths.connectors);
    if (!arraysEqual(rootConnectors, legacyConnectors)) {
      issues.push('connectors.json and connectors/connectors.json differ.');
    }
  }

  return issues;
}
