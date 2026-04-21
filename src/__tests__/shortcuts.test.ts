import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { ShortcutRunner, ShortcutLogger } from '../cli/shortcuts/types.js';

const { mockPrompt } = vi.hoisted(() => ({
  mockPrompt: vi.fn(),
}));

vi.mock('inquirer', () => ({
  default: { prompt: mockPrompt },
  prompt: mockPrompt,
}));

// ---- Helpers ----------------------------------------------------------------

function createMockRunner(response: unknown = {}): ShortcutRunner {
  return {
    callTool: vi.fn().mockResolvedValue({
      payload: response,
    }),
  };
}

function createMockLogger(): ShortcutLogger & {
  success: ReturnType<typeof vi.fn>;
  warning: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  output: ReturnType<typeof vi.fn>;
  done: ReturnType<typeof vi.fn>;
} {
  return {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    output: vi.fn(),
    done: vi.fn(),
  };
}

function createProjectTempDir(prefix = 'tmp-shortcuts-export-'): string {
  return fs.mkdtempSync(path.join(process.cwd(), prefix));
}

// ---- Agents -----------------------------------------------------------------

describe('runAgentsCommand', () => {
  let runAgentsCommand: typeof import('../cli/shortcuts/agents.js').runAgentsCommand;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../cli/shortcuts/agents.js');
    runAgentsCommand = mod.runAgentsCommand;
  });

  it('lists agents by default', async () => {
    const agents = [{ id: '1', agent_name: 'Bot' }];
    const runner = createMockRunner(agents);
    const logger = createMockLogger();

    await runAgentsCommand([], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith(
      'list_agents',
      expect.objectContaining({ limit: expect.any(Number) }),
    );
    expect(logger.success).toHaveBeenCalled();
  });

  it('lists agents when "list" is passed', async () => {
    const runner = createMockRunner([]);
    const logger = createMockLogger();

    await runAgentsCommand(['list'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('list_agents', expect.any(Object));
  });

  it('creates agent with name and type', async () => {
    const runner = createMockRunner({ id: 'new-1', agent_name: 'TestBot' });
    const logger = createMockLogger();

    await runAgentsCommand(['create', '--name', 'TestBot', '--type', 'support'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith(
      'create_agent',
      expect.objectContaining({ agent_name: 'TestBot', agent_type: 'support' }),
    );
    expect(logger.success).toHaveBeenCalled();
  });

  it('warns on missing create args', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runAgentsCommand(['create'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(
      'Usage: /agents create --name <name> --type <type>',
    );
    expect(runner.callTool).not.toHaveBeenCalled();
  });

  it('gets agent by id', async () => {
    const runner = createMockRunner({ id: 'a1', agent_name: 'Bot' });
    const logger = createMockLogger();

    await runAgentsCommand(['get', 'a1'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('get_agent', { agent_id: 'a1' });
  });

  it('exports agent to output file', async () => {
    const payload = { id: 'a1', agent_name: 'Bot' };
    const runner = createMockRunner(payload);
    const logger = createMockLogger();
    const dir = createProjectTempDir();
    const outputPath = path.join(dir, 'agent-export.json');

    try {
      await runAgentsCommand(['export', 'a1', outputPath], runner, logger);
      expect(runner.callTool).toHaveBeenCalledWith('export_agent', { agent_id: 'a1' });
      expect(fs.existsSync(outputPath)).toBe(true);
      expect(JSON.parse(fs.readFileSync(outputPath, 'utf-8'))).toEqual(payload);
      expect(logger.success).toHaveBeenCalledWith(expect.stringContaining(outputPath));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('warns on missing get agent id', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runAgentsCommand(['get'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith('Usage: /agents get <agent-id>');
  });

  it('switches agent by id', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runAgentsCommand(['switch', 'agent-99'], runner, logger);

    expect(process.env.STATESET_ACTIVE_AGENT_ID).toBe('agent-99');
    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('agent-99'));
    delete process.env.STATESET_ACTIVE_AGENT_ID;
  });

  it('warns on missing switch agent id', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runAgentsCommand(['switch'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith('Usage: /agents switch <agent-id>');
  });

  it('warns on missing bootstrap agent id', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runAgentsCommand(['bootstrap'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith('Usage: /agents bootstrap <agent-id>');
  });

  it('treats unknown action as agent ID lookup', async () => {
    const runner = createMockRunner({ id: 'uuid-123' });
    const logger = createMockLogger();

    await runAgentsCommand(['uuid-123'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('get_agent', { agent_id: 'uuid-123' });
  });

  it('outputs JSON when json flag is set', async () => {
    const agents = [{ id: '1' }];
    const runner = createMockRunner(agents);
    const logger = createMockLogger();

    await runAgentsCommand([], runner, logger, true);

    expect(logger.output).toHaveBeenCalledWith(expect.stringContaining('"id"'));
  });
});

// ---- Channels ---------------------------------------------------------------

describe('runEvalsCommand', () => {
  let runEvalsCommand: typeof import('../cli/shortcuts/evals.js').runEvalsCommand;

  beforeEach(async () => {
    vi.resetModules();
    mockPrompt.mockReset();
    const mod = await import('../cli/shortcuts/evals.js');
    runEvalsCommand = mod.runEvalsCommand;
  });

  it('lists evals by default', async () => {
    const runner = createMockRunner([{ id: 'e1', eval_name: 'Accuracy' }]);
    const logger = createMockLogger();

    await runEvalsCommand([], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith(
      'list_evals',
      expect.objectContaining({ limit: expect.any(Number), offset: 0 }),
    );
    expect(logger.success).toHaveBeenCalled();
  });

  it('creates evals with required fields', async () => {
    const runner = createMockRunner({ id: 'e1', eval_name: 'Accuracy' });
    const logger = createMockLogger();

    await runEvalsCommand(
      [
        'create',
        '--name',
        'Accuracy',
        '--type',
        'quality',
        '--message',
        'Where is my order?',
        '--preferred',
        'Your order is in transit.',
      ],
      runner,
      logger,
    );

    expect(runner.callTool).toHaveBeenCalledWith(
      'create_eval',
      expect.objectContaining({
        eval_name: 'Accuracy',
        eval_type: 'quality',
        user_message: 'Where is my order?',
        preferred_output: 'Your order is in transit.',
      }),
    );
  });

  it('updates evals', async () => {
    const runner = createMockRunner({ id: 'e1', eval_status: 'approved' });
    const logger = createMockLogger();

    await runEvalsCommand(['update', 'e1', '--status', 'approved'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith(
      'update_eval',
      expect.objectContaining({ id: 'e1', eval_status: 'approved' }),
    );
  });

  it('creates an eval from a stored response', async () => {
    const runner: ShortcutRunner = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({
          payload: {
            id: 'resp-1',
            customer_message: 'Where is my order?',
            agent_response: 'Please contact support.',
            channel: 'email',
            ticket_id: 'ticket-1',
          },
        })
        .mockResolvedValueOnce({
          payload: { id: 'eval-1' },
        }),
    };
    const logger = createMockLogger();

    await runEvalsCommand(['create-from-response', 'resp-1', '--seed', 'rejected'], runner, logger);

    expect(runner.callTool).toHaveBeenNthCalledWith(1, 'get_response', { id: 'resp-1' });
    expect(runner.callTool).toHaveBeenNthCalledWith(
      2,
      'create_eval',
      expect.objectContaining({
        response_id: 'resp-1',
        ticket_id: 'ticket-1',
        user_message: 'Where is my order?',
        non_preferred_output: 'Please contact support.',
        eval_status: 'pending',
      }),
    );
  });

  it('exports evals to a file', async () => {
    const runner = createMockRunner([{ messages: [{ role: 'user', content: 'Hi' }] }]);
    const logger = createMockLogger();
    const dir = createProjectTempDir('tmp-evals-export-');
    const outputPath = path.join(dir, 'evals-export.json');

    try {
      await runEvalsCommand(['export', '--out', outputPath, 'e1'], runner, logger);

      expect(runner.callTool).toHaveBeenCalledWith('export_evals_for_finetuning', {
        eval_ids: ['e1'],
      });
      expect(fs.existsSync(outputPath)).toBe(true);
      expect(logger.success).toHaveBeenCalledWith(expect.stringContaining(outputPath));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('filters listed evals by status', async () => {
    const runner = createMockRunner([
      { id: 'e1', eval_status: 'pending' },
      { id: 'e2', eval_status: 'approved' },
    ]);
    const logger = createMockLogger();

    await runEvalsCommand(['list', '--status', 'pending'], runner, logger, true);

    expect(logger.output).toHaveBeenCalledWith(expect.stringContaining('"e1"'));
    expect(logger.output).not.toHaveBeenCalledWith(expect.stringContaining('"e2"'));
  });

  it('reviews and approves a pending eval', async () => {
    const runner = createMockRunner([
      {
        id: 'e1',
        eval_name: 'Accuracy',
        eval_type: 'quality',
        eval_status: 'pending',
        user_message: 'Where is my order?',
        preferred_output: '',
      },
    ]);
    const logger = createMockLogger();
    vi.mocked(runner.callTool)
      .mockResolvedValueOnce({ payload: [{ id: 'e1', eval_status: 'pending' }] } as any)
      .mockResolvedValueOnce({ payload: { id: 'e1', eval_status: 'approved' } } as any);
    mockPrompt
      .mockResolvedValueOnce({ action: 'approve' })
      .mockResolvedValueOnce({ preferredOutput: 'Your order is in transit.' });

    await runEvalsCommand(['review'], runner, logger);

    expect(runner.callTool).toHaveBeenNthCalledWith(1, 'list_evals', { limit: 1000, offset: 0 });
    expect(runner.callTool).toHaveBeenNthCalledWith(
      2,
      'update_eval',
      expect.objectContaining({
        id: 'e1',
        eval_status: 'approved',
        preferred_output: 'Your order is in transit.',
      }),
    );
    expect(logger.success).toHaveBeenCalledWith('Approved eval e1');
  });
});

describe('runDatasetsCommand', () => {
  let runDatasetsCommand: typeof import('../cli/shortcuts/datasets.js').runDatasetsCommand;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../cli/shortcuts/datasets.js');
    runDatasetsCommand = mod.runDatasetsCommand;
  });

  it('lists datasets by default', async () => {
    const runner = createMockRunner([{ id: 'd1', name: 'Returns' }]);
    const logger = createMockLogger();

    await runDatasetsCommand([], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith(
      'list_datasets',
      expect.objectContaining({ limit: expect.any(Number), offset: 0 }),
    );
    expect(logger.success).toHaveBeenCalled();
  });

  it('creates datasets with metadata', async () => {
    const runner = createMockRunner({ id: 'd1', name: 'Returns' });
    const logger = createMockLogger();

    await runDatasetsCommand(
      [
        'create',
        '--name',
        'Returns',
        '--description',
        'Return and exchange examples',
        '--status',
        'active',
        '--metadata',
        '{"channel":"email"}',
      ],
      runner,
      logger,
    );

    expect(runner.callTool).toHaveBeenCalledWith(
      'create_dataset',
      expect.objectContaining({
        name: 'Returns',
        description: 'Return and exchange examples',
        status: 'active',
        metadata: { channel: 'email' },
      }),
    );
  });

  it('adds dataset entries from inline messages', async () => {
    const runner = createMockRunner({ id: 1, dataset_id: 'dataset-1' });
    const logger = createMockLogger();

    await runDatasetsCommand(
      [
        'add-entry',
        'dataset-1',
        '--messages',
        '[{"role":"user","content":"Where is my order?"},{"role":"assistant","content":"It is in transit."}]',
      ],
      runner,
      logger,
    );

    expect(runner.callTool).toHaveBeenCalledWith(
      'add_dataset_entry',
      expect.objectContaining({
        dataset_id: 'dataset-1',
        messages: [
          { role: 'user', content: 'Where is my order?' },
          { role: 'assistant', content: 'It is in transit.' },
        ],
      }),
    );
  });

  it('imports dataset entries from a jsonl file', async () => {
    const runner = createMockRunner({ imported: 2 });
    const logger = createMockLogger();
    const dir = createProjectTempDir('tmp-datasets-import-');
    const importPath = path.join(dir, 'dataset.jsonl');
    fs.writeFileSync(
      importPath,
      [
        '{"messages":[{"role":"user","content":"Where is my order?"},{"role":"assistant","content":"It is in transit."}]}',
        '{"messages":[{"role":"user","content":"I want to cancel"},{"role":"assistant","content":"I can help with that."}]}',
      ].join('\n'),
      'utf-8',
    );

    try {
      await runDatasetsCommand(['import', 'dataset-1', importPath], runner, logger);

      expect(runner.callTool).toHaveBeenCalledWith(
        'import_dataset_entries',
        expect.objectContaining({
          dataset_id: 'dataset-1',
          entries: expect.arrayContaining([
            expect.objectContaining({
              messages: expect.arrayContaining([
                expect.objectContaining({ role: 'user', content: 'Where is my order?' }),
              ]),
            }),
          ]),
        }),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects symlinked dataset entry files', async () => {
    const runner = createMockRunner({ id: 1, dataset_id: 'dataset-1' });
    const logger = createMockLogger();
    const dir = createProjectTempDir('tmp-datasets-entry-link-');
    const realPath = path.join(dir, 'messages.json');
    const linkedPath = path.join(dir, 'messages-link.json');
    fs.writeFileSync(
      realPath,
      JSON.stringify({
        messages: [
          { role: 'user', content: 'Where is my order?' },
          { role: 'assistant', content: 'It is in transit.' },
        ],
      }),
      'utf-8',
    );
    fs.symlinkSync(realPath, linkedPath);

    try {
      await runDatasetsCommand(['add-entry', 'dataset-1', '--file', linkedPath], runner, logger);

      expect(runner.callTool).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('safe regular file'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects symlinked dataset import files', async () => {
    const runner = createMockRunner({ imported: 2 });
    const logger = createMockLogger();
    const dir = createProjectTempDir('tmp-datasets-import-link-');
    const realPath = path.join(dir, 'dataset.jsonl');
    const linkedPath = path.join(dir, 'dataset-link.jsonl');
    fs.writeFileSync(
      realPath,
      [
        '{"messages":[{"role":"user","content":"Where is my order?"},{"role":"assistant","content":"It is in transit."}]}',
      ].join('\n'),
      'utf-8',
    );
    fs.symlinkSync(realPath, linkedPath);

    try {
      await runDatasetsCommand(['import', 'dataset-1', linkedPath], runner, logger);

      expect(runner.callTool).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('safe regular file'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exports datasets to a file', async () => {
    const payload = {
      dataset: { id: 'd1', name: 'Returns' },
      entries: [{ id: 1, messages: [{ role: 'user', content: 'Where is my order?' }] }],
    };
    const runner = createMockRunner(payload);
    const logger = createMockLogger();
    const dir = createProjectTempDir('tmp-datasets-export-');
    const outputPath = path.join(dir, 'dataset-export.json');

    try {
      await runDatasetsCommand(['export', 'd1', '--out', outputPath], runner, logger);
      expect(runner.callTool).toHaveBeenCalledWith('get_dataset', { id: 'd1' });
      expect(fs.existsSync(outputPath)).toBe(true);
      expect(JSON.parse(fs.readFileSync(outputPath, 'utf-8'))).toEqual(payload);
      expect(logger.success).toHaveBeenCalledWith(expect.stringContaining(outputPath));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('warns on missing create args', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runDatasetsCommand(['create'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });
});

// ---- Channels ---------------------------------------------------------------

describe('runChannelsCommand', () => {
  let runChannelsCommand: typeof import('../cli/shortcuts/resources.js').runChannelsCommand;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../cli/shortcuts/resources.js');
    runChannelsCommand = mod.runChannelsCommand;
  });

  it('lists channels by default', async () => {
    const runner = createMockRunner([]);
    const logger = createMockLogger();

    await runChannelsCommand([], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('list_channels', expect.any(Object));
    expect(logger.success).toHaveBeenCalled();
  });

  it('lists channels when "list" is passed', async () => {
    const runner = createMockRunner([]);
    const logger = createMockLogger();

    await runChannelsCommand(['list'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('list_channels', expect.any(Object));
  });

  it('creates channel with name', async () => {
    const runner = createMockRunner({ id: 'ch-1' });
    const logger = createMockLogger();

    await runChannelsCommand(['create', '--name', 'Support'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith(
      'create_channel',
      expect.objectContaining({ name: 'Support' }),
    );
  });

  it('warns on missing create name', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runChannelsCommand(['create'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('gets channel messages', async () => {
    const runner = createMockRunner({ messages: [] });
    const logger = createMockLogger();

    await runChannelsCommand(['messages', 'ch-uuid'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith(
      'get_channel_with_messages',
      expect.objectContaining({ uuid: 'ch-uuid' }),
    );
  });

  it('warns on missing messages channel id', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runChannelsCommand(['messages'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('gets channel by uuid', async () => {
    const runner = createMockRunner({ id: 'some-uuid' });
    const logger = createMockLogger();

    await runChannelsCommand(['some-uuid'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('get_channel', { uuid: 'some-uuid' });
  });
});

// ---- Convos -----------------------------------------------------------------

describe('runConvosCommand', () => {
  let runConvosCommand: typeof import('../cli/shortcuts/resources.js').runConvosCommand;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../cli/shortcuts/resources.js');
    runConvosCommand = mod.runConvosCommand;
  });

  it('lists recent conversations by default', async () => {
    const runner = createMockRunner([]);
    const logger = createMockLogger();

    await runConvosCommand([], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('list_channels', expect.any(Object));
  });

  it('searches conversations', async () => {
    const runner = createMockRunner([]);
    const logger = createMockLogger();

    await runConvosCommand(['search', 'refund'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith(
      'search_messages',
      expect.objectContaining({ query: 'refund' }),
    );
  });

  it('warns on empty search query', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runConvosCommand(['search'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('gets conversation by id', async () => {
    const runner = createMockRunner({ uuid: 'conv-1', messages: [] });
    const logger = createMockLogger();

    await runConvosCommand(['get', 'conv-1'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith(
      'get_channel_with_messages',
      expect.objectContaining({ uuid: 'conv-1' }),
    );
  });

  it('warns on missing get conversation id', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runConvosCommand(['get'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('counts conversations', async () => {
    const runner = createMockRunner({ message_aggregate: { aggregate: { count: 42 } } });
    const logger = createMockLogger();

    await runConvosCommand(['count'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('get_message_count', expect.any(Object));
  });

  it('warns on missing export conversation id', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runConvosCommand(['export'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('exports conversation to output file', async () => {
    const payload = { uuid: 'conv-1', messages: [{ body: 'Hello' }] };
    const runner = createMockRunner(payload);
    const logger = createMockLogger();
    const dir = createProjectTempDir();
    const outputPath = path.join(dir, 'conversation-export.json');

    try {
      await runConvosCommand(['export', 'conv-1', outputPath], runner, logger);
      expect(runner.callTool).toHaveBeenCalledWith(
        'get_channel_with_messages',
        expect.objectContaining({ uuid: 'conv-1' }),
      );
      expect(fs.existsSync(outputPath)).toBe(true);
      expect(JSON.parse(fs.readFileSync(outputPath, 'utf-8'))).toEqual(payload);
      expect(logger.success).toHaveBeenCalledWith(expect.stringContaining(outputPath));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('warns on missing replay conversation id', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runConvosCommand(['replay'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('replays conversation with messages', async () => {
    const payload = {
      uuid: 'conv-1',
      status: 'open',
      agent: { name: 'Bot' },
      created_at: '2025-01-01',
      messages: [
        { body: 'Hello', from: 'user1', timestamp: '2025-01-01T00:00:00Z', fromAgent: false },
        { body: 'Hi there!', from: 'agent', timestamp: '2025-01-01T00:00:01Z', fromAgent: true },
      ],
    };
    const runner = createMockRunner(payload);
    const logger = createMockLogger();

    await runConvosCommand(['replay', 'conv-1'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith(
      'get_channel_with_messages',
      expect.objectContaining({ uuid: 'conv-1' }),
    );
    // Should output conversation messages
    expect(logger.output).toHaveBeenCalled();
  });

  it('warns on missing tag args', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runConvosCommand(['tag'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('warns on invalid tag mode', async () => {
    const runner = createMockRunner({ tags: [] });
    const logger = createMockLogger();

    await runConvosCommand(['tag', 'conv-1', 'invalid', 'mytag'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('add, remove, or set'));
  });

  it('adds tags to conversation', async () => {
    const runner = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({ payload: { tags: ['existing'] } }) // get_channel
        .mockResolvedValueOnce({ payload: { tags: ['existing', 'newtag'] } }), // update_channel
    };
    const logger = createMockLogger();

    await runConvosCommand(['tag', 'conv-1', 'add', 'newtag'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('get_channel', { uuid: 'conv-1' });
    expect(runner.callTool).toHaveBeenCalledWith(
      'update_channel',
      expect.objectContaining({ uuid: 'conv-1', tags: expect.arrayContaining(['newtag']) }),
    );
  });
});

// ---- Messages ---------------------------------------------------------------

describe('runMessagesCommand', () => {
  let runMessagesCommand: typeof import('../cli/shortcuts/resources.js').runMessagesCommand;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../cli/shortcuts/resources.js');
    runMessagesCommand = mod.runMessagesCommand;
  });

  it('warns when list has no chat id', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runMessagesCommand(['list'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('lists messages for a chat', async () => {
    const runner = createMockRunner([]);
    const logger = createMockLogger();

    await runMessagesCommand(['list', '--chat', 'chat-1'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith(
      'list_messages',
      expect.objectContaining({ chat_id: 'chat-1' }),
    );
  });

  it('gets a message by id', async () => {
    const runner = createMockRunner({ id: 'msg-1', body: 'Hello' });
    const logger = createMockLogger();

    await runMessagesCommand(['get', 'msg-1'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('get_message', { id: 'msg-1' });
  });

  it('warns on missing get message id', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runMessagesCommand(['get'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('searches messages', async () => {
    const runner = createMockRunner([]);
    const logger = createMockLogger();

    await runMessagesCommand(['search', 'refund'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith(
      'search_messages',
      expect.objectContaining({ query: 'refund' }),
    );
  });

  it('warns on empty search query', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runMessagesCommand(['search'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('counts messages', async () => {
    const runner = createMockRunner({ aggregate: { count: 100 } });
    const logger = createMockLogger();

    await runMessagesCommand(['count'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('get_message_count', expect.any(Object));
  });

  it('creates a message', async () => {
    const runner = createMockRunner({ id: 'new-msg' });
    const logger = createMockLogger();

    await runMessagesCommand(['create', 'chat-1', 'Hello world'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith(
      'create_message',
      expect.objectContaining({ chat_id: 'chat-1', body: 'Hello world' }),
    );
  });

  it('warns on missing create args', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runMessagesCommand(['create'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('deletes a message', async () => {
    const runner = createMockRunner({ deleted: true });
    const logger = createMockLogger();

    await runMessagesCommand(['delete', 'msg-1'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('delete_message', { id: 'msg-1' });
  });

  it('warns on missing delete message id', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runMessagesCommand(['delete'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('annotates a message with key=value', async () => {
    const runner = {
      callTool: vi
        .fn()
        .mockResolvedValueOnce({ payload: { id: 'msg-1', metadata: {} } }) // get_message
        .mockResolvedValueOnce({ payload: { id: 'msg-1', metadata: { foo: 'bar' } } }), // update_message
    };
    const logger = createMockLogger();

    await runMessagesCommand(['annotate', 'msg-1', 'foo=bar'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('get_message', { id: 'msg-1' });
    expect(runner.callTool).toHaveBeenCalledWith(
      'update_message',
      expect.objectContaining({ id: 'msg-1', metadata: { foo: 'bar' } }),
    );
    expect(logger.success).toHaveBeenCalled();
  });

  it('warns on missing annotate args', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runMessagesCommand(['annotate', 'msg-1'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('warns on invalid annotation format', async () => {
    const runner = createMockRunner({ id: 'msg-1', metadata: {} });
    const logger = createMockLogger();

    await runMessagesCommand(['annotate', 'msg-1', 'badformat'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('key=value'));
  });

  it('treats unknown action as message id lookup', async () => {
    const runner = createMockRunner({ id: 'uuid-msg' });
    const logger = createMockLogger();

    await runMessagesCommand(['uuid-msg'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('get_message', { id: 'uuid-msg' });
  });
});

// ---- Responses --------------------------------------------------------------

describe('runResponsesCommand', () => {
  let runResponsesCommand: typeof import('../cli/shortcuts/resources.js').runResponsesCommand;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../cli/shortcuts/resources.js');
    runResponsesCommand = mod.runResponsesCommand;
  });

  it('lists responses by default', async () => {
    const runner = createMockRunner([]);
    const logger = createMockLogger();

    await runResponsesCommand([], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('list_responses', expect.any(Object));
  });

  it('searches responses', async () => {
    const runner = createMockRunner([]);
    const logger = createMockLogger();

    await runResponsesCommand(['search', 'shipping'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith(
      'search_responses',
      expect.objectContaining({ query: 'shipping' }),
    );
  });

  it('warns on empty search query', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runResponsesCommand(['search'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('counts responses', async () => {
    const runner = createMockRunner({ aggregate: { count: 50 } });
    const logger = createMockLogger();

    await runResponsesCommand(['count'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('get_response_count', {});
  });

  it('gets response by id', async () => {
    const runner = createMockRunner({ id: 'resp-1' });
    const logger = createMockLogger();

    await runResponsesCommand(['get', 'resp-1'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('get_response', { id: 'resp-1' });
  });

  it('warns on missing get response id', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runResponsesCommand(['get'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('rates a response', async () => {
    const runner = createMockRunner({ success: true });
    const logger = createMockLogger();

    await runResponsesCommand(['rate', 'resp-1', 'good'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith(
      'bulk_update_response_ratings',
      expect.objectContaining({ response_ids: ['resp-1'], rating: 'good' }),
    );
  });

  it('warns on missing rate args', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runResponsesCommand(['rate', 'resp-1'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('treats unknown action as response id lookup', async () => {
    const runner = createMockRunner({ id: 'resp-uuid' });
    const logger = createMockLogger();

    await runResponsesCommand(['resp-uuid'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('get_response', { id: 'resp-uuid' });
  });
});

// ---- Analytics --------------------------------------------------------------

describe('runStatusCommand', () => {
  let runStatusCommand: typeof import('../cli/shortcuts/analytics.js').runStatusCommand;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../cli/shortcuts/analytics.js');
    runStatusCommand = mod.runStatusCommand;
  });

  it('fetches all status metrics', async () => {
    const runner = {
      callTool: vi.fn().mockResolvedValue({ payload: [] }),
    };
    const logger = createMockLogger();

    await runStatusCommand(runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('list_agents', expect.any(Object));
    expect(runner.callTool).toHaveBeenCalledWith('list_rules', expect.any(Object));
    expect(runner.callTool).toHaveBeenCalledWith('get_channel_count', {});
    expect(runner.callTool).toHaveBeenCalledWith('get_response_count', {});
    expect(runner.callTool).toHaveBeenCalledWith('get_message_count', {});
    expect(runner.callTool).toHaveBeenCalledWith('kb_get_collection_info', {});
    expect(logger.success).toHaveBeenCalledWith('Current platform status');
  });

  it('outputs JSON when requested', async () => {
    const runner = {
      callTool: vi.fn().mockResolvedValue({ payload: [] }),
    };
    const logger = createMockLogger();

    await runStatusCommand(runner, logger, true);

    expect(logger.output).toHaveBeenCalledWith(expect.stringContaining('metrics'));
  });
});

describe('runAnalyticsCommand', () => {
  let runAnalyticsCommand: typeof import('../cli/shortcuts/analytics.js').runAnalyticsCommand;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../cli/shortcuts/analytics.js');
    runAnalyticsCommand = mod.runAnalyticsCommand;
  });

  it('returns summary by default', async () => {
    const runner = {
      callTool: vi.fn().mockResolvedValue({ payload: [] }),
    };
    const logger = createMockLogger();

    await runAnalyticsCommand([], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('list_agents', expect.any(Object));
    expect(logger.success).toHaveBeenCalledWith('Analytics summary');
  });

  it('warns on unknown action', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runAnalyticsCommand(['badaction'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Unknown'));
  });

  it('handles conversations action', async () => {
    const runner = createMockRunner([]);
    const logger = createMockLogger();

    await runAnalyticsCommand(['conversations'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('list_channels', expect.any(Object));
  });

  it('handles responses action', async () => {
    const runner = createMockRunner([]);
    const logger = createMockLogger();

    await runAnalyticsCommand(['responses'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('list_responses', expect.any(Object));
  });

  it('applies date range filtering in summary mode for channels and responses', async () => {
    const runner = {
      callTool: vi.fn(async (tool: string) => {
        if (tool === 'list_agents') {
          return { payload: [{ id: 'agent-1' }] };
        }
        if (tool === 'list_rules') {
          return { payload: [{ id: 'rule-1' }] };
        }
        if (tool === 'get_message_count') {
          return { payload: { message_aggregate: { aggregate: { count: 10 } } } };
        }
        if (tool === 'list_channels') {
          return {
            payload: [
              { created_at: '2026-02-15T10:00:00.000Z' },
              { created_at: '2026-01-10T10:00:00.000Z' },
            ],
          };
        }
        if (tool === 'list_responses') {
          return {
            payload: [
              { created_date: '2026-02-20T09:00:00.000Z' },
              { created_date: '2026-01-05T09:00:00.000Z' },
            ],
          };
        }
        return { payload: [] };
      }),
    } as unknown as ShortcutRunner;
    const logger = createMockLogger();

    await runAnalyticsCommand(
      ['summary', '--from', '2026-02-01', '--to', '2026-02-28'],
      runner,
      logger,
      true,
    );

    const payload = JSON.parse(String(logger.output.mock.calls[0]?.[0] || '{}')) as {
      analytics: Array<{ metric: string; value: string }>;
    };
    const metrics = new Map(payload.analytics.map((entry) => [entry.metric, entry.value]));
    expect(metrics.get('Channels')).toBe('1');
    expect(metrics.get('Responses')).toBe('1');
    expect(metrics.get('Messages')).toBe('10 (all-time)');
    expect(metrics.get('Date range filtering')).toBe('applied');
  });

  it('treats --from shorthand as a lookback window', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
      const runner = {
        callTool: vi.fn(async (tool: string) => {
          if (tool === 'list_agents') return { payload: [] };
          if (tool === 'list_rules') return { payload: [] };
          if (tool === 'get_message_count') {
            return { payload: { message_aggregate: { aggregate: { count: 2 } } } };
          }
          if (tool === 'list_channels') {
            return {
              payload: [
                { created_at: '2026-02-25T12:00:00.000Z' },
                { created_at: '2026-02-10T12:00:00.000Z' },
              ],
            };
          }
          if (tool === 'list_responses') {
            return {
              payload: [
                { created_date: '2026-02-25T10:00:00.000Z' },
                { created_date: '2026-02-08T10:00:00.000Z' },
              ],
            };
          }
          return { payload: [] };
        }),
      } as unknown as ShortcutRunner;
      const logger = createMockLogger();

      await runAnalyticsCommand(['summary', '--from', '7d'], runner, logger, true);

      const payload = JSON.parse(String(logger.output.mock.calls[0]?.[0] || '{}')) as {
        analytics: Array<{ metric: string; value: string }>;
      };
      const metrics = new Map(payload.analytics.map((entry) => [entry.metric, entry.value]));
      expect(metrics.get('Channels')).toBe('1');
      expect(metrics.get('Responses')).toBe('1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats --since shorthand as a lookback window', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
      const runner = {
        callTool: vi.fn(async (tool: string) => {
          if (tool === 'list_agents') return { payload: [] };
          if (tool === 'list_rules') return { payload: [] };
          if (tool === 'get_message_count') {
            return { payload: { message_aggregate: { aggregate: { count: 2 } } } };
          }
          if (tool === 'list_channels') {
            return {
              payload: [
                { created_at: '2026-02-24T12:00:00.000Z' },
                { created_at: '2026-02-10T12:00:00.000Z' },
              ],
            };
          }
          if (tool === 'list_responses') {
            return {
              payload: [
                { created_date: '2026-02-23T10:00:00.000Z' },
                { created_date: '2026-02-09T10:00:00.000Z' },
              ],
            };
          }
          return { payload: [] };
        }),
      } as unknown as ShortcutRunner;
      const logger = createMockLogger();

      await runAnalyticsCommand(['summary', '--since', '7d'], runner, logger, true);

      const payload = JSON.parse(String(logger.output.mock.calls[0]?.[0] || '{}')) as {
        analytics: Array<{ metric: string; value: string }>;
      };
      const metrics = new Map(payload.analytics.map((entry) => [entry.metric, entry.value]));
      expect(metrics.get('Channels')).toBe('1');
      expect(metrics.get('Responses')).toBe('1');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---- Rules ------------------------------------------------------------------

describe('runRulesCommand', () => {
  let runRulesCommand: typeof import('../cli/shortcuts/rules.js').runRulesCommand;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../cli/shortcuts/rules.js');
    runRulesCommand = mod.runRulesCommand;
  });

  it('lists rules by default (no action)', async () => {
    const runner = createMockRunner([]);
    const logger = createMockLogger();

    await runRulesCommand([], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('list_rules', expect.any(Object));
  });

  it('lists rules with explicit list action', async () => {
    const runner = createMockRunner([]);
    const logger = createMockLogger();

    await runRulesCommand(['list'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('list_rules', expect.any(Object));
  });

  it('gets agent rules', async () => {
    const runner = createMockRunner([]);
    const logger = createMockLogger();

    await runRulesCommand(['agent', 'agent-1'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith(
      'get_agent_rules',
      expect.objectContaining({ agent_id: 'agent-1' }),
    );
  });

  it('warns on missing agent id for agent action', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runRulesCommand(['agent'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('creates a rule', async () => {
    const runner = createMockRunner({ id: 'new-rule' });
    const logger = createMockLogger();

    await runRulesCommand(['create', '--name', 'MyRule', '--type', 'conditional'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith(
      'create_rule',
      expect.objectContaining({ rule_name: 'MyRule', rule_type: 'conditional' }),
    );
  });

  it('warns on missing create args', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runRulesCommand(['create', '--name', 'OnlyName'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('toggles a rule with explicit state', async () => {
    const runner = createMockRunner({ id: 'rule-1' });
    const logger = createMockLogger();

    await runRulesCommand(['toggle', 'rule-1', 'on'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith(
      'update_rule',
      expect.objectContaining({ id: 'rule-1', activated: true }),
    );
  });

  it('warns on missing toggle rule id', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runRulesCommand(['toggle'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('deletes a rule', async () => {
    const runner = createMockRunner({ success: true });
    const logger = createMockLogger();

    await runRulesCommand(['delete', 'rule-1'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('delete_rule', { id: 'rule-1' });
  });

  it('warns on missing delete rule id', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runRulesCommand(['delete'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('gets a rule by id', async () => {
    const runner = {
      callTool: vi.fn().mockResolvedValue({ payload: [{ id: 'rule-1', name: 'Test' }] }),
    };
    const logger = createMockLogger();

    await runRulesCommand(['get', 'rule-1'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('list_rules', expect.any(Object));
    expect(logger.success).toHaveBeenCalled();
  });

  it('warns when get rule not found', async () => {
    const runner = {
      callTool: vi.fn().mockResolvedValue({ payload: [] }),
    };
    const logger = createMockLogger();

    await runRulesCommand(['get', 'missing-rule'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('warns on missing get rule id', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runRulesCommand(['get'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('warns on missing import file', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runRulesCommand(['import'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('exports rules without output file', async () => {
    const runner = createMockRunner([{ id: 'r1' }]);
    const logger = createMockLogger();

    await runRulesCommand(['export'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('list_rules', expect.any(Object));
    expect(logger.success).toHaveBeenCalled();
  });

  it('exports rules to output file', async () => {
    const payload = [{ id: 'r1' }, { id: 'r2' }];
    const runner = createMockRunner(payload);
    const logger = createMockLogger();
    const dir = createProjectTempDir();
    const outputPath = path.join(dir, 'rules-export.json');

    try {
      await runRulesCommand(['export', outputPath], runner, logger);
      expect(runner.callTool).toHaveBeenCalledWith('list_rules', expect.any(Object));
      expect(fs.existsSync(outputPath)).toBe(true);
      expect(JSON.parse(fs.readFileSync(outputPath, 'utf-8'))).toEqual(payload);
      expect(logger.success).toHaveBeenCalledWith(expect.stringContaining(outputPath));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('treats unknown action as rule id lookup', async () => {
    const runner = {
      callTool: vi.fn().mockResolvedValue({ payload: [{ id: 'some-uuid' }] }),
    };
    const logger = createMockLogger();

    await runRulesCommand(['some-uuid'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('list_rules', expect.any(Object));
    expect(logger.success).toHaveBeenCalled();
  });

  it('warns when unknown action lookup fails', async () => {
    const runner = {
      callTool: vi.fn().mockResolvedValue({ payload: [] }),
    };
    const logger = createMockLogger();

    await runRulesCommand(['nonexistent'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });
});

// ---- Knowledge Base ---------------------------------------------------------

describe('runKnowledgeBaseCommand', () => {
  let runKnowledgeBaseCommand: typeof import('../cli/shortcuts/knowledge-base.js').runKnowledgeBaseCommand;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../cli/shortcuts/knowledge-base.js');
    runKnowledgeBaseCommand = mod.runKnowledgeBaseCommand;
  });

  it('lists KB entries by default', async () => {
    const runner = createMockRunner([]);
    const logger = createMockLogger();

    await runKnowledgeBaseCommand([], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('kb_scroll', expect.any(Object));
  });

  it('lists KB entries with explicit list action', async () => {
    const runner = createMockRunner([]);
    const logger = createMockLogger();

    await runKnowledgeBaseCommand(['list'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('kb_scroll', expect.any(Object));
  });

  it('searches KB', async () => {
    const runner = createMockRunner([]);
    const logger = createMockLogger();

    await runKnowledgeBaseCommand(['search', 'shipping', 'policy'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith(
      'kb_search',
      expect.objectContaining({ question: 'shipping policy' }),
    );
  });

  it('warns on empty search query', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runKnowledgeBaseCommand(['search'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('adds text to KB', async () => {
    const runner = createMockRunner({ success: true });
    const logger = createMockLogger();

    await runKnowledgeBaseCommand(['add', 'Some', 'text', 'here'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith(
      'kb_upsert',
      expect.objectContaining({ knowledge: 'Some text here' }),
    );
  });

  it('warns on missing add source', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runKnowledgeBaseCommand(['add'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('deletes KB entries', async () => {
    const runner = createMockRunner({ success: true });
    const logger = createMockLogger();

    await runKnowledgeBaseCommand(['delete', 'id-1', 'id-2'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('kb_delete', { ids: ['id-1', 'id-2'] });
  });

  it('warns on missing delete ids', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runKnowledgeBaseCommand(['delete'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('gets KB info', async () => {
    const runner = createMockRunner({ count: 100 });
    const logger = createMockLogger();

    await runKnowledgeBaseCommand(['info'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith('kb_get_collection_info', {});
  });

  it('scrolls KB entries', async () => {
    const runner = createMockRunner([]);
    const logger = createMockLogger();

    await runKnowledgeBaseCommand(['scroll', 'cursor-abc'], runner, logger);

    expect(runner.callTool).toHaveBeenCalledWith(
      'kb_scroll',
      expect.objectContaining({ offset: 'cursor-abc' }),
    );
  });

  it('warns on unknown KB command', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runKnowledgeBaseCommand(['unknown'], runner, logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Unknown'));
  });
});

// ---- Webhooks ---------------------------------------------------------------

describe('runWebhooksCommand', () => {
  let runWebhooksCommand: typeof import('../cli/shortcuts/monitoring.js').runWebhooksCommand;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../cli/shortcuts/monitoring.js');
    runWebhooksCommand = mod.runWebhooksCommand;
  });

  it('warns when no runner is provided', async () => {
    const logger = createMockLogger();

    await runWebhooksCommand([], logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('requires authentication'));
  });

  it('warns on missing get webhook id', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runWebhooksCommand(['get'], logger, false, runner);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('warns on missing create url', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runWebhooksCommand(['create'], logger, false, runner);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('lists remote webhooks by default', async () => {
    const runner = createMockRunner([{ id: 'wh_1', url: 'https://example.com/hook' }]);
    const logger = createMockLogger();

    await runWebhooksCommand([], logger, false, runner);

    expect(runner.callTool).toHaveBeenCalledWith(
      'list_webhooks',
      expect.objectContaining({ limit: expect.any(Number), offset: 0 }),
    );
    expect(logger.success).toHaveBeenCalled();
  });

  it('creates a remote webhook', async () => {
    const runner = createMockRunner({ id: 'wh_1' });
    const logger = createMockLogger();

    await runWebhooksCommand(
      ['create', 'https://example.com/hook', '--events', 'response.created,response.rated'],
      logger,
      false,
      runner,
    );

    expect(runner.callTool).toHaveBeenCalledWith('create_webhook', {
      url: 'https://example.com/hook',
      events: ['response.created', 'response.rated'],
    });
  });

  it('updates a remote webhook', async () => {
    const runner = createMockRunner({ id: 'wh_1' });
    const logger = createMockLogger();

    await runWebhooksCommand(
      ['update', '00000000-0000-0000-0000-000000000123', '--enabled', 'false'],
      logger,
      false,
      runner,
    );

    expect(runner.callTool).toHaveBeenCalledWith('update_webhook', {
      id: '00000000-0000-0000-0000-000000000123',
      is_active: false,
    });
  });

  it('lists remote webhook deliveries', async () => {
    const runner = createMockRunner([{ id: 'delivery_1' }]);
    const logger = createMockLogger();

    await runWebhooksCommand(
      ['deliveries', '00000000-0000-0000-0000-000000000123', '--limit', '5'],
      logger,
      false,
      runner,
    );

    expect(runner.callTool).toHaveBeenCalledWith('list_webhook_deliveries', {
      webhook_id: '00000000-0000-0000-0000-000000000123',
      limit: 5,
      offset: 0,
    });
  });

  it('warns that remote webhook test is unsupported', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runWebhooksCommand(
      ['test', '00000000-0000-0000-0000-000000000123'],
      logger,
      false,
      runner,
    );

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('not supported'));
  });

  it('warns on missing delete webhook id', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runWebhooksCommand(['delete'], logger, false, runner);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('warns on unknown webhooks command', async () => {
    const runner = createMockRunner();
    const logger = createMockLogger();

    await runWebhooksCommand(['unknown'], logger, false, runner);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Unknown'));
  });
});

// ---- Alerts -----------------------------------------------------------------

describe('runAlertsCommand', () => {
  let runAlertsCommand: typeof import('../cli/shortcuts/monitoring.js').runAlertsCommand;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../cli/shortcuts/monitoring.js');
    runAlertsCommand = mod.runAlertsCommand;
  });

  it('warns when no alerts configured', async () => {
    const logger = createMockLogger();

    await runAlertsCommand([], logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('No alerts'));
  });

  it('warns on missing get alert id', async () => {
    const logger = createMockLogger();

    await runAlertsCommand(['get'], logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('warns on missing create args', async () => {
    const logger = createMockLogger();

    await runAlertsCommand(['create'], logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('warns on missing delete alert id', async () => {
    const logger = createMockLogger();

    await runAlertsCommand(['delete'], logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('warns on unknown alerts command', async () => {
    const logger = createMockLogger();

    await runAlertsCommand(['unknown'], logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Unknown'));
  });
});

// ---- Monitor ----------------------------------------------------------------

describe('runMonitorCommand', () => {
  let runMonitorCommand: typeof import('../cli/shortcuts/monitoring.js').runMonitorCommand;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../cli/shortcuts/monitoring.js');
    runMonitorCommand = mod.runMonitorCommand;
  });

  it('warns when no runner provided', async () => {
    const logger = createMockLogger();

    await runMonitorCommand([], logger, false);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('requires authentication'));
  });

  it('runs status by default', async () => {
    const runner = {
      callTool: vi.fn().mockResolvedValue({ payload: [] }),
    };
    const logger = createMockLogger();

    await runMonitorCommand([], logger, false, runner);

    expect(runner.callTool).toHaveBeenCalledWith('list_agents', expect.any(Object));
    expect(logger.success).toHaveBeenCalled();
  });

  it('runs status in JSON mode', async () => {
    const runner = {
      callTool: vi.fn().mockResolvedValue({ payload: [] }),
    };
    const logger = createMockLogger();

    await runMonitorCommand([], logger, true, runner);

    expect(logger.output).toHaveBeenCalled();
  });

  it('warns on unknown monitor action', async () => {
    const runner = {
      callTool: vi.fn().mockResolvedValue({ payload: [] }),
    };
    const logger = createMockLogger();

    await runMonitorCommand(['badaction'], logger, false, runner);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Unknown'));
  });

  it('runs live mode with --count 1', async () => {
    const runner = {
      callTool: vi.fn().mockResolvedValue({ payload: [] }),
    };
    const logger = createMockLogger();

    await runMonitorCommand(['live', '--count', '1'], logger, false, runner);

    expect(runner.callTool).toHaveBeenCalled();
    expect(logger.success).toHaveBeenCalled();
  });
});
