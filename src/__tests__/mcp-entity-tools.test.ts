import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../mcp-server/graphql-client.js', () => ({
  executeQuery: vi.fn(),
}));

import { executeQuery } from '../mcp-server/graphql-client.js';
import { registerAttributeTools } from '../mcp-server/tools/attributes.js';
import { registerExampleTools } from '../mcp-server/tools/examples.js';
import { registerEvalTools } from '../mcp-server/tools/evals.js';
import { registerDatasetTools } from '../mcp-server/tools/datasets.js';
import { registerFunctionTools } from '../mcp-server/tools/functions.js';
import { registerResponseTools } from '../mcp-server/tools/responses.js';

const executeQueryMock = vi.mocked(executeQuery);

const ORG_ID = 'org-test-123';
const FAKE_UUID = '00000000-0000-0000-0000-000000000001';
const FAKE_AGENT_ID = '00000000-0000-0000-0000-000000000099';

function buildMockServer() {
  const handlers: Record<string, (args: unknown) => Promise<unknown>> = {};
  const mockServer = {
    tool: vi.fn(
      (
        name: string,
        _desc: string,
        _schema: unknown,
        handler: (args: unknown) => Promise<unknown>,
      ) => {
        handlers[name] = handler;
      },
    ),
  };
  return { mockServer, handlers };
}

function parseResult(result: unknown): unknown {
  const content = (result as { content: Array<{ text: string }> }).content;
  return JSON.parse(content[0].text);
}

function extractText(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text;
}

function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------
describe('attribute MCP tools', () => {
  let handlers: Record<string, (args: unknown) => Promise<unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const ctx = buildMockServer();
    handlers = ctx.handlers;
    registerAttributeTools(ctx.mockServer as never, {} as never, ORG_ID);
  });

  describe('list_attributes', () => {
    it('scopes to org_id and applies default limit/offset', async () => {
      executeQueryMock.mockResolvedValueOnce({ attributes: [{ id: '1' }] });
      const result = await handlers.list_attributes({});

      expect(executeQueryMock).toHaveBeenCalledTimes(1);
      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.org_id).toBe(ORG_ID);
      expect(vars.limit).toBe(100);
      expect(vars.offset).toBe(0);
      const parsed = parseResult(result) as unknown[];
      expect(parsed).toEqual([{ id: '1' }]);
    });

    it('passes explicit limit and offset', async () => {
      executeQueryMock.mockResolvedValueOnce({ attributes: [] });
      await handlers.list_attributes({ limit: 10, offset: 20 });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.limit).toBe(10);
      expect(vars.offset).toBe(20);
    });
  });

  describe('create_attribute', () => {
    it('stamps org_id on the inserted object', async () => {
      executeQueryMock.mockResolvedValueOnce({
        insert_attributes: { returning: [{ id: FAKE_UUID, attribute_name: 'tone' }] },
      });
      const result = await handlers.create_attribute({
        attribute_name: 'tone',
        attribute_type: 'scale',
        agent_id: FAKE_AGENT_ID,
      });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      const attribute = vars.attribute as Record<string, unknown>;
      expect(attribute.org_id).toBe(ORG_ID);
      expect(attribute.attribute_name).toBe('tone');
      expect(attribute.attribute_type).toBe('scale');
      // scale type default value is 50
      expect(attribute.value).toBe(50);
      expect(attribute.max_value).toBe(100);
      expect(attribute.min_value).toBe(0);
      expect(attribute.activated).toBe(true);
      expect(attribute.modifiable).toBe(true);
      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.attribute_name).toBe('tone');
    });

    it('uses provided value instead of default', async () => {
      executeQueryMock.mockResolvedValueOnce({
        insert_attributes: { returning: [{ id: FAKE_UUID }] },
      });
      await handlers.create_attribute({
        attribute_name: 'speed',
        attribute_type: 'number',
        agent_id: FAKE_AGENT_ID,
        value: 42,
        max_value: 200,
        min_value: -10,
        activated: false,
      });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      const attribute = vars.attribute as Record<string, unknown>;
      expect(attribute.value).toBe(42);
      expect(attribute.max_value).toBe(200);
      expect(attribute.min_value).toBe(-10);
      expect(attribute.activated).toBe(false);
    });
  });

  describe('update_attribute', () => {
    it('strips undefined fields from set payload', async () => {
      executeQueryMock.mockResolvedValueOnce({
        update_attributes: { returning: [{ id: FAKE_UUID, attribute_name: 'renamed' }] },
      });
      await handlers.update_attribute({
        id: FAKE_UUID,
        attribute_name: 'renamed',
        category: undefined,
        description: undefined,
      });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.org_id).toBe(ORG_ID);
      expect(vars.id).toBe(FAKE_UUID);
      const set = vars.set as Record<string, unknown>;
      expect(set.attribute_name).toBe('renamed');
      expect(set).not.toHaveProperty('category');
      expect(set).not.toHaveProperty('description');
      expect(set).toHaveProperty('updated_at');
    });

    it('returns error on not-found (empty returning)', async () => {
      executeQueryMock.mockResolvedValueOnce({
        update_attributes: { returning: [] },
      });
      const result = await handlers.update_attribute({
        id: FAKE_UUID,
        attribute_name: 'nope',
      });

      expect(isError(result)).toBe(true);
      expect(extractText(result)).toBe('Attribute not found');
    });
  });

  describe('delete_attribute', () => {
    it('scopes to org_id', async () => {
      executeQueryMock.mockResolvedValueOnce({
        delete_attributes: { returning: [{ id: FAKE_UUID, attribute_name: 'gone' }] },
      });
      const result = await handlers.delete_attribute({ id: FAKE_UUID });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.org_id).toBe(ORG_ID);
      expect(vars.id).toBe(FAKE_UUID);
      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.deleted).toEqual({ id: FAKE_UUID, attribute_name: 'gone' });
    });

    it('returns error on not-found', async () => {
      executeQueryMock.mockResolvedValueOnce({
        delete_attributes: { returning: [] },
      });
      const result = await handlers.delete_attribute({ id: FAKE_UUID });

      expect(isError(result)).toBe(true);
      expect(extractText(result)).toBe('Attribute not found');
    });
  });

  describe('import_attributes', () => {
    it('stamps org_id on each prepared attribute', async () => {
      executeQueryMock.mockResolvedValueOnce({
        insert_attributes: { returning: [{ id: '1' }, { id: '2' }], affected_rows: 2 },
      });
      await handlers.import_attributes({
        attributes: [
          { attribute_name: 'a1', attribute_type: 'string', agent_id: FAKE_AGENT_ID },
          { attribute_name: 'a2', attribute_type: 'boolean', agent_id: FAKE_AGENT_ID },
        ],
      });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      const attrs = vars.attributes as Array<Record<string, unknown>>;
      expect(attrs).toHaveLength(2);
      for (const attr of attrs) {
        expect(attr.org_id).toBe(ORG_ID);
        expect(attr.activated).toBe(true);
        expect(attr.modifiable).toBe(true);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Examples
// ---------------------------------------------------------------------------
describe('example MCP tools', () => {
  let handlers: Record<string, (args: unknown) => Promise<unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const ctx = buildMockServer();
    handlers = ctx.handlers;
    registerExampleTools(ctx.mockServer as never, {} as never, ORG_ID);
  });

  describe('list_examples', () => {
    it('scopes to org_id and applies default limits', async () => {
      executeQueryMock.mockResolvedValueOnce({ examples: [] });
      await handlers.list_examples({});

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.org_id).toBe(ORG_ID);
      expect(vars.limit).toBe(100);
      expect(vars.offset).toBe(0);
      expect(vars.message_limit).toBe(50);
    });

    it('passes custom message_limit', async () => {
      executeQueryMock.mockResolvedValueOnce({ examples: [] });
      await handlers.list_examples({ message_limit: 10 });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.message_limit).toBe(10);
    });
  });

  describe('create_example', () => {
    it('stamps org_id and applies defaults', async () => {
      executeQueryMock.mockResolvedValueOnce({
        insert_examples: { returning: [{ id: FAKE_UUID, example_name: 'refund-flow' }] },
      });
      const result = await handlers.create_example({
        example_name: 'refund-flow',
        agent_id: FAKE_AGENT_ID,
      });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      const example = vars.example as Record<string, unknown>;
      expect(example.org_id).toBe(ORG_ID);
      expect(example.example_name).toBe('refund-flow');
      expect(example.example_type).toBe('general');
      expect(example.activated).toBe(true);
      expect(example.ticket_content).toEqual({
        customer_message: '',
        sentiment: '',
        priority: '',
        tags: [],
      });
      expect(example.response_content).toEqual({
        message: '',
        tone: '',
        actions_taken: [],
        follow_up_required: false,
      });
      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.example_name).toBe('refund-flow');
    });
  });

  describe('update_example', () => {
    it('strips undefined fields', async () => {
      executeQueryMock.mockResolvedValueOnce({
        update_examples: { returning: [{ id: FAKE_UUID }] },
      });
      await handlers.update_example({
        id: FAKE_UUID,
        example_name: 'updated',
        description: undefined,
      });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.org_id).toBe(ORG_ID);
      const set = vars.set as Record<string, unknown>;
      expect(set.example_name).toBe('updated');
      expect(set).not.toHaveProperty('description');
      expect(set).toHaveProperty('updated_at');
    });

    it('returns error on not-found', async () => {
      executeQueryMock.mockResolvedValueOnce({
        update_examples: { returning: [] },
      });
      const result = await handlers.update_example({ id: FAKE_UUID, example_name: 'x' });

      expect(isError(result)).toBe(true);
      expect(extractText(result)).toBe('Example not found');
    });
  });

  describe('delete_example', () => {
    it('scopes to org_id and returns deleted record', async () => {
      executeQueryMock.mockResolvedValueOnce({
        delete_examples: { returning: [{ id: FAKE_UUID, example_name: 'gone' }] },
      });
      const result = await handlers.delete_example({ id: FAKE_UUID });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.org_id).toBe(ORG_ID);
      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.deleted).toEqual({ id: FAKE_UUID, example_name: 'gone' });
    });

    it('returns error on not-found', async () => {
      executeQueryMock.mockResolvedValueOnce({
        delete_examples: { returning: [] },
      });
      const result = await handlers.delete_example({ id: FAKE_UUID });

      expect(isError(result)).toBe(true);
      expect(extractText(result)).toBe('Example not found');
    });
  });

  describe('import_examples', () => {
    it('stamps org_id and defaults on each prepared example', async () => {
      executeQueryMock.mockResolvedValueOnce({
        insert_examples: { returning: [{ id: '1' }], affected_rows: 1 },
      });
      await handlers.import_examples({
        examples: [{ example_name: 'e1', agent_id: FAKE_AGENT_ID }],
      });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      const examples = vars.examples as Array<Record<string, unknown>>;
      expect(examples[0].org_id).toBe(ORG_ID);
      expect(examples[0].example_type).toBe('general');
      expect(examples[0].activated).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Evals
// ---------------------------------------------------------------------------
describe('eval MCP tools', () => {
  let handlers: Record<string, (args: unknown) => Promise<unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const ctx = buildMockServer();
    handlers = ctx.handlers;
    registerEvalTools(ctx.mockServer as never, {} as never, ORG_ID);
  });

  describe('list_evals', () => {
    it('scopes to org_id and applies default limit/offset', async () => {
      executeQueryMock.mockResolvedValueOnce({ evals: [] });
      await handlers.list_evals({});

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.org_id).toBe(ORG_ID);
      expect(vars.limit).toBe(100);
      expect(vars.offset).toBe(0);
    });

    it('passes explicit limit and offset', async () => {
      executeQueryMock.mockResolvedValueOnce({ evals: [{ id: 'e1' }] });
      await handlers.list_evals({ limit: 5, offset: 10 });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.limit).toBe(5);
      expect(vars.offset).toBe(10);
    });
  });

  describe('create_eval', () => {
    it('stamps org_id and applies defaults', async () => {
      executeQueryMock.mockResolvedValueOnce({
        insert_evals: { returning: [{ id: FAKE_UUID, eval_name: 'tone-check' }] },
      });
      const result = await handlers.create_eval({
        eval_name: 'tone-check',
        eval_type: 'quality',
      });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      const evalObj = vars.eval_object as Record<string, unknown>;
      expect(evalObj.org_id).toBe(ORG_ID);
      expect(evalObj.eval_name).toBe('tone-check');
      expect(evalObj.eval_type).toBe('quality');
      expect(evalObj.eval_status).toBe('pending');
      expect(evalObj.response_id).toBeNull();
      expect(evalObj.description).toBe('');
      expect(evalObj).toHaveProperty('created_at');
      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.eval_name).toBe('tone-check');
    });
  });

  describe('update_eval', () => {
    it('strips undefined fields', async () => {
      executeQueryMock.mockResolvedValueOnce({
        update_evals: { returning: [{ id: FAKE_UUID }] },
      });
      await handlers.update_eval({
        id: FAKE_UUID,
        eval_name: 'renamed',
        eval_type: undefined,
        description: undefined,
      });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.org_id).toBe(ORG_ID);
      const set = vars.set as Record<string, unknown>;
      expect(set.eval_name).toBe('renamed');
      expect(set).not.toHaveProperty('eval_type');
      expect(set).not.toHaveProperty('description');
    });

    it('returns error on not-found', async () => {
      executeQueryMock.mockResolvedValueOnce({
        update_evals: { returning: [] },
      });
      const result = await handlers.update_eval({ id: FAKE_UUID, eval_name: 'nope' });

      expect(isError(result)).toBe(true);
      expect(extractText(result)).toBe('Eval not found');
    });
  });

  describe('delete_eval', () => {
    it('scopes to org_id', async () => {
      executeQueryMock.mockResolvedValueOnce({
        delete_evals: { returning: [{ id: FAKE_UUID, eval_name: 'gone' }] },
      });
      const result = await handlers.delete_eval({ id: FAKE_UUID });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.org_id).toBe(ORG_ID);
      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.deleted).toEqual({ id: FAKE_UUID, eval_name: 'gone' });
    });

    it('returns error on not-found', async () => {
      executeQueryMock.mockResolvedValueOnce({
        delete_evals: { returning: [] },
      });
      const result = await handlers.delete_eval({ id: FAKE_UUID });

      expect(isError(result)).toBe(true);
      expect(extractText(result)).toBe('Eval not found');
    });
  });

  describe('export_evals_for_finetuning', () => {
    it('exports all evals when no ids provided', async () => {
      executeQueryMock.mockResolvedValueOnce({
        evals: [
          {
            id: FAKE_UUID,
            eval_name: 'e1',
            eval_type: 'quality',
            user_message: 'Hello',
            preferred_output: 'Hi there!',
            reason_type: 'tone',
            customer_impact: 'low',
          },
        ],
      });
      const result = await handlers.export_evals_for_finetuning({});

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.org_id).toBe(ORG_ID);
      expect(vars).not.toHaveProperty('evalIds');
      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.count).toBe(1);
      const ftData = (parsed.fineTuningData as Array<Record<string, unknown>>)[0];
      const messages = ftData.messages as Array<Record<string, string>>;
      expect(messages).toHaveLength(3);
      expect(messages[0].role).toBe('system');
      expect(messages[1].content).toBe('Hello');
      expect(messages[2].content).toBe('Hi there!');
    });

    it('passes eval_ids when provided', async () => {
      executeQueryMock.mockResolvedValueOnce({ evals: [] });
      await handlers.export_evals_for_finetuning({ eval_ids: ['id-1', 'id-2'] });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.evalIds).toEqual(['id-1', 'id-2']);
    });
  });
});

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------
describe('dataset MCP tools', () => {
  let handlers: Record<string, (args: unknown) => Promise<unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const ctx = buildMockServer();
    handlers = ctx.handlers;
    registerDatasetTools(ctx.mockServer as never, {} as never, ORG_ID);
  });

  describe('list_datasets', () => {
    it('scopes to org_id with default pagination', async () => {
      executeQueryMock.mockResolvedValueOnce({ datasets: [{ id: 'd1' }] });
      await handlers.list_datasets({});

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.org_id).toBe(ORG_ID);
      expect(vars.limit).toBe(100);
      expect(vars.offset).toBe(0);
    });
  });

  describe('get_dataset', () => {
    it('scopes to org_id and returns dataset', async () => {
      executeQueryMock.mockResolvedValueOnce({
        datasets: [{ id: FAKE_UUID, name: 'kb-1', dataset_entries: [] }],
      });
      const result = await handlers.get_dataset({ id: FAKE_UUID });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.org_id).toBe(ORG_ID);
      expect(vars.id).toBe(FAKE_UUID);
      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.name).toBe('kb-1');
    });

    it('returns error on empty array (not found)', async () => {
      executeQueryMock.mockResolvedValueOnce({ datasets: [] });
      const result = await handlers.get_dataset({ id: FAKE_UUID });

      expect(isError(result)).toBe(true);
      expect(extractText(result)).toBe('Dataset not found');
    });
  });

  describe('create_dataset', () => {
    it('stamps org_id and defaults', async () => {
      executeQueryMock.mockResolvedValueOnce({
        insert_datasets: { returning: [{ id: FAKE_UUID, name: 'faq' }] },
      });
      await handlers.create_dataset({ name: 'faq' });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      const obj = vars.object as Record<string, unknown>;
      expect(obj.org_id).toBe(ORG_ID);
      expect(obj.name).toBe('faq');
      expect(obj.status).toBe('active');
      expect(obj.entry_count).toBe(0);
      expect(obj.description).toBe('');
      expect(obj.metadata).toEqual({});
    });
  });

  describe('update_dataset', () => {
    it('strips undefined fields', async () => {
      executeQueryMock.mockResolvedValueOnce({
        update_datasets: { returning: [{ id: FAKE_UUID }] },
      });
      await handlers.update_dataset({
        id: FAKE_UUID,
        name: 'updated',
        description: undefined,
        status: undefined,
      });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.org_id).toBe(ORG_ID);
      const set = vars.set as Record<string, unknown>;
      expect(set.name).toBe('updated');
      expect(set).not.toHaveProperty('description');
      expect(set).not.toHaveProperty('status');
      expect(set).toHaveProperty('updated_at');
    });

    it('returns error on not-found', async () => {
      executeQueryMock.mockResolvedValueOnce({
        update_datasets: { returning: [] },
      });
      const result = await handlers.update_dataset({ id: FAKE_UUID, name: 'x' });

      expect(isError(result)).toBe(true);
      expect(extractText(result)).toBe('Dataset not found');
    });
  });

  describe('delete_dataset', () => {
    it('scopes to org_id and returns deleted record', async () => {
      executeQueryMock.mockResolvedValueOnce({
        delete_datasets: { returning: [{ id: FAKE_UUID, name: 'gone' }] },
      });
      const result = await handlers.delete_dataset({ id: FAKE_UUID });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.org_id).toBe(ORG_ID);
      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.deleted).toEqual({ id: FAKE_UUID, name: 'gone' });
    });

    it('returns error on not-found', async () => {
      executeQueryMock.mockResolvedValueOnce({
        delete_datasets: { returning: [] },
      });
      const result = await handlers.delete_dataset({ id: FAKE_UUID });

      expect(isError(result)).toBe(true);
      expect(extractText(result)).toBe('Dataset not found');
    });
  });

  describe('add_dataset_entry', () => {
    it('creates an entry with dataset_id and content', async () => {
      executeQueryMock.mockResolvedValueOnce({
        insert_dataset_entries: { returning: [{ id: 'entry-1', dataset_id: FAKE_UUID }] },
      });
      const result = await handlers.add_dataset_entry({
        dataset_id: FAKE_UUID,
        content: 'Some knowledge base content',
      });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      const obj = vars.object as Record<string, unknown>;
      expect(obj.dataset_id).toBe(FAKE_UUID);
      expect(obj.content).toBe('Some knowledge base content');
      expect(obj.metadata).toEqual({});
      expect(obj).toHaveProperty('created_at');
      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.dataset_id).toBe(FAKE_UUID);
    });
  });

  describe('delete_dataset_entry', () => {
    it('deletes entry by id and returns deleted record', async () => {
      executeQueryMock.mockResolvedValueOnce({
        delete_dataset_entries: { returning: [{ id: 'entry-1', dataset_id: FAKE_UUID }] },
      });
      const result = await handlers.delete_dataset_entry({ id: 'entry-1' });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.id).toBe('entry-1');
      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.deleted).toEqual({ id: 'entry-1', dataset_id: FAKE_UUID });
    });

    it('returns error on not-found', async () => {
      executeQueryMock.mockResolvedValueOnce({
        delete_dataset_entries: { returning: [] },
      });
      const result = await handlers.delete_dataset_entry({ id: 'entry-missing' });

      expect(isError(result)).toBe(true);
      expect(extractText(result)).toBe('Dataset entry not found');
    });
  });
});

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------
describe('function MCP tools', () => {
  let handlers: Record<string, (args: unknown) => Promise<unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const ctx = buildMockServer();
    handlers = ctx.handlers;
    registerFunctionTools(ctx.mockServer as never, {} as never, ORG_ID);
  });

  describe('list_functions', () => {
    it('scopes to org_id with default pagination', async () => {
      executeQueryMock.mockResolvedValueOnce({ functions: [] });
      await handlers.list_functions({});

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.org_id).toBe(ORG_ID);
      expect(vars.limit).toBe(100);
      expect(vars.offset).toBe(0);
    });
  });

  describe('create_function', () => {
    it('stamps org_id and applies defaults', async () => {
      executeQueryMock.mockResolvedValueOnce({
        insert_functions: { returning: [{ id: FAKE_UUID, function_name: 'check-order' }] },
      });
      const result = await handlers.create_function({
        function_name: 'check-order',
        agent_id: FAKE_AGENT_ID,
        endpoint: 'https://api.example.com/check',
        method: 'POST',
      });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      const fn = vars._function as Record<string, unknown>;
      expect(fn.org_id).toBe(ORG_ID);
      expect(fn.function_name).toBe('check-order');
      expect(fn.function_type).toBe('api_call');
      expect(fn.activated).toBe(true);
      expect(fn.timeout).toBe(30000);
      expect(fn.parameters).toEqual([]);
      expect(fn.authentication).toEqual({ type: 'none' });
      expect(fn.headers).toEqual({});
      expect(fn.rate_limit).toEqual({ requests_per_minute: 60 });
      expect(fn.retry_config).toEqual({
        max_attempts: 3,
        backoff: 'exponential',
        retry_on: [502, 503, 504],
      });
      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.function_name).toBe('check-order');
    });
  });

  describe('update_function', () => {
    it('strips undefined fields', async () => {
      executeQueryMock.mockResolvedValueOnce({
        update_functions: { returning: [{ id: FAKE_UUID }] },
      });
      await handlers.update_function({
        id: FAKE_UUID,
        function_name: 'renamed',
        description: undefined,
        endpoint: undefined,
      });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.org_id).toBe(ORG_ID);
      const set = vars.set as Record<string, unknown>;
      expect(set.function_name).toBe('renamed');
      expect(set).not.toHaveProperty('description');
      expect(set).not.toHaveProperty('endpoint');
      expect(set).toHaveProperty('updated_at');
    });

    it('returns error on not-found', async () => {
      executeQueryMock.mockResolvedValueOnce({
        update_functions: { returning: [] },
      });
      const result = await handlers.update_function({ id: FAKE_UUID, function_name: 'nope' });

      expect(isError(result)).toBe(true);
      expect(extractText(result)).toBe('Function not found');
    });
  });

  describe('delete_function', () => {
    it('scopes to org_id and returns deleted record', async () => {
      executeQueryMock.mockResolvedValueOnce({
        delete_functions: { returning: [{ id: FAKE_UUID, function_name: 'gone' }] },
      });
      const result = await handlers.delete_function({ id: FAKE_UUID });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.org_id).toBe(ORG_ID);
      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.deleted).toEqual({ id: FAKE_UUID, function_name: 'gone' });
    });

    it('returns error on not-found', async () => {
      executeQueryMock.mockResolvedValueOnce({
        delete_functions: { returning: [] },
      });
      const result = await handlers.delete_function({ id: FAKE_UUID });

      expect(isError(result)).toBe(true);
      expect(extractText(result)).toBe('Function not found');
    });
  });

  describe('import_functions', () => {
    it('stamps org_id on each prepared function', async () => {
      executeQueryMock.mockResolvedValueOnce({
        insert_functions: { returning: [{ id: '1' }], affected_rows: 1 },
      });
      await handlers.import_functions({
        functions: [
          {
            function_name: 'fn1',
            agent_id: FAKE_AGENT_ID,
            endpoint: 'https://api.example.com/fn1',
            method: 'GET',
          },
        ],
      });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      const fns = vars.functions as Array<Record<string, unknown>>;
      expect(fns[0].org_id).toBe(ORG_ID);
      expect(fns[0].function_type).toBe('api_call');
      expect(fns[0].activated).toBe(true);
      expect(fns[0].timeout).toBe(30000);
    });
  });
});

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------
describe('response MCP tools', () => {
  let handlers: Record<string, (args: unknown) => Promise<unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const ctx = buildMockServer();
    handlers = ctx.handlers;
    registerResponseTools(ctx.mockServer as never, {} as never, ORG_ID);
  });

  describe('list_responses', () => {
    it('scopes to org_id with default pagination', async () => {
      executeQueryMock.mockResolvedValueOnce({ responses: [] });
      await handlers.list_responses({});

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.org_id).toBe(ORG_ID);
      expect(vars.limit).toBe(50);
      expect(vars.offset).toBe(0);
    });

    it('includes channel filter in query when provided', async () => {
      executeQueryMock.mockResolvedValueOnce({ responses: [] });
      await handlers.list_responses({ channel: 'email' });

      const query = String(executeQueryMock.mock.calls[0][1]);
      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(query).toContain('$channel');
      expect(query).toContain('channel');
      expect(vars.channel).toBe('email');
    });

    it('includes rating filter in query when provided', async () => {
      executeQueryMock.mockResolvedValueOnce({ responses: [] });
      await handlers.list_responses({ rating: 'positive' });

      const query = String(executeQueryMock.mock.calls[0][1]);
      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(query).toContain('$rating');
      expect(vars.rating).toBe('positive');
    });

    it('combines channel and rating filters with _and', async () => {
      executeQueryMock.mockResolvedValueOnce({ responses: [] });
      await handlers.list_responses({ channel: 'chat', rating: 'negative' });

      const query = String(executeQueryMock.mock.calls[0][1]);
      expect(query).toContain('_and');
      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.channel).toBe('chat');
      expect(vars.rating).toBe('negative');
    });
  });

  describe('get_response', () => {
    it('scopes to org_id and returns response', async () => {
      executeQueryMock.mockResolvedValueOnce({
        responses: [{ id: FAKE_UUID, customer_message: 'Hello' }],
      });
      const result = await handlers.get_response({ id: FAKE_UUID });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.org_id).toBe(ORG_ID);
      expect(vars.id).toBe(FAKE_UUID);
      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.customer_message).toBe('Hello');
    });

    it('returns error on empty array (not found)', async () => {
      executeQueryMock.mockResolvedValueOnce({ responses: [] });
      const result = await handlers.get_response({ id: FAKE_UUID });

      expect(isError(result)).toBe(true);
      expect(extractText(result)).toBe('Response not found');
    });
  });

  describe('get_response_count', () => {
    it('scopes to org_id', async () => {
      executeQueryMock.mockResolvedValueOnce({
        responses_aggregate: { aggregate: { count: 42 } },
      });
      const result = await handlers.get_response_count({});

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.org_id).toBe(ORG_ID);
      const parsed = parseResult(result) as Record<string, unknown>;
      expect((parsed.aggregate as Record<string, unknown>).count).toBe(42);
    });
  });

  describe('bulk_update_response_ratings', () => {
    it('passes ids and rating scoped to org_id', async () => {
      executeQueryMock.mockResolvedValueOnce({
        update_responses: {
          affected_rows: 2,
          returning: [
            { id: 'r1', rating: 'positive', updated_at: '2026-01-01' },
            { id: 'r2', rating: 'positive', updated_at: '2026-01-01' },
          ],
        },
      });
      const result = await handlers.bulk_update_response_ratings({
        response_ids: ['r1', 'r2'],
        rating: 'positive',
      });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.org_id).toBe(ORG_ID);
      expect(vars.ids).toEqual(['r1', 'r2']);
      expect(vars.rating).toBe('positive');
      const parsed = parseResult(result) as Record<string, unknown>;
      expect(parsed.success).toBe(true);
      expect(parsed.affected_rows).toBe(2);
    });
  });

  describe('search_responses', () => {
    it('wraps query in ilike wildcards and scopes to org_id', async () => {
      executeQueryMock.mockResolvedValueOnce({ responses: [{ id: 'r1' }] });
      await handlers.search_responses({ query: 'refund' });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.org_id).toBe(ORG_ID);
      expect(vars.search).toBe('%refund%');
      expect(vars.limit).toBe(20);
    });

    it('passes custom limit', async () => {
      executeQueryMock.mockResolvedValueOnce({ responses: [] });
      await handlers.search_responses({ query: 'hello', limit: 5 });

      const vars = executeQueryMock.mock.calls[0][2] as Record<string, unknown>;
      expect(vars.limit).toBe(5);
    });
  });
});
