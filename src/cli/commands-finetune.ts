/**
 * /finetune — Fine-tuning pipeline commands.
 * /evals suggest — Eval recommendation with human feedback.
 *
 * Pipeline: collect evals → export training data → create finetune job →
 *           monitor → deploy model to workflow config.
 */

import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import type { ChatContext, CommandResult } from './types.js';
import { getWorkflowEngineConfig } from '../config.js';
import { EngineClient, EngineClientError } from '../lib/engine-client.js';
import { loadBrandStudioBundle, writeBrandStudioBundle } from '../lib/brand-studio.js';
import {
  buildDatasetArtifacts,
  inferFinetuneMethod,
  serializeJsonl,
  splitDatasetEntries,
  validateDatasetText,
  type FinetuneDatasetFormat,
  type FinetuneEvalRecord,
} from '../lib/finetune-datasets.js';
import { runEvalsSuggestFlow } from './shortcuts/evals.js';
import { parseCommandArgs, withAgentRunner } from './shortcuts/utils.js';

const NOT_HANDLED: CommandResult = { handled: false };
const DATASET_FORMATS: FinetuneDatasetFormat[] = [
  'openai-sft',
  'studio-sft',
  'trl-sft',
  'studio-dpo',
  'pair-dpo',
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

interface FinetuneRunner {
  callTool<T = unknown>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ isError?: boolean; payload?: T; rawText?: string }>;
}

function readFirstOption(options: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    const value = options[name];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function parseEvalRecords(payload: unknown): FinetuneEvalRecord[] {
  if (Array.isArray(payload)) {
    return payload as FinetuneEvalRecord[];
  }
  if (typeof payload === 'string') {
    const parsed = JSON.parse(payload);
    return Array.isArray(parsed) ? parsed : (parsed.data ?? parsed.items ?? []);
  }
  if (payload && typeof payload === 'object') {
    const data = payload as { data?: unknown; items?: unknown };
    if (Array.isArray(data.data)) {
      return data.data as FinetuneEvalRecord[];
    }
    if (Array.isArray(data.items)) {
      return data.items as FinetuneEvalRecord[];
    }
  }
  return [];
}

function normalizeValidationRatio(rawValue: string | undefined): number {
  if (!rawValue) {
    return 0;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 1) {
    throw new Error('Validation ratio must be a number between 0 and 1.');
  }
  return parsed;
}

function expandFormatTokens(rawValue: string | undefined): Set<FinetuneDatasetFormat> {
  if (!rawValue || rawValue.trim().length === 0 || rawValue.trim().toLowerCase() === 'all') {
    return new Set(DATASET_FORMATS);
  }

  const selected = new Set<FinetuneDatasetFormat>();
  const tokens = rawValue
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  for (const token of tokens) {
    if (token === 'sft') {
      selected.add('openai-sft');
      selected.add('studio-sft');
      selected.add('trl-sft');
      continue;
    }
    if (token === 'dpo') {
      selected.add('studio-dpo');
      selected.add('pair-dpo');
      continue;
    }
    if (DATASET_FORMATS.includes(token as FinetuneDatasetFormat)) {
      selected.add(token as FinetuneDatasetFormat);
      continue;
    }
    throw new Error(`Unsupported dataset format "${token}".`);
  }

  return selected;
}

function normalizeExpectedFormat(rawValue: string | undefined): FinetuneDatasetFormat | 'auto' {
  if (!rawValue) {
    return 'auto';
  }
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === 'auto') {
    return 'auto';
  }
  if (DATASET_FORMATS.includes(normalized as FinetuneDatasetFormat)) {
    return normalized as FinetuneDatasetFormat;
  }
  throw new Error(`Unsupported dataset format "${rawValue}".`);
}

function collectDatasetFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.(jsonl|json)$/i.test(name))
    .sort()
    .reverse();
}

function writeDatasetFile(
  outDir: string,
  basename: string,
  timestamp: number,
  entries: Record<string, unknown>[],
): string {
  const outFile = path.join(outDir, `${basename}-${timestamp}.jsonl`);
  fs.writeFileSync(outFile, serializeJsonl(entries), 'utf-8');
  return outFile;
}

function printValidationResult(
  targetPath: string,
  format: string,
  summary: ReturnType<typeof validateDatasetText>,
): void {
  const status = summary.invalidCount === 0 ? chalk.green('valid') : chalk.yellow('needs review');
  console.log(chalk.white(`  ${targetPath}`));
  console.log(
    chalk.gray(
      `    format: ${format}  mode: ${summary.mode}  valid: ${summary.validCount}/${summary.totalCount}  status: ${status}`,
    ),
  );
  summary.issues.slice(0, 5).forEach((issue) => {
    const prefix = issue.line ? `line ${issue.line}` : 'issue';
    console.log(chalk.yellow(`    ${prefix}: ${issue.message}`));
  });
  if (summary.issues.length > 5) {
    console.log(chalk.yellow(`    ... ${summary.issues.length - 5} more issue(s)`));
  }
}

function writeJobSpec(spec: Record<string, unknown>): string {
  const dir = path.resolve('.stateset/finetune/jobs');
  ensureDir(dir);
  const filename = `job-${Date.now()}.json`;
  const jobPath = path.join(dir, filename);
  fs.writeFileSync(jobPath, JSON.stringify(spec, null, 2) + '\n', 'utf-8');
  return jobPath;
}

/* ------------------------------------------------------------------ */
/*  /evals suggest — recommend evals based on conversation data        */
/* ------------------------------------------------------------------ */

async function runEvalsSuggest(ctx: ChatContext): Promise<void> {
  await runEvalsSuggestFlow({
    callTool: ctx.agent.callTool.bind(ctx.agent),
  });
}

/* ------------------------------------------------------------------ */
/*  /finetune export — export evals as training data                   */
/* ------------------------------------------------------------------ */

async function runFinetuneExport(
  runner: FinetuneRunner,
  options: Record<string, string>,
  outputPath?: string,
): Promise<void> {
  console.log('');
  console.log(chalk.bold('  Export Training Data'));
  console.log(chalk.gray('  ─'.repeat(24)));

  const statusFilter = readFirstOption(options, ['status']) ?? 'approved';
  let validationRatio = 0;
  let selectedFormats = new Set<FinetuneDatasetFormat>();
  let evalsResult: { payload?: unknown; rawText?: string; isError?: boolean };
  try {
    validationRatio = normalizeValidationRatio(
      readFirstOption(options, ['validation-ratio', 'validation_ratio']),
    );
    selectedFormats = expandFormatTokens(readFirstOption(options, ['format']));
    evalsResult = await runner.callTool('list_evals', { limit: 1000, offset: 0 });
  } catch (err) {
    console.log(chalk.red(`  Could not prepare export: ${err}`));
    return;
  }

  let evals: FinetuneEvalRecord[] = [];
  try {
    evals = parseEvalRecords(evalsResult.payload);
  } catch {
    console.log(chalk.red('  Could not parse eval data.'));
    return;
  }

  const buildResult = buildDatasetArtifacts(evals, { status: statusFilter });
  const artifacts = buildResult.artifacts.filter((artifact) =>
    selectedFormats.has(artifact.format),
  );

  if (buildResult.sftSourceCount === 0) {
    console.log(
      chalk.yellow(`  No ${statusFilter} evals with both user_message and preferred_output found.`),
    );
    printInfo('Use /evals create-from-response or /evals review to curate training examples.');
    return;
  }

  const outDir = path.resolve(outputPath ?? '.stateset/finetune');
  ensureDir(outDir);
  const timestamp = Date.now();

  console.log(chalk.gray(`  Total evals: ${buildResult.totalCount}`));
  console.log(chalk.gray(`  SFT-ready evals (${statusFilter}): ${buildResult.sftSourceCount}`));
  console.log(chalk.gray(`  DPO-ready evals (${statusFilter}): ${buildResult.dpoSourceCount}`));

  let writtenFiles = 0;
  for (const artifact of artifacts) {
    if (artifact.entries.length === 0) {
      printInfo(`Skipping ${artifact.basename}; no matching examples.`);
      continue;
    }

    if (validationRatio > 0 && artifact.entries.length > 1) {
      const split = splitDatasetEntries(artifact.entries, validationRatio);
      if (split.train.length > 0) {
        const trainPath = writeDatasetFile(
          outDir,
          `${artifact.basename}-train`,
          timestamp,
          split.train,
        );
        printSuccess(`Exported ${split.train.length} ${artifact.format} train rows → ${trainPath}`);
        writtenFiles += 1;
      }
      if (split.validation.length > 0) {
        const validationPath = writeDatasetFile(
          outDir,
          `${artifact.basename}-val`,
          timestamp,
          split.validation,
        );
        printSuccess(
          `Exported ${split.validation.length} ${artifact.format} validation rows → ${validationPath}`,
        );
        writtenFiles += 1;
      }
      continue;
    }

    const outFile = writeDatasetFile(outDir, artifact.basename, timestamp, artifact.entries);
    printSuccess(`Exported ${artifact.entries.length} ${artifact.format} rows → ${outFile}`);
    writtenFiles += 1;
  }

  if (writtenFiles === 0) {
    console.log(chalk.yellow('  No dataset files were written.'));
    return;
  }

  console.log('');
  printInfo('Next: run /finetune validate to verify the exported datasets.');
  if (buildResult.dpoSourceCount === 0) {
    printInfo(
      'Tip: use /evals create-from-response <response-id> --seed rejected to build DPO pairs.',
    );
  }
  console.log('');
}

/* ------------------------------------------------------------------ */
/*  /finetune create — start a fine-tuning job                         */
/* ------------------------------------------------------------------ */

async function runFinetuneValidate(
  targetPath?: string,
  options: Record<string, string> = {},
): Promise<void> {
  console.log('');
  console.log(chalk.bold('  Validate Training Data'));
  console.log(chalk.gray('  ─'.repeat(24)));

  let expectedFormat: FinetuneDatasetFormat | 'auto';
  try {
    expectedFormat = normalizeExpectedFormat(readFirstOption(options, ['format']));
  } catch (error) {
    console.log(chalk.red(`  ${error instanceof Error ? error.message : String(error)}`));
    return;
  }
  const resolvedPath = path.resolve(targetPath ?? '.stateset/finetune');

  if (!fs.existsSync(resolvedPath)) {
    console.log(chalk.yellow(`  Path not found: ${resolvedPath}`));
    return;
  }

  const files = fs.statSync(resolvedPath).isDirectory()
    ? collectDatasetFiles(resolvedPath).map((name) => path.join(resolvedPath, name))
    : [resolvedPath];

  if (files.length === 0) {
    console.log(chalk.yellow('  No dataset files found.'));
    return;
  }

  let invalidFiles = 0;
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf-8');
    const result = validateDatasetText(raw, expectedFormat);
    if (result.invalidCount > 0 || result.validCount === 0) {
      invalidFiles += 1;
    }
    printValidationResult(
      file,
      expectedFormat === 'auto' ? result.detectedFormat : expectedFormat,
      result,
    );
  }

  console.log('');
  if (invalidFiles === 0) {
    printSuccess(`Validated ${files.length} dataset file(s).`);
  } else {
    console.log(chalk.yellow(`  ${invalidFiles} file(s) need review before training.`));
  }
  console.log('');
}

async function runFinetuneCreate(
  datasetPath?: string,
  options: Record<string, string> = {},
): Promise<void> {
  console.log('');
  console.log(chalk.bold('  Create Fine-tuning Job'));
  console.log(chalk.gray('  ─'.repeat(24)));

  const finetuneDir = path.resolve('.stateset/finetune');
  if (!fs.existsSync(finetuneDir)) {
    console.log(chalk.yellow('  No training data found. Run /finetune export first.'));
    return;
  }

  const files = collectDatasetFiles(finetuneDir);

  if (files.length === 0) {
    console.log(chalk.yellow('  No training data files found.'));
    return;
  }

  let trainingPath = datasetPath ? path.resolve(datasetPath) : '';
  if (!trainingPath) {
    const selection = await inquirer.prompt([
      {
        type: 'list',
        name: 'trainingFile',
        message: 'Select training data:',
        choices: files.map((file) => ({
          name: `${file} (${fs.statSync(path.join(finetuneDir, file)).size} bytes)`,
          value: path.join(finetuneDir, file),
        })),
      },
    ]);
    trainingPath = String(selection.trainingFile);
  }

  if (!fs.existsSync(trainingPath)) {
    console.log(chalk.yellow(`  Training file not found: ${trainingPath}`));
    return;
  }

  const validation = validateDatasetText(fs.readFileSync(trainingPath, 'utf-8'), 'auto');
  if (validation.validCount === 0 || validation.invalidCount > 0) {
    console.log(chalk.yellow('  Selected dataset is not ready for training.'));
    printValidationResult(trainingPath, validation.detectedFormat, validation);
    return;
  }

  const inferredMethod = inferFinetuneMethod(validation.detectedFormat);
  if (!inferredMethod) {
    console.log(chalk.yellow('  Could not infer fine-tuning method from the dataset format.'));
    return;
  }

  const defaultMethod = readFirstOption(options, ['method']) ?? inferredMethod;
  if (defaultMethod !== inferredMethod) {
    console.log(
      chalk.yellow(
        `  Ignoring unsupported method "${defaultMethod}" for ${validation.detectedFormat}; using ${inferredMethod}.`,
      ),
    );
  }
  const { method, baseModel, suffix } = await inquirer.prompt([
    {
      type: 'list',
      name: 'method',
      message: 'Training method:',
      default: inferredMethod,
      choices:
        inferredMethod === 'dpo'
          ? [{ name: 'Direct Preference Optimization (DPO)', value: 'dpo' }]
          : [{ name: 'Supervised fine-tuning', value: 'supervised' }],
    },
    {
      type: 'list',
      name: 'baseModel',
      message: 'Base model:',
      choices: [
        { name: 'GPT-4.1 (recommended for quality)', value: 'gpt-4.1' },
        { name: 'GPT-4.1 Mini (faster, cheaper)', value: 'gpt-4.1-mini' },
        { name: 'GPT-4o Mini', value: 'gpt-4o-mini-2024-07-18' },
      ],
    },
    {
      type: 'input',
      name: 'suffix',
      message: 'Model name suffix:',
      default: 'stateset-support',
    },
  ]);

  console.log('');
  console.log(chalk.gray(`  Training file: ${trainingPath}`));
  console.log(chalk.gray(`  Format: ${validation.detectedFormat}`));
  console.log(chalk.gray(`  Examples: ${validation.validCount}`));
  console.log(chalk.gray(`  Method: ${method}`));
  console.log(chalk.gray(`  Base model: ${baseModel}`));
  console.log(chalk.gray(`  Suffix: ${suffix}`));

  if (validation.validCount < 10) {
    console.log(chalk.yellow('  Warning: fewer than 10 examples. Quality may be low.'));
  }

  const { proceed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'proceed',
      message: 'Create fine-tuning job?',
      default: true,
    },
  ]);

  if (!proceed) {
    printInfo('Cancelled.');
    return;
  }

  const jobSpec = {
    training_file: trainingPath,
    dataset_format: validation.detectedFormat,
    method,
    base_model: baseModel,
    suffix,
    examples: validation.validCount,
    created_at: new Date().toISOString(),
    status: 'pending_upload',
  };
  const jobPath = writeJobSpec(jobSpec);

  printSuccess('Fine-tune job spec created');
  console.log(chalk.gray(`  Job spec: ${jobPath}`));
  console.log('');
  printInfo('Synthetic Data Studio create-job payload:');
  console.log(
    chalk.gray(
      `  {"training_file":"<uploaded-file-id>","model":"${baseModel}","method":"${method}","suffix":"${suffix}"}`,
    ),
  );
  console.log('');
  if (validation.detectedFormat === 'openai-sft') {
    printInfo(
      'This dataset is also compatible with chat-format OpenAI supervised fine-tuning uploads.',
    );
  } else {
    printInfo(
      'Use the dataset format and method recorded in the job spec when you upload to your trainer.',
    );
  }
  printInfo('Once complete, run /finetune deploy <model-id> to update your workflow config.');
  console.log('');
}

/* ------------------------------------------------------------------ */
/*  /finetune deploy — deploy fine-tuned model to workflow config      */
/* ------------------------------------------------------------------ */

async function runFinetuneDeploy(modelId?: string): Promise<void> {
  console.log('');
  console.log(chalk.bold('  Deploy Fine-tuned Model'));
  console.log(chalk.gray('  ─'.repeat(24)));

  if (!modelId) {
    const { model } = await inquirer.prompt([
      {
        type: 'input',
        name: 'model',
        message: 'Fine-tuned model ID (e.g. ft:gpt-4.1:stateset:...):',
        validate: (v: string) => (v.trim().length > 0 ? true : 'Required'),
      },
    ]);
    modelId = model;
  }

  // Find brand configs in .stateset/
  const statesetBase = path.resolve('.stateset');
  if (!fs.existsSync(statesetBase)) {
    console.log(chalk.yellow('  No .stateset/ directory found.'));
    return;
  }

  const brands = fs
    .readdirSync(statesetBase, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .filter((d) => fs.existsSync(path.join(statesetBase, d.name, 'automation-config.json')))
    .map((d) => d.name);

  if (brands.length === 0) {
    console.log(chalk.yellow('  No brand configs found in .stateset/'));
    return;
  }

  const { brand } = await inquirer.prompt([
    {
      type: 'list',
      name: 'brand',
      message: 'Deploy to brand:',
      choices: brands,
    },
  ]);

  const targetModel = modelId;
  if (!targetModel) {
    console.log(chalk.red('  Fine-tuned model ID is required.'));
    return;
  }

  const bundle = loadBrandStudioBundle(brand, process.cwd());
  const oldModel = bundle.automationConfig.model;
  bundle.automationConfig.model = targetModel;
  bundle.automationConfig.provider = 'openai'; // Fine-tuned models are OpenAI
  writeBrandStudioBundle(bundle);

  printSuccess(`Updated ${brand}/automation-config.json`);
  console.log(chalk.gray(`  Model: ${oldModel} → ${targetModel}`));

  // Optionally push to engine
  const engineConfig = getWorkflowEngineConfig();
  if (engineConfig) {
    const { push } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'push',
        message: 'Push updated config to workflow engine?',
        default: true,
      },
    ]);

    if (push) {
      try {
        const client = new EngineClient(engineConfig);
        const brands = (await client.listBrands({ slug: brand })) as {
          items?: Array<Record<string, unknown>>;
        };
        const items = brands?.items ?? (Array.isArray(brands) ? brands : []);
        const found = items[0];
        if (found) {
          await client.updateBrand(String(found.id), {
            workflow_bindings: bundle.manifest.workflow_bindings,
          });
          printSuccess('Pushed to workflow engine');
        } else {
          console.log(chalk.yellow(`  Brand "${brand}" not found in engine.`));
        }
      } catch (err) {
        const msg = err instanceof EngineClientError ? err.message : String(err);
        console.log(chalk.yellow(`  Push failed: ${msg}`));
      }
    }
  }

  console.log('');
  printInfo('Commit the config change to version control.');
  console.log('');
}

/* ------------------------------------------------------------------ */
/*  /finetune list — show finetune job history                         */
/* ------------------------------------------------------------------ */

function runFinetuneList(): void {
  console.log('');
  console.log(chalk.bold('  Fine-tune Jobs'));
  console.log(chalk.gray('  ─'.repeat(24)));

  const jobsDir = path.resolve('.stateset/finetune/jobs');
  if (!fs.existsSync(jobsDir)) {
    printInfo('No fine-tune jobs found. Run /finetune create first.');
    return;
  }

  const files = fs
    .readdirSync(jobsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();
  if (files.length === 0) {
    printInfo('No fine-tune jobs found.');
    return;
  }

  for (const f of files) {
    try {
      const job = JSON.parse(fs.readFileSync(path.join(jobsDir, f), 'utf-8'));
      console.log(chalk.white(`  ${f}`));
      console.log(
        chalk.gray(
          `    Model: ${job.base_model}  Suffix: ${job.suffix}  Examples: ${job.examples}`,
        ),
      );
      console.log(chalk.gray(`    Status: ${job.status}  Created: ${job.created_at}`));
      console.log('');
    } catch {
      // Skip malformed job files
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Shared print helpers                                               */
/* ------------------------------------------------------------------ */

function printSuccess(msg: string): void {
  console.log(chalk.green(`  ✓ ${msg}`));
}

function printInfo(msg: string): void {
  console.log(chalk.gray(`  ${msg}`));
}

async function handleParsedFinetuneCommand(parts: string[], runner: FinetuneRunner): Promise<void> {
  const parsed = parseCommandArgs(parts);
  const subcommand = parsed.positionals[0]?.toLowerCase() ?? '';

  switch (subcommand) {
    case '':
    case 'list':
      runFinetuneList();
      return;

    case 'export':
      await runFinetuneExport(runner, parsed.options, parsed.positionals[1]);
      return;

    case 'validate':
      await runFinetuneValidate(parsed.positionals[1], parsed.options);
      return;

    case 'create':
      await runFinetuneCreate(parsed.positionals[1], parsed.options);
      return;

    case 'deploy':
      await runFinetuneDeploy(parsed.positionals[1]);
      return;

    default:
      console.log(chalk.gray('  Usage: /finetune [list|export|validate|create|deploy <model-id>]'));
  }
}

/* ------------------------------------------------------------------ */
/*  Exported handlers                                                  */
/* ------------------------------------------------------------------ */

export async function handleFinetuneCommand(
  input: string,
  ctx: ChatContext,
): Promise<CommandResult> {
  const trimmed = input.trim().toLowerCase();

  if (!trimmed.startsWith('/finetune')) {
    return NOT_HANDLED;
  }

  const parts = input.trim().split(/\s+/).slice(1);
  await handleParsedFinetuneCommand(parts, {
    callTool: ctx.agent.callTool.bind(ctx.agent),
  });
  return { handled: true };
}

export async function handleEvalsSuggestCommand(
  input: string,
  ctx: ChatContext,
): Promise<CommandResult> {
  const trimmed = input.trim().toLowerCase();

  if (trimmed === '/evals suggest' || trimmed === '/evals-suggest') {
    await runEvalsSuggest(ctx);
    return { handled: true };
  }

  return NOT_HANDLED;
}

export async function runTopLevelFinetune(args: string[] = []): Promise<void> {
  await withAgentRunner(async (runner) => {
    await handleParsedFinetuneCommand(args, runner);
  });
}
