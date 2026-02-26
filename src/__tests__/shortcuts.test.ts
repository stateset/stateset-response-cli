import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ShortcutRunner, ShortcutLogger } from '../cli/shortcuts/types.js';

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

  it('warns when no webhooks configured', async () => {
    const logger = createMockLogger();

    await runWebhooksCommand([], logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('No webhooks'));
  });

  it('warns on missing get webhook id', async () => {
    const logger = createMockLogger();

    await runWebhooksCommand(['get'], logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('warns on missing create url', async () => {
    const logger = createMockLogger();

    await runWebhooksCommand(['create'], logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('warns on missing test webhook id', async () => {
    const logger = createMockLogger();

    await runWebhooksCommand(['test'], logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('warns on missing logs webhook id', async () => {
    const logger = createMockLogger();

    await runWebhooksCommand(['logs'], logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('warns on missing delete webhook id', async () => {
    const logger = createMockLogger();

    await runWebhooksCommand(['delete'], logger);

    expect(logger.warning).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('warns on unknown webhooks command', async () => {
    const logger = createMockLogger();

    await runWebhooksCommand(['unknown'], logger);

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
