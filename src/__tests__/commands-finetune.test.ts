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
  let cwdSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(async () => {
    vi.resetModules();
    mockPrompt.mockReset();
    const mod = await import('../cli/commands-finetune.js');
    handleFinetuneCommand = mod.handleFinetuneCommand;
  });

  afterEach(() => {
    cwdSpy?.mockRestore();
    cwdSpy = undefined;
  });

  it('exports studio dpo datasets from approved evals', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'response-finetune-export-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
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
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
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
});
