/**
 * Tests for validation schemas
 */
import { describe, it, expect } from 'vitest';
import {
  metadataSchema,
  conditionsSchema,
  actionsSchema,
  parametersSchema,
  authenticationSchema,
  headersSchema,
  safeUrlSchema,
  attributeValueSchema,
  ticketContentSchema,
  responseContentSchema,
  bulkIdsSchema,
  paginationLimit,
  paginationOffset,
  MAX_STRING_LENGTH,
  MAX_ARRAY_LENGTH,
} from '../lib/validation.js';

describe('metadataSchema', () => {
  it('accepts valid metadata', () => {
    const result = metadataSchema.safeParse({
      key1: 'string value',
      key2: 123,
      key3: true,
      key4: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object', () => {
    const result = metadataSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts undefined', () => {
    const result = metadataSchema.safeParse(undefined);
    expect(result.success).toBe(true);
  });

  it('rejects nested objects', () => {
    const result = metadataSchema.safeParse({
      nested: { foo: 'bar' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects arrays as values', () => {
    const result = metadataSchema.safeParse({
      arr: [1, 2, 3],
    });
    expect(result.success).toBe(false);
  });

  it('rejects values exceeding max length', () => {
    const result = metadataSchema.safeParse({
      key: 'x'.repeat(MAX_STRING_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });
});

describe('conditionsSchema', () => {
  it('accepts valid conditions with "any"', () => {
    const result = conditionsSchema.safeParse({
      any: [
        { field: 'message', operator: 'contains', value: 'hello' },
        { field: 'priority', operator: 'eq', value: 'high' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid conditions with "all"', () => {
    const result = conditionsSchema.safeParse({
      all: [
        { field: 'status', operator: 'eq', value: 'open' },
        { field: 'priority', operator: 'gt', value: 5 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts conditions with both "any" and "all"', () => {
    const result = conditionsSchema.safeParse({
      any: [{ field: 'a', operator: 'eq', value: 1 }],
      all: [{ field: 'b', operator: 'neq', value: 2 }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object', () => {
    const result = conditionsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts undefined', () => {
    const result = conditionsSchema.safeParse(undefined);
    expect(result.success).toBe(true);
  });

  it('rejects invalid operator', () => {
    const result = conditionsSchema.safeParse({
      any: [{ field: 'test', operator: 'invalid_op', value: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects field name too long', () => {
    const result = conditionsSchema.safeParse({
      any: [{ field: 'x'.repeat(101), operator: 'eq', value: 'test' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects too many conditions', () => {
    const conditions = Array(21).fill({ field: 'test', operator: 'eq', value: 1 });
    const result = conditionsSchema.safeParse({ any: conditions });
    expect(result.success).toBe(false);
  });

  it('accepts array values for "in" operator', () => {
    const result = conditionsSchema.safeParse({
      any: [{ field: 'status', operator: 'in', value: ['open', 'pending', 'resolved'] }],
    });
    expect(result.success).toBe(true);
  });
});

describe('actionsSchema', () => {
  it('accepts valid actions', () => {
    const result = actionsSchema.safeParse([
      { type: 'send_message', params: { message: 'Hello!' } },
      { type: 'update_field', params: { field: 'status', value: 'resolved' } },
    ]);
    expect(result.success).toBe(true);
  });

  it('accepts actions with order', () => {
    const result = actionsSchema.safeParse([
      { type: 'action1', params: {}, order: 1 },
      { type: 'action2', params: {}, order: 2 },
    ]);
    expect(result.success).toBe(true);
  });

  it('accepts empty array', () => {
    const result = actionsSchema.safeParse([]);
    expect(result.success).toBe(true);
  });

  it('accepts undefined', () => {
    const result = actionsSchema.safeParse(undefined);
    expect(result.success).toBe(true);
  });

  it('rejects action type too long', () => {
    const result = actionsSchema.safeParse([{ type: 'x'.repeat(51), params: {} }]);
    expect(result.success).toBe(false);
  });

  it('rejects too many actions', () => {
    const actions = Array(21).fill({ type: 'test', params: {} });
    const result = actionsSchema.safeParse(actions);
    expect(result.success).toBe(false);
  });
});

describe('parametersSchema', () => {
  it('accepts valid parameters', () => {
    const result = parametersSchema.safeParse([
      { name: 'order_id', type: 'string', required: true, description: 'Order ID' },
      { name: 'limit', type: 'number', required: false, default: 10 },
    ]);
    expect(result.success).toBe(true);
  });

  it('accepts empty array', () => {
    const result = parametersSchema.safeParse([]);
    expect(result.success).toBe(true);
  });

  it('rejects invalid parameter type', () => {
    const result = parametersSchema.safeParse([
      { name: 'test', type: 'invalid_type', required: true },
    ]);
    expect(result.success).toBe(false);
  });

  it('rejects too many parameters', () => {
    const params = Array(51).fill({ name: 'p', type: 'string' });
    const result = parametersSchema.safeParse(params);
    expect(result.success).toBe(false);
  });
});

describe('authenticationSchema', () => {
  it('accepts bearer auth', () => {
    const result = authenticationSchema.safeParse({
      type: 'bearer',
      token: 'my-token-123',
    });
    expect(result.success).toBe(true);
  });

  it('accepts api_key auth', () => {
    const result = authenticationSchema.safeParse({
      type: 'api_key',
      api_key: 'key-123',
      api_key_header: 'X-API-Key',
    });
    expect(result.success).toBe(true);
  });

  it('accepts basic auth', () => {
    const result = authenticationSchema.safeParse({
      type: 'basic',
      username: 'user',
      password: 'pass',
    });
    expect(result.success).toBe(true);
  });

  it('accepts none auth', () => {
    const result = authenticationSchema.safeParse({ type: 'none' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid auth type', () => {
    const result = authenticationSchema.safeParse({ type: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('accepts undefined', () => {
    const result = authenticationSchema.safeParse(undefined);
    expect(result.success).toBe(true);
  });
});

describe('headersSchema', () => {
  it('accepts valid headers', () => {
    const result = headersSchema.safeParse({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Custom-Header': 'value',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object', () => {
    const result = headersSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects header name too long', () => {
    const result = headersSchema.safeParse({
      ['x'.repeat(101)]: 'value',
    });
    expect(result.success).toBe(false);
  });

  it('rejects header value too long', () => {
    const result = headersSchema.safeParse({
      Header: 'x'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });
});

describe('safeUrlSchema', () => {
  it('accepts valid public URLs', () => {
    const urls = [
      'https://api.example.com/endpoint',
      'https://example.com/path/to/resource',
      'http://api.production.com/v1/data',
    ];

    for (const url of urls) {
      const result = safeUrlSchema.safeParse(url);
      expect(result.success, `Expected ${url} to be valid`).toBe(true);
    }
  });

  it('rejects localhost', () => {
    const urls = ['http://localhost:3000/api', 'https://localhost/endpoint', 'http://localhost'];

    for (const url of urls) {
      const result = safeUrlSchema.safeParse(url);
      expect(result.success, `Expected ${url} to be rejected`).toBe(false);
    }
  });

  it('rejects 127.0.0.1', () => {
    const result = safeUrlSchema.safeParse('http://127.0.0.1/api');
    expect(result.success).toBe(false);
  });

  it('rejects private IP ranges', () => {
    const privateUrls = [
      'http://192.168.1.1/api',
      'http://10.0.0.1/api',
      'http://172.16.0.1/api',
      'http://172.31.255.255/api',
    ];

    for (const url of privateUrls) {
      const result = safeUrlSchema.safeParse(url);
      expect(result.success, `Expected ${url} to be rejected`).toBe(false);
    }
  });

  it('rejects non-http protocols', () => {
    const urls = ['ftp://example.com/file', 'file:///etc/passwd', 'javascript:alert(1)'];

    for (const url of urls) {
      const result = safeUrlSchema.safeParse(url);
      expect(result.success, `Expected ${url} to be rejected`).toBe(false);
    }
  });

  it('rejects invalid URLs', () => {
    const result = safeUrlSchema.safeParse('not-a-valid-url');
    expect(result.success).toBe(false);
  });

  it('rejects URLs exceeding max length', () => {
    const longUrl = 'https://example.com/' + 'x'.repeat(2050);
    const result = safeUrlSchema.safeParse(longUrl);
    expect(result.success).toBe(false);
  });
});

describe('attributeValueSchema', () => {
  it('accepts string', () => {
    const result = attributeValueSchema.safeParse('test value');
    expect(result.success).toBe(true);
  });

  it('accepts number', () => {
    const result = attributeValueSchema.safeParse(42);
    expect(result.success).toBe(true);
  });

  it('accepts boolean', () => {
    const result = attributeValueSchema.safeParse(true);
    expect(result.success).toBe(true);
  });

  it('accepts null', () => {
    const result = attributeValueSchema.safeParse(null);
    expect(result.success).toBe(true);
  });

  it('accepts undefined', () => {
    const result = attributeValueSchema.safeParse(undefined);
    expect(result.success).toBe(true);
  });

  it('rejects objects', () => {
    const result = attributeValueSchema.safeParse({ foo: 'bar' });
    expect(result.success).toBe(false);
  });

  it('rejects arrays', () => {
    const result = attributeValueSchema.safeParse([1, 2, 3]);
    expect(result.success).toBe(false);
  });
});

describe('ticketContentSchema', () => {
  it('accepts valid ticket content', () => {
    const result = ticketContentSchema.safeParse({
      customer_message: 'I need help with my order',
      sentiment: 'neutral',
      priority: 'high',
      tags: ['order', 'urgent'],
      category: 'support',
      language: 'en',
    });
    expect(result.success).toBe(true);
  });

  it('accepts partial ticket content', () => {
    const result = ticketContentSchema.safeParse({
      customer_message: 'Hello',
    });
    expect(result.success).toBe(true);
  });

  it('accepts undefined', () => {
    const result = ticketContentSchema.safeParse(undefined);
    expect(result.success).toBe(true);
  });

  it('rejects too many tags', () => {
    const result = ticketContentSchema.safeParse({
      tags: Array(21).fill('tag'),
    });
    expect(result.success).toBe(false);
  });
});

describe('responseContentSchema', () => {
  it('accepts valid response content', () => {
    const result = responseContentSchema.safeParse({
      message: 'Thank you for contacting us',
      tone: 'professional',
      actions_taken: ['created_ticket', 'sent_notification'],
      follow_up_required: true,
      resolution_status: 'pending',
    });
    expect(result.success).toBe(true);
  });

  it('accepts undefined', () => {
    const result = responseContentSchema.safeParse(undefined);
    expect(result.success).toBe(true);
  });
});

describe('bulkIdsSchema', () => {
  it('accepts valid UUIDs', () => {
    const result = bulkIdsSchema.safeParse([
      '123e4567-e89b-12d3-a456-426614174000',
      '223e4567-e89b-12d3-a456-426614174001',
    ]);
    expect(result.success).toBe(true);
  });

  it('rejects empty array', () => {
    const result = bulkIdsSchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID strings', () => {
    const result = bulkIdsSchema.safeParse(['not-a-uuid', 'also-not-uuid']);
    expect(result.success).toBe(false);
  });

  it('rejects too many IDs', () => {
    const ids = Array(MAX_ARRAY_LENGTH + 1).fill('123e4567-e89b-12d3-a456-426614174000');
    const result = bulkIdsSchema.safeParse(ids);
    expect(result.success).toBe(false);
  });
});

describe('paginationLimit', () => {
  it('accepts valid limit', () => {
    expect(paginationLimit.safeParse(50).success).toBe(true);
    expect(paginationLimit.safeParse(1).success).toBe(true);
    expect(paginationLimit.safeParse(1000).success).toBe(true);
  });

  it('accepts undefined', () => {
    expect(paginationLimit.safeParse(undefined).success).toBe(true);
  });

  it('rejects zero', () => {
    expect(paginationLimit.safeParse(0).success).toBe(false);
  });

  it('rejects values over 1000', () => {
    expect(paginationLimit.safeParse(1001).success).toBe(false);
  });

  it('rejects negative values', () => {
    expect(paginationLimit.safeParse(-1).success).toBe(false);
  });

  it('rejects non-integers', () => {
    expect(paginationLimit.safeParse(50.5).success).toBe(false);
  });
});

describe('paginationOffset', () => {
  it('accepts valid offset', () => {
    expect(paginationOffset.safeParse(0).success).toBe(true);
    expect(paginationOffset.safeParse(100).success).toBe(true);
    expect(paginationOffset.safeParse(100000).success).toBe(true);
  });

  it('accepts undefined', () => {
    expect(paginationOffset.safeParse(undefined).success).toBe(true);
  });

  it('rejects negative values', () => {
    expect(paginationOffset.safeParse(-1).success).toBe(false);
  });

  it('rejects values over 100000', () => {
    expect(paginationOffset.safeParse(100001).success).toBe(false);
  });
});
