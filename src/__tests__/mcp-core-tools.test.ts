import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../mcp-server/graphql-client.js', () => ({
  executeQuery: vi.fn(),
}));

// Stable uuid for create_agent / create_channel
vi.mock('uuid', () => ({ v4: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }));

import { executeQuery } from '../mcp-server/graphql-client.js';
import { registerAgentTools } from '../mcp-server/tools/agents.js';
import { registerRuleTools } from '../mcp-server/tools/rules.js';
import { registerSkillTools } from '../mcp-server/tools/skills.js';
import { registerChannelTools } from '../mcp-server/tools/channels.js';
import { registerSettingsTools } from '../mcp-server/tools/settings.js';
import { registerOrganizationTools } from '../mcp-server/tools/organizations.js';

const executeQueryMock = vi.mocked(executeQuery);

const ORG_ID = 'org-test-123';

/* ---------- shared mock server ---------- */
function makeMockServer() {
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};
  const mockServer = {
    tool: vi.fn(
      (
        name: string,
        _desc: string,
        _schema: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) => {
        handlers[name] = handler;
      },
    ),
  };
  return { handlers, mockServer };
}

// ═══════════════════════════════════════════════════════════════════════
//  AGENTS
// ═══════════════════════════════════════════════════════════════════════
describe('agent MCP tools', () => {
  let handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const ctx = makeMockServer();
    handlers = ctx.handlers;
    registerAgentTools(ctx.mockServer as never, {} as never, ORG_ID);
  });

  // ── list_agents ────────────────────────────────────────────────────
  it('list_agents scopes to org_id and defaults limit/offset', async () => {
    executeQueryMock.mockResolvedValueOnce({ agents: [{ id: 'a1' }] });
    await handlers.list_agents({});

    expect(executeQueryMock).toHaveBeenCalledTimes(1);
    const query = String(executeQueryMock.mock.calls[0][1]);
    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(query).toContain('org_id');
    expect(vars.org_id).toBe(ORG_ID);
    expect(vars.limit).toBe(100);
    expect(vars.offset).toBe(0);
  });

  it('list_agents forwards custom limit/offset', async () => {
    executeQueryMock.mockResolvedValueOnce({ agents: [] });
    await handlers.list_agents({ limit: 10, offset: 20 });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.limit).toBe(10);
    expect(vars.offset).toBe(20);
  });

  // ── get_agent ──────────────────────────────────────────────────────
  it('get_agent scopes to org_id and returns agent', async () => {
    executeQueryMock.mockResolvedValueOnce({ agents: [{ id: 'a1', agent_name: 'Bot' }] });
    const result = (await handlers.get_agent({ agent_id: 'a1' })) as {
      content: { text: string }[];
    };

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
    expect(vars.agent_id).toBe('a1');
    expect(JSON.parse(result.content[0].text)).toMatchObject({ id: 'a1' });
  });

  it('get_agent returns errorResult when not found', async () => {
    executeQueryMock.mockResolvedValueOnce({ agents: [] });
    const result = (await handlers.get_agent({ agent_id: 'missing' })) as {
      isError: boolean;
      content: { text: string }[];
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  // ── create_agent ───────────────────────────────────────────────────
  it('create_agent passes agent object with org_id', async () => {
    executeQueryMock.mockResolvedValueOnce({
      insert_agents: { returning: [{ id: 'new-id' }] },
    });
    await handlers.create_agent({ agent_name: 'Helper', agent_type: 'AI Agent' });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    const agent = vars.agent as Record<string, unknown>;
    expect(agent.org_id).toBe(ORG_ID);
    expect(agent.agent_name).toBe('Helper');
    expect(agent.agent_type).toBe('AI Agent');
    expect(agent.id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(agent.activated).toBe(true);
  });

  // ── update_agent ───────────────────────────────────────────────────
  it('update_agent scopes to org_id and strips undefined fields', async () => {
    executeQueryMock.mockResolvedValueOnce({
      update_agents: { returning: [{ id: 'a1', agent_name: 'Renamed' }] },
    });
    await handlers.update_agent({ id: 'a1', agent_name: 'Renamed' });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
    expect(vars.id).toBe('a1');
    const set = vars.set as Record<string, unknown>;
    expect(set.agent_name).toBe('Renamed');
    // undefined optional fields should be removed
    expect(set).not.toHaveProperty('description');
    expect(set).not.toHaveProperty('role');
    expect(set).toHaveProperty('updated_at');
  });

  it('update_agent returns errorResult when not found', async () => {
    executeQueryMock.mockResolvedValueOnce({ update_agents: { returning: [] } });
    const result = (await handlers.update_agent({ id: 'missing', agent_name: 'X' })) as {
      isError: boolean;
    };
    expect(result.isError).toBe(true);
  });

  // ── delete_agent ───────────────────────────────────────────────────
  it('delete_agent scopes to org_id', async () => {
    executeQueryMock.mockResolvedValueOnce({
      delete_agents: { returning: [{ id: 'a1', agent_name: 'Bot' }] },
    });
    await handlers.delete_agent({ id: 'a1' });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
    expect(vars.id).toBe('a1');
  });

  it('delete_agent returns errorResult when not found', async () => {
    executeQueryMock.mockResolvedValueOnce({ delete_agents: { returning: [] } });
    const result = (await handlers.delete_agent({ id: 'missing' })) as { isError: boolean };
    expect(result.isError).toBe(true);
  });

  // ── bootstrap_agent ────────────────────────────────────────────────
  it('bootstrap_agent calls Promise.all with 3 queries', async () => {
    executeQueryMock
      .mockResolvedValueOnce({ rules: [{ id: 'r1' }] })
      .mockResolvedValueOnce({ attributes: [] })
      .mockResolvedValueOnce({ agents: [{ id: 'a1' }] });

    const result = (await handlers.bootstrap_agent({ agent_id: 'a1' })) as {
      content: { text: string }[];
    };

    expect(executeQueryMock).toHaveBeenCalledTimes(3);
    // Each call should reference org_id
    for (let i = 0; i < 3; i++) {
      const vars = executeQueryMock.mock.calls[i][2] as Record<string, unknown>;
      expect(vars.org_id).toBe(ORG_ID);
      expect(vars.agent_id).toBe('a1');
    }
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.agent_info).toMatchObject({ id: 'a1' });
    expect(parsed.rules).toHaveLength(1);
  });

  // ── export_agent ───────────────────────────────────────────────────
  it('export_agent fetches 5 queries and bundles result', async () => {
    executeQueryMock
      .mockResolvedValueOnce({ agents: [{ id: 'a1' }] })
      .mockResolvedValueOnce({ rules: [] })
      .mockResolvedValueOnce({ skills: [] })
      .mockResolvedValueOnce({ attributes: [] })
      .mockResolvedValueOnce({ functions: [] });

    const result = (await handlers.export_agent({ agent_id: 'a1' })) as {
      content: { text: string }[];
    };

    expect(executeQueryMock).toHaveBeenCalledTimes(5);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty('exported_at');
    expect(parsed.agent).toMatchObject({ id: 'a1' });
    expect(parsed.rules).toEqual([]);
    expect(parsed.skills).toEqual([]);
    expect(parsed.attributes).toEqual([]);
    expect(parsed.functions).toEqual([]);
  });

  it('export_agent returns errorResult when agent not found', async () => {
    executeQueryMock
      .mockResolvedValueOnce({ agents: [] })
      .mockResolvedValueOnce({ rules: [] })
      .mockResolvedValueOnce({ skills: [] })
      .mockResolvedValueOnce({ attributes: [] })
      .mockResolvedValueOnce({ functions: [] });

    const result = (await handlers.export_agent({ agent_id: 'missing' })) as {
      isError: boolean;
    };
    expect(result.isError).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  RULES
// ═══════════════════════════════════════════════════════════════════════
describe('rule MCP tools', () => {
  let handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const ctx = makeMockServer();
    handlers = ctx.handlers;
    registerRuleTools(ctx.mockServer as never, {} as never, ORG_ID);
  });

  // ── list_rules ─────────────────────────────────────────────────────
  it('list_rules scopes to org_id with default pagination', async () => {
    executeQueryMock.mockResolvedValueOnce({ rules: [] });
    await handlers.list_rules({});

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
    expect(vars.limit).toBe(100);
    expect(vars.offset).toBe(0);
  });

  // ── get_agent_rules ────────────────────────────────────────────────
  it('get_agent_rules scopes to org_id and agent_id', async () => {
    executeQueryMock.mockResolvedValueOnce({ rules: [{ id: 'r1' }] });
    await handlers.get_agent_rules({ agent_id: 'a1', limit: 5, offset: 0 });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
    expect(vars.agent_id).toBe('a1');
    expect(vars.limit).toBe(5);
  });

  // ── create_rule ────────────────────────────────────────────────────
  it('create_rule stamps org_id on the rule object', async () => {
    executeQueryMock.mockResolvedValueOnce({
      insert_rules: { returning: [{ id: 'r-new' }] },
    });
    await handlers.create_rule({ rule_name: 'Greeting', rule_type: 'response' });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    const rule = vars.rule as Record<string, unknown>;
    expect(rule.org_id).toBe(ORG_ID);
    expect(rule.rule_name).toBe('Greeting');
    expect(rule.activated).toBe(true);
  });

  // ── update_rule ────────────────────────────────────────────────────
  it('update_rule scopes to org_id and strips undefined', async () => {
    executeQueryMock.mockResolvedValueOnce({
      update_rules: { returning: [{ id: 'r1' }] },
    });
    await handlers.update_rule({ id: 'r1', rule_name: 'New Name' });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
    const set = vars.set as Record<string, unknown>;
    expect(set.rule_name).toBe('New Name');
    expect(set).not.toHaveProperty('rule_type');
  });

  it('update_rule returns errorResult when not found', async () => {
    executeQueryMock.mockResolvedValueOnce({ update_rules: { returning: [] } });
    const result = (await handlers.update_rule({ id: 'missing', rule_name: 'X' })) as {
      isError: boolean;
    };
    expect(result.isError).toBe(true);
  });

  // ── delete_rule ────────────────────────────────────────────────────
  it('delete_rule scopes to org_id', async () => {
    executeQueryMock.mockResolvedValueOnce({
      delete_rules: { returning: [{ id: 'r1', rule_name: 'X' }] },
    });
    await handlers.delete_rule({ id: 'r1' });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
  });

  it('delete_rule returns errorResult when not found', async () => {
    executeQueryMock.mockResolvedValueOnce({ delete_rules: { returning: [] } });
    const result = (await handlers.delete_rule({ id: 'missing' })) as { isError: boolean };
    expect(result.isError).toBe(true);
  });

  // ── import_rules ───────────────────────────────────────────────────
  it('import_rules stamps org_id on each rule', async () => {
    executeQueryMock.mockResolvedValueOnce({
      insert_rules: { returning: [{ id: 'r1' }], affected_rows: 1 },
    });
    await handlers.import_rules({
      rules: [
        { rule_name: 'A', rule_type: 'type1' },
        { rule_name: 'B', rule_type: 'type2' },
      ],
    });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    const prepared = vars.rules as Record<string, unknown>[];
    expect(prepared).toHaveLength(2);
    for (const r of prepared) {
      expect(r.org_id).toBe(ORG_ID);
    }
  });

  // ── bulk_update_rule_status ────────────────────────────────────────
  it('bulk_update_rule_status passes ids array and scopes to org_id', async () => {
    executeQueryMock.mockResolvedValueOnce({ update_rules: { affected_rows: 2 } });
    await handlers.bulk_update_rule_status({
      ids: ['r1', 'r2'],
      activated: false,
    });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
    expect(vars.ids).toEqual(['r1', 'r2']);
    expect(vars.activated).toBe(false);
  });

  // ── bulk_assign_rules_to_agent ─────────────────────────────────────
  it('bulk_assign_rules_to_agent passes ids and agent_id', async () => {
    executeQueryMock.mockResolvedValueOnce({ update_rules: { affected_rows: 3 } });
    await handlers.bulk_assign_rules_to_agent({
      ids: ['r1', 'r2', 'r3'],
      agent_id: 'a1',
    });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
    expect(vars.ids).toEqual(['r1', 'r2', 'r3']);
    expect(vars.agent_id).toBe('a1');
  });

  // ── bulk_delete_rules ──────────────────────────────────────────────
  it('bulk_delete_rules passes ids array and scopes to org_id', async () => {
    executeQueryMock.mockResolvedValueOnce({ delete_rules: { affected_rows: 2 } });
    await handlers.bulk_delete_rules({ ids: ['r1', 'r2'] });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
    expect(vars.ids).toEqual(['r1', 'r2']);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  SKILLS
// ═══════════════════════════════════════════════════════════════════════
describe('skill MCP tools', () => {
  let handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const ctx = makeMockServer();
    handlers = ctx.handlers;
    registerSkillTools(ctx.mockServer as never, {} as never, ORG_ID);
  });

  it('list_skills scopes to org_id with default pagination', async () => {
    executeQueryMock.mockResolvedValueOnce({ skills: [] });
    await handlers.list_skills({});

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
    expect(vars.limit).toBe(100);
    expect(vars.offset).toBe(0);
  });

  it('get_agent_skills scopes to org_id and agent_id', async () => {
    executeQueryMock.mockResolvedValueOnce({ skills: [{ id: 's1' }] });
    await handlers.get_agent_skills({ agent_id: 'a1' });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
    expect(vars.agent_id).toBe('a1');
  });

  it('create_skill stamps org_id on skill object', async () => {
    executeQueryMock.mockResolvedValueOnce({
      insert_skills: { returning: [{ id: 's-new' }] },
    });
    await handlers.create_skill({ skill_name: 'Lookup', skill_type: 'action' });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    const skill = vars.skill as Record<string, unknown>;
    expect(skill.org_id).toBe(ORG_ID);
    expect(skill.skill_name).toBe('Lookup');
    expect(skill.activated).toBe(true);
  });

  it('update_skill scopes to org_id and strips undefined', async () => {
    executeQueryMock.mockResolvedValueOnce({
      update_skills: { returning: [{ id: 's1' }] },
    });
    await handlers.update_skill({ id: 's1', skill_name: 'Renamed' });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
    const set = vars.set as Record<string, unknown>;
    expect(set.skill_name).toBe('Renamed');
    expect(set).not.toHaveProperty('skill_type');
  });

  it('update_skill returns errorResult when not found', async () => {
    executeQueryMock.mockResolvedValueOnce({ update_skills: { returning: [] } });
    const result = (await handlers.update_skill({ id: 'missing', skill_name: 'X' })) as {
      isError: boolean;
    };
    expect(result.isError).toBe(true);
  });

  it('delete_skill scopes to org_id', async () => {
    executeQueryMock.mockResolvedValueOnce({
      delete_skills: { returning: [{ id: 's1', skill_name: 'X' }] },
    });
    await handlers.delete_skill({ id: 's1' });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
  });

  it('delete_skill returns errorResult when not found', async () => {
    executeQueryMock.mockResolvedValueOnce({ delete_skills: { returning: [] } });
    const result = (await handlers.delete_skill({ id: 'missing' })) as { isError: boolean };
    expect(result.isError).toBe(true);
  });

  it('import_skills stamps org_id on each skill', async () => {
    executeQueryMock.mockResolvedValueOnce({
      insert_skills: { returning: [{ id: 's1' }], affected_rows: 1 },
    });
    await handlers.import_skills({
      skills: [
        { skill_name: 'A', skill_type: 't1' },
        { skill_name: 'B', skill_type: 't2' },
      ],
    });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    const prepared = vars.skills as Record<string, unknown>[];
    expect(prepared).toHaveLength(2);
    for (const s of prepared) {
      expect(s.org_id).toBe(ORG_ID);
    }
  });

  it('bulk_update_skill_status passes ids and activated flag', async () => {
    executeQueryMock.mockResolvedValueOnce({ update_skills: { affected_rows: 2 } });
    await handlers.bulk_update_skill_status({ ids: ['s1', 's2'], activated: true });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
    expect(vars.ids).toEqual(['s1', 's2']);
    expect(vars.activated).toBe(true);
  });

  it('bulk_delete_skills passes ids array', async () => {
    executeQueryMock.mockResolvedValueOnce({ delete_skills: { affected_rows: 2 } });
    await handlers.bulk_delete_skills({ ids: ['s1', 's2'] });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
    expect(vars.ids).toEqual(['s1', 's2']);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  CHANNELS
// ═══════════════════════════════════════════════════════════════════════
describe('channel MCP tools', () => {
  let handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const ctx = makeMockServer();
    handlers = ctx.handlers;
    registerChannelTools(ctx.mockServer as never, {} as never, ORG_ID);
  });

  // ── list_channels ──────────────────────────────────────────────────
  it('list_channels scopes to org_id with default limit 50', async () => {
    executeQueryMock.mockResolvedValueOnce({ channel_thread: [] });
    await handlers.list_channels({});

    const query = String(executeQueryMock.mock.calls[0][1]);
    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(query).toContain('org_id');
    expect(vars.org_id).toBe(ORG_ID);
    expect(vars.limit).toBe(50);
    expect(vars.offset).toBe(0);
  });

  it('list_channels builds dynamic filter for status', async () => {
    executeQueryMock.mockResolvedValueOnce({ channel_thread: [] });
    await handlers.list_channels({ status: 'open' });

    const query = String(executeQueryMock.mock.calls[0][1]);
    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(query).toContain('$status');
    expect(query).toContain('_and');
    expect(vars.status).toBe('open');
  });

  it('list_channels builds dynamic filter for agent_id', async () => {
    executeQueryMock.mockResolvedValueOnce({ channel_thread: [] });
    await handlers.list_channels({ agent_id: 'a1' });

    const query = String(executeQueryMock.mock.calls[0][1]);
    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(query).toContain('$agent_id');
    expect(vars.agent_id).toBe('a1');
  });

  it('list_channels builds dynamic filter for escalated', async () => {
    executeQueryMock.mockResolvedValueOnce({ channel_thread: [] });
    await handlers.list_channels({ escalated: true });

    const query = String(executeQueryMock.mock.calls[0][1]);
    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(query).toContain('$escalated');
    expect(vars.escalated).toBe(true);
  });

  it('list_channels combines multiple filters', async () => {
    executeQueryMock.mockResolvedValueOnce({ channel_thread: [] });
    await handlers.list_channels({ status: 'closed', agent_id: 'a1', escalated: false });

    const query = String(executeQueryMock.mock.calls[0][1]);
    expect(query).toContain('$status');
    expect(query).toContain('$agent_id');
    expect(query).toContain('$escalated');
    expect(query).toContain('_and');
  });

  // ── get_channel ────────────────────────────────────────────────────
  it('get_channel scopes to org_id', async () => {
    executeQueryMock.mockResolvedValueOnce({ channel_thread: [{ uuid: 'ch-1' }] });
    await handlers.get_channel({ uuid: 'ch-1' });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
    expect(vars.uuid).toBe('ch-1');
  });

  it('get_channel returns errorResult when not found', async () => {
    executeQueryMock.mockResolvedValueOnce({ channel_thread: [] });
    const result = (await handlers.get_channel({ uuid: 'missing' })) as { isError: boolean };
    expect(result.isError).toBe(true);
  });

  // ── get_channel_with_messages ──────────────────────────────────────
  it('get_channel_with_messages scopes to org_id and defaults message limit', async () => {
    executeQueryMock.mockResolvedValueOnce({
      channel_thread: [{ uuid: 'ch-1', messages: [] }],
    });
    await handlers.get_channel_with_messages({ uuid: 'ch-1' });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
    expect(vars.msg_limit).toBe(100);
  });

  it('get_channel_with_messages returns errorResult when not found', async () => {
    executeQueryMock.mockResolvedValueOnce({ channel_thread: [] });
    const result = (await handlers.get_channel_with_messages({ uuid: 'missing' })) as {
      isError: boolean;
    };
    expect(result.isError).toBe(true);
  });

  // ── create_channel ─────────────────────────────────────────────────
  it('create_channel stamps org_id and generates uuid', async () => {
    executeQueryMock.mockResolvedValueOnce({
      insert_channel_thread: { returning: [{ uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }] },
    });
    await handlers.create_channel({ name: 'Support Chat' });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    const object = vars.object as Record<string, unknown>;
    expect(object.org_id).toBe(ORG_ID);
    expect(object.uuid).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(object.name).toBe('Support Chat');
    expect(object.model).toBe('gpt-4o-2024-11-20');
  });

  // ── update_channel ─────────────────────────────────────────────────
  it('update_channel returns errorResult when no fields provided', async () => {
    const result = (await handlers.update_channel({ uuid: 'ch-1' })) as { isError: boolean };
    expect(result.isError).toBe(true);
    expect(executeQueryMock).not.toHaveBeenCalled();
  });

  it('update_channel scopes to org_id', async () => {
    executeQueryMock.mockResolvedValueOnce({
      update_channel_thread: { affected_rows: 1, returning: [{ uuid: 'ch-1' }] },
    });
    await handlers.update_channel({ uuid: 'ch-1', name: 'Renamed' });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
    expect(vars.uuid).toBe('ch-1');
    expect((vars.set as Record<string, unknown>).name).toBe('Renamed');
  });

  it('update_channel returns errorResult when not found', async () => {
    executeQueryMock.mockResolvedValueOnce({
      update_channel_thread: { affected_rows: 0, returning: [] },
    });
    const result = (await handlers.update_channel({ uuid: 'missing', name: 'X' })) as {
      isError: boolean;
    };
    expect(result.isError).toBe(true);
  });

  // ── delete_channel ─────────────────────────────────────────────────
  it('delete_channel scopes to org_id', async () => {
    executeQueryMock.mockResolvedValueOnce({ delete_channel_thread: { affected_rows: 1 } });
    await handlers.delete_channel({ uuid: 'ch-1' });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
    expect(vars.uuid).toBe('ch-1');
  });

  it('delete_channel returns errorResult when affected_rows is 0', async () => {
    executeQueryMock.mockResolvedValueOnce({ delete_channel_thread: { affected_rows: 0 } });
    const result = (await handlers.delete_channel({ uuid: 'missing' })) as { isError: boolean };
    expect(result.isError).toBe(true);
  });

  // ── get_channel_count ──────────────────────────────────────────────
  it('get_channel_count scopes to org_id', async () => {
    executeQueryMock.mockResolvedValueOnce({
      channel_thread_aggregate: { aggregate: { count: 42 } },
    });
    const result = (await handlers.get_channel_count({})) as { content: { text: string }[] };

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
    expect(JSON.parse(result.content[0].text).aggregate.count).toBe(42);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════════════════════
describe('settings MCP tools', () => {
  let handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const ctx = makeMockServer();
    handlers = ctx.handlers;
    registerSettingsTools(ctx.mockServer as never, {} as never, ORG_ID);
  });

  it('list_agent_settings scopes to org_id', async () => {
    executeQueryMock.mockResolvedValueOnce({ agent_settings: [{ id: 1 }] });
    await handlers.list_agent_settings({});

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
  });

  it('get_agent_settings scopes to org_id', async () => {
    executeQueryMock.mockResolvedValueOnce({ agent_settings: [{ id: 1 }] });
    await handlers.get_agent_settings({ id: 1 });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
    expect(vars.id).toBe(1);
  });

  it('get_agent_settings returns errorResult when not found', async () => {
    executeQueryMock.mockResolvedValueOnce({ agent_settings: [] });
    const result = (await handlers.get_agent_settings({ id: 999 })) as { isError: boolean };
    expect(result.isError).toBe(true);
  });

  it('update_agent_settings scopes to org_id and passes fields', async () => {
    executeQueryMock.mockResolvedValueOnce({
      update_agent_settings: { affected_rows: 1, returning: [{ id: 1 }] },
    });
    await handlers.update_agent_settings({ id: 1, model_name: 'claude-sonnet-4-6' });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
    expect(vars.id).toBe(1);
    const set = vars.set as Record<string, unknown>;
    expect(set.model_name).toBe('claude-sonnet-4-6');
    expect(set).toHaveProperty('updated_at');
  });

  it('update_agent_settings returns errorResult when not found', async () => {
    executeQueryMock.mockResolvedValueOnce({
      update_agent_settings: { affected_rows: 0, returning: [] },
    });
    const result = (await handlers.update_agent_settings({
      id: 999,
      model_name: 'x',
    })) as { isError: boolean };
    expect(result.isError).toBe(true);
  });

  it('get_channel_settings scopes to org_id', async () => {
    executeQueryMock.mockResolvedValueOnce({
      organizations: [{ org_id: ORG_ID, channel_settings: { chat: true } }],
    });
    await handlers.get_channel_settings({});

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
  });

  it('get_channel_settings returns errorResult when org not found', async () => {
    executeQueryMock.mockResolvedValueOnce({ organizations: [] });
    const result = (await handlers.get_channel_settings({})) as { isError: boolean };
    expect(result.isError).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  ORGANIZATIONS
// ═══════════════════════════════════════════════════════════════════════
describe('organization MCP tools', () => {
  let handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const ctx = makeMockServer();
    handlers = ctx.handlers;
    registerOrganizationTools(ctx.mockServer as never, {} as never, ORG_ID);
  });

  it('get_organization scopes to org_id', async () => {
    executeQueryMock.mockResolvedValueOnce({
      organizations: [{ org_id: ORG_ID, organization_name: 'Acme' }],
    });
    const result = (await handlers.get_organization({})) as { content: { text: string }[] };

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
    expect(JSON.parse(result.content[0].text).organization_name).toBe('Acme');
  });

  it('get_organization returns errorResult when not found', async () => {
    executeQueryMock.mockResolvedValueOnce({ organizations: [] });
    const result = (await handlers.get_organization({})) as { isError: boolean };
    expect(result.isError).toBe(true);
  });

  it('get_organization_overview extracts aggregate counts', async () => {
    executeQueryMock.mockResolvedValueOnce({
      organizations: [{ org_id: ORG_ID, organization_name: 'Acme' }],
      agents_aggregate: { aggregate: { count: 3 } },
      rules_aggregate: { aggregate: { count: 10 } },
      skills_aggregate: { aggregate: { count: 5 } },
      responses_aggregate: { aggregate: { count: 200 } },
      channel_thread_aggregate: { aggregate: { count: 50 } },
      datasets_aggregate: { aggregate: { count: 2 } },
      functions_aggregate: { aggregate: { count: 7 } },
    });

    const result = (await handlers.get_organization_overview({})) as {
      content: { text: string }[];
    };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.counts).toEqual({
      agents: 3,
      rules: 10,
      skills: 5,
      responses: 200,
      channels: 50,
      datasets: 2,
      functions: 7,
    });
  });

  it('get_organization_overview returns errorResult when org not found', async () => {
    executeQueryMock.mockResolvedValueOnce({
      organizations: [],
      agents_aggregate: { aggregate: { count: 0 } },
      rules_aggregate: { aggregate: { count: 0 } },
      skills_aggregate: { aggregate: { count: 0 } },
      responses_aggregate: { aggregate: { count: 0 } },
      channel_thread_aggregate: { aggregate: { count: 0 } },
      datasets_aggregate: { aggregate: { count: 0 } },
      functions_aggregate: { aggregate: { count: 0 } },
    });

    const result = (await handlers.get_organization_overview({})) as { isError: boolean };
    expect(result.isError).toBe(true);
  });

  it('get_organization_overview defaults missing aggregates to 0', async () => {
    executeQueryMock.mockResolvedValueOnce({
      organizations: [{ org_id: ORG_ID }],
      // some aggregates missing entirely
      agents_aggregate: {},
      rules_aggregate: { aggregate: {} },
      skills_aggregate: { aggregate: { count: 1 } },
    });

    const result = (await handlers.get_organization_overview({})) as {
      content: { text: string }[];
    };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.counts.agents).toBe(0);
    expect(parsed.counts.rules).toBe(0);
    expect(parsed.counts.skills).toBe(1);
    expect(parsed.counts.responses).toBe(0);
  });

  // ── update_organization ────────────────────────────────────────────
  it('update_organization returns errorResult when no fields provided', async () => {
    const result = (await handlers.update_organization({})) as { isError: boolean };
    expect(result.isError).toBe(true);
    expect(executeQueryMock).not.toHaveBeenCalled();
  });

  it('update_organization scopes to org_id', async () => {
    executeQueryMock.mockResolvedValueOnce({
      update_organizations: { affected_rows: 1, returning: [{ org_id: ORG_ID }] },
    });
    await handlers.update_organization({ organization_name: 'New Name' });

    const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
    expect(vars.org_id).toBe(ORG_ID);
    expect((vars.set as Record<string, unknown>).organization_name).toBe('New Name');
  });

  it('update_organization returns errorResult when not found', async () => {
    executeQueryMock.mockResolvedValueOnce({
      update_organizations: { affected_rows: 0, returning: [] },
    });
    const result = (await handlers.update_organization({ slug: 'new-slug' })) as {
      isError: boolean;
    };
    expect(result.isError).toBe(true);
  });
});
