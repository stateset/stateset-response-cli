import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatContext } from '../cli/types.js';

const { mockPrompt } = vi.hoisted(() => ({
  mockPrompt: vi.fn(),
}));

vi.mock('inquirer', () => ({
  default: { prompt: mockPrompt },
  prompt: mockPrompt,
}));

function createCtx(payload: unknown): ChatContext {
  return {
    agent: {
      callTool: vi.fn(async () => ({ payload })),
    },
  } as unknown as ChatContext;
}

describe('handleFinetuneCommand', () => {
  let handleFinetuneCommand: typeof import('../cli/commands-finetune.js').handleFinetuneCommand;

  beforeEach(async () => {
    vi.resetModules();
    mockPrompt.mockReset();
    const mod = await import('../cli/commands-finetune.js');
    handleFinetuneCommand = mod.handleFinetuneCommand;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports studio dpo datasets from approved evals', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'response-finetune-export-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    const ctx = createCtx([
      {
        id: 'eval-1',
        eval_status: 'approved',
        user_message: 'Where is my order?',
        preferred_output: 'Your order is in transit.',
        non_preferred_output: 'Please contact support.',
      },
    ]);

    const result = await handleFinetuneCommand(
      '/finetune export --format studio-dpo --status approved',
      ctx,
    );

    expect(result).toEqual({ handled: true });
    const outDir = path.join(tempDir, '.stateset', 'finetune');
    const files = fs.readdirSync(outDir);
    expect(files.some((file) => file.startsWith('dpo-studio-'))).toBe(true);
    expect(files.some((file) => file.startsWith('sft-openai-'))).toBe(false);
  });

  it('creates a job spec from a validated dataset', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'response-finetune-create-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    const finetuneDir = path.join(tempDir, '.stateset', 'finetune');
    fs.mkdirSync(finetuneDir, { recursive: true });
    const datasetPath = path.join(finetuneDir, 'sft-openai-sample.jsonl');
    fs.writeFileSync(
      datasetPath,
      `${JSON.stringify({
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello' },
        ],
      })}\n`,
      'utf-8',
    );

    mockPrompt
      .mockResolvedValueOnce({
        method: 'supervised',
        baseModel: 'gpt-4.1',
        suffix: 'stateset-test',
      })
      .mockResolvedValueOnce({ proceed: true });

    const result = await handleFinetuneCommand(`/finetune create ${datasetPath}`, createCtx([]));

    expect(result).toEqual({ handled: true });
    const jobsDir = path.join(finetuneDir, 'jobs');
    const jobs = fs.readdirSync(jobsDir);
    expect(jobs).toHaveLength(1);
    const jobSpec = JSON.parse(fs.readFileSync(path.join(jobsDir, jobs[0]), 'utf-8'));
    expect(jobSpec.training_file).toBe(datasetPath);
    expect(jobSpec.dataset_format).toBe('openai-sft');
    expect(jobSpec.method).toBe('supervised');
    expect(jobSpec.base_model).toBe('gpt-4.1');
  });

  it('refuses symlinked training datasets without creating a job spec', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'response-finetune-symlink-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    const finetuneDir = path.join(tempDir, '.stateset', 'finetune');
    fs.mkdirSync(finetuneDir, { recursive: true });
    const realDatasetPath = path.join(tempDir, 'real-dataset.jsonl');
    fs.writeFileSync(
      realDatasetPath,
      `${JSON.stringify({
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello' },
        ],
      })}\n`,
      'utf-8',
    );
    const linkedDatasetPath = path.join(finetuneDir, 'linked-dataset.jsonl');
    fs.symlinkSync(realDatasetPath, linkedDatasetPath);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await handleFinetuneCommand(
      `/finetune create ${linkedDatasetPath}`,
      createCtx([]),
    );

    expect(result).toEqual({ handled: true });
    expect(fs.existsSync(path.join(finetuneDir, 'jobs'))).toBe(false);
    expect(logSpy.mock.calls.flat().join('\n')).toContain('not a safe regular file');
  });
});
