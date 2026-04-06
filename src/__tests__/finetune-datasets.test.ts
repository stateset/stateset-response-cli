import { describe, expect, it } from 'vitest';
import {
  buildDatasetArtifacts,
  splitDatasetEntries,
  validateDatasetText,
} from '../lib/finetune-datasets.js';

describe('finetune datasets', () => {
  const records = [
    {
      id: 'eval-1',
      eval_name: 'Accuracy',
      eval_type: 'quality',
      eval_status: 'approved',
      user_message: 'Where is my order?',
      preferred_output: 'Your order is in transit.',
      non_preferred_output: 'Please contact support.',
    },
    {
      id: 'eval-2',
      eval_name: 'Tone',
      eval_type: 'quality',
      eval_status: 'pending',
      user_message: 'Can I return this?',
      preferred_output: 'Yes, you can start a return in the portal.',
    },
  ];

  it('builds the studio and OpenAI dataset variants from approved evals', () => {
    const result = buildDatasetArtifacts(records, { status: 'approved' });

    expect(result.totalCount).toBe(2);
    expect(result.sftSourceCount).toBe(1);
    expect(result.dpoSourceCount).toBe(1);
    expect(result.statusCounts.approved).toBe(1);
    expect(result.statusCounts.pending).toBe(1);

    const openAi = result.artifacts.find((artifact) => artifact.format === 'openai-sft');
    const studioDpo = result.artifacts.find((artifact) => artifact.format === 'studio-dpo');

    expect(openAi?.entries).toHaveLength(1);
    expect(openAi?.entries[0]).toEqual({
      messages: [
        {
          role: 'system',
          content:
            'You are a helpful customer service AI assistant. This is a quality conversation.',
        },
        { role: 'user', content: 'Where is my order?' },
        { role: 'assistant', content: 'Your order is in transit.' },
      ],
    });

    expect(studioDpo?.entries[0]).toEqual({
      input: {
        messages: [{ role: 'user', content: 'Where is my order?' }],
        tools: [],
        parallel_tool_calls: true,
      },
      preferred_output: [{ role: 'assistant', content: 'Your order is in transit.' }],
      non_preferred_output: [{ role: 'assistant', content: 'Please contact support.' }],
    });
  });

  it('validates structured DPO jsonl', () => {
    const payload = [
      JSON.stringify({
        input: {
          messages: [{ role: 'user', content: 'Help me with my order.' }],
          tools: [],
          parallel_tool_calls: true,
        },
        preferred_output: [{ role: 'assistant', content: 'I can help with that.' }],
        non_preferred_output: [{ role: 'assistant', content: 'No idea.' }],
      }),
    ].join('\n');

    const result = validateDatasetText(payload, 'auto');

    expect(result.detectedFormat).toBe('studio-dpo');
    expect(result.validCount).toBe(1);
    expect(result.invalidCount).toBe(0);
  });

  it('flags malformed datasets', () => {
    const result = validateDatasetText('{"messages":[{"role":"user"}]}\n', 'openai-sft');

    expect(result.validCount).toBe(0);
    expect(result.invalidCount).toBe(1);
    expect(result.issues[0]?.message).toContain('content');
  });

  it('creates deterministic train and validation splits', () => {
    const entries = [
      { prompt: 'a', chosen: 'A', rejected: 'B' },
      { prompt: 'b', chosen: 'B', rejected: 'C' },
      { prompt: 'c', chosen: 'C', rejected: 'D' },
      { prompt: 'd', chosen: 'D', rejected: 'E' },
    ];

    const first = splitDatasetEntries(entries, 0.5);
    const second = splitDatasetEntries(entries, 0.5);

    expect(first).toEqual(second);
    expect(first.train.length + first.validation.length).toBe(entries.length);
  });
});
