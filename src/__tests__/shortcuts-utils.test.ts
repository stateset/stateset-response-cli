import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseDateInput,
  stableStringify,
  parseOptionLike,
  parseCommandArgs,
  parsePeriodRangeAsIso,
  parseDateRange,
  isInDateRange,
  extractAggregateCount,
  coerceOrgExportPayload,
  buildDiffRows,
  asStringRecord,
  asRecordArray,
  toDisplayValue,
  stripQuotes,
  toPositiveInteger,
  toNonNegativeInteger,
  parsePositiveIntegerOption,
  extractEntityRows,
  extractEntityId,
  normalizeSnapshotRef,
  isCurrentSnapshotReference,
  isLatestSnapshotReference,
  parseDiffRefs,
  formatImportCounts,
  coerceResourceArray,
  toLines,
  nowSuffix,
} from '../cli/shortcuts/utils.js';
import type { OrgExport, ImportResult } from '../cli/shortcuts/utils.js';

// =============================================================================
// parseDateInput
// =============================================================================

describe('parseDateInput', () => {
  it('returns undefined for empty input', () => {
    expect(parseDateInput(undefined)).toBeUndefined();
    expect(parseDateInput('')).toBeUndefined();
    expect(parseDateInput('   ')).toBeUndefined();
  });

  it('returns now for "now" keyword', () => {
    const before = Date.now();
    const result = parseDateInput('now');
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it('returns now for "today" keyword', () => {
    const result = parseDateInput('today');
    expect(result).toBeDefined();
    expect(Math.abs(result! - Date.now())).toBeLessThan(100);
  });

  it('returns now for "current" keyword', () => {
    const result = parseDateInput('current');
    expect(result).toBeDefined();
  });

  it('handles relative time with days', () => {
    const before = Date.now();
    const result = parseDateInput('-7d');
    expect(result).toBeDefined();
    expect(result!).toBeLessThan(before);
    expect(Math.abs(result! - (before - 7 * 86_400_000))).toBeLessThan(100);
  });

  it('handles relative time with hours', () => {
    const before = Date.now();
    const result = parseDateInput('-2h');
    expect(result).toBeDefined();
    expect(Math.abs(result! - (before - 2 * 3_600_000))).toBeLessThan(100);
  });

  it('handles relative time with minutes', () => {
    const before = Date.now();
    const result = parseDateInput('-30m');
    expect(result).toBeDefined();
    expect(Math.abs(result! - (before - 30 * 60_000))).toBeLessThan(100);
  });

  it('handles relative time with seconds', () => {
    const before = Date.now();
    const result = parseDateInput('-10s');
    expect(result).toBeDefined();
    expect(Math.abs(result! - (before - 10_000))).toBeLessThan(100);
  });

  it('handles relative time with weeks', () => {
    const before = Date.now();
    const result = parseDateInput('-1w');
    expect(result).toBeDefined();
    expect(Math.abs(result! - (before - 604_800_000))).toBeLessThan(100);
  });

  it('handles positive relative time', () => {
    const before = Date.now();
    const result = parseDateInput('+1d');
    expect(result).toBeDefined();
    expect(result!).toBeGreaterThan(before);
  });

  it('parses ISO date strings', () => {
    const result = parseDateInput('2024-01-15');
    expect(result).toBeDefined();
    expect(result).toBe(Date.parse('2024-01-15'));
  });

  it('parses ISO datetime strings', () => {
    const result = parseDateInput('2024-01-15T10:30:00Z');
    expect(result).toBe(Date.parse('2024-01-15T10:30:00Z'));
  });

  it('returns undefined for invalid date', () => {
    expect(parseDateInput('not-a-date')).toBeUndefined();
    expect(parseDateInput('abc123')).toBeUndefined();
  });
});

// =============================================================================
// stableStringify
// =============================================================================

describe('stableStringify', () => {
  it('stringifies primitives', () => {
    expect(stableStringify(42)).toBe('42');
    expect(stableStringify('hello')).toBe('"hello"');
    expect(stableStringify(true)).toBe('true');
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(undefined)).toBe(undefined); // JSON.stringify(undefined) returns undefined
  });

  it('sorts object keys', () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(stableStringify({ z: 'z', a: 'a', m: 'm' })).toBe('{"a":"a","m":"m","z":"z"}');
  });

  it('handles nested objects with sorted keys', () => {
    expect(stableStringify({ b: { d: 1, c: 2 }, a: 3 })).toBe('{"a":3,"b":{"c":2,"d":1}}');
  });

  it('handles arrays', () => {
    expect(stableStringify([1, 2, 3])).toBe('[1,2,3]');
    expect(stableStringify(['b', 'a'])).toBe('["b","a"]');
  });

  it('handles arrays of objects', () => {
    expect(stableStringify([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it('handles empty containers', () => {
    expect(stableStringify({})).toBe('{}');
    expect(stableStringify([])).toBe('[]');
  });
});

// =============================================================================
// parseOptionLike
// =============================================================================

describe('parseOptionLike', () => {
  it('splits key=value', () => {
    expect(parseOptionLike('limit=10')).toEqual(['limit', '10']);
  });

  it('returns null for value when no separator', () => {
    expect(parseOptionLike('--json')).toEqual(['--json', null]);
  });

  it('handles empty value after separator', () => {
    expect(parseOptionLike('key=')).toEqual(['key', '']);
  });

  it('handles multiple equals signs', () => {
    expect(parseOptionLike('key=val=ue')).toEqual(['key', 'val=ue']);
  });
});

// =============================================================================
// parseCommandArgs
// =============================================================================

describe('parseCommandArgs', () => {
  it('separates positionals and options', () => {
    const result = parseCommandArgs(['list', '--limit', '10']);
    expect(result.positionals).toEqual(['list']);
    expect(result.options.limit).toBe('10');
  });

  it('handles inline option values', () => {
    const result = parseCommandArgs(['--limit=20', 'arg1']);
    expect(result.options.limit).toBe('20');
    expect(result.positionals).toEqual(['arg1']);
  });

  it('handles boolean flags (--json, --help, --yes)', () => {
    const result = parseCommandArgs(['--json', '--help', '--yes']);
    expect(result.options.json).toBe('true');
    expect(result.options.help).toBe('true');
    expect(result.options.yes).toBe('true');
  });

  it('throws for missing option value', () => {
    expect(() => parseCommandArgs(['--limit'])).toThrow('Missing value for option --limit.');
  });

  it('handles empty tokens', () => {
    const result = parseCommandArgs([]);
    expect(result.positionals).toEqual([]);
    expect(result.options).toEqual({});
  });

  it('handles multiple positionals', () => {
    const result = parseCommandArgs(['create', 'my-agent', '--json']);
    expect(result.positionals).toEqual(['create', 'my-agent']);
    expect(result.options.json).toBe('true');
  });
});

// =============================================================================
// parsePeriodRangeAsIso
// =============================================================================

describe('parsePeriodRangeAsIso', () => {
  it('returns undefined for empty input', () => {
    expect(parsePeriodRangeAsIso(undefined)).toBeUndefined();
    expect(parsePeriodRangeAsIso('')).toBeUndefined();
  });

  it('parses valid period string to ISO', () => {
    const result = parsePeriodRangeAsIso('7d');
    expect(result).toBeDefined();
    expect(new Date(result!).getTime()).toBeLessThan(Date.now());
  });

  it('returns undefined for invalid period format', () => {
    expect(parsePeriodRangeAsIso('abc')).toBeUndefined();
    expect(parsePeriodRangeAsIso('7x')).toBeUndefined();
  });

  it('handles various period units', () => {
    expect(parsePeriodRangeAsIso('30m')).toBeDefined();
    expect(parsePeriodRangeAsIso('24h')).toBeDefined();
    expect(parsePeriodRangeAsIso('1w')).toBeDefined();
  });
});

// =============================================================================
// parseDateRange
// =============================================================================

describe('parseDateRange', () => {
  it('returns empty warnings when no input', () => {
    const result = parseDateRange(undefined, undefined);
    expect(result.warnings).toEqual([]);
    expect(result.from).toBeUndefined();
    expect(result.to).toBeUndefined();
  });

  it('parses valid from date', () => {
    const result = parseDateRange('2024-01-01', undefined);
    expect(result.from).toBe(Date.parse('2024-01-01'));
    expect(result.warnings).toEqual([]);
  });

  it('parses valid to date', () => {
    const result = parseDateRange(undefined, '2024-12-31');
    expect(result.to).toBe(Date.parse('2024-12-31'));
    expect(result.warnings).toEqual([]);
  });

  it('warns for invalid from date', () => {
    const result = parseDateRange('not-valid', undefined);
    expect(result.from).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('--from');
  });

  it('warns for invalid to date', () => {
    const result = parseDateRange(undefined, 'not-valid');
    expect(result.to).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('--to');
  });

  it('clears range and warns when from is after to', () => {
    const result = parseDateRange('2024-12-31', '2024-01-01');
    expect(result.from).toBeUndefined();
    expect(result.to).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('after');
  });
});

// =============================================================================
// isInDateRange
// =============================================================================

describe('isInDateRange', () => {
  it('returns true when no range specified', () => {
    expect(isInDateRange('2024-06-15')).toBe(true);
  });

  it('returns false for non-string value', () => {
    expect(isInDateRange(42, 0, Date.now())).toBe(false);
    expect(isInDateRange(null, 0, Date.now())).toBe(false);
  });

  it('returns false for unparseable date string', () => {
    expect(isInDateRange('not-a-date', 0, Date.now())).toBe(false);
  });

  it('returns true when value is in range', () => {
    const from = Date.parse('2024-01-01');
    const to = Date.parse('2024-12-31');
    expect(isInDateRange('2024-06-15', from, to)).toBe(true);
  });

  it('returns false when value is before from', () => {
    const from = Date.parse('2024-06-01');
    expect(isInDateRange('2024-01-01', from)).toBe(false);
  });

  it('returns false when value is after to', () => {
    const to = Date.parse('2024-06-01');
    expect(isInDateRange('2024-12-31', undefined, to)).toBe(false);
  });
});

// =============================================================================
// extractAggregateCount
// =============================================================================

describe('extractAggregateCount', () => {
  it('extracts count from nested collection aggregate', () => {
    const payload = { messages: { aggregate: { count: 42 } } };
    expect(extractAggregateCount(payload, 'messages')).toBe(42);
  });

  it('falls back to root aggregate', () => {
    const payload = { aggregate: { count: 10 } };
    expect(extractAggregateCount(payload, 'messages')).toBe(10);
  });

  it('returns 0 when no count found', () => {
    expect(extractAggregateCount({}, 'messages')).toBe(0);
    expect(extractAggregateCount(null, 'messages')).toBe(0);
  });

  it('returns 0 for non-numeric count', () => {
    const payload = { messages: { aggregate: { count: 'many' } } };
    expect(extractAggregateCount(payload, 'messages')).toBe(0);
  });

  it('returns 0 for non-finite count', () => {
    const payload = { messages: { aggregate: { count: Infinity } } };
    expect(extractAggregateCount(payload, 'messages')).toBe(0);
  });
});

// =============================================================================
// coerceOrgExportPayload
// =============================================================================

describe('coerceOrgExportPayload', () => {
  it('coerces minimal object to OrgExport', () => {
    const result = coerceOrgExportPayload({});
    expect(result.version).toBe('1.0.0');
    expect(result.orgId).toBe('unknown');
    expect(result.agents).toEqual([]);
    expect(result.rules).toEqual([]);
  });

  it('preserves valid version and orgId', () => {
    const result = coerceOrgExportPayload({ version: '2.0.0', orgId: 'org-123' });
    expect(result.version).toBe('2.0.0');
    expect(result.orgId).toBe('org-123');
  });

  it('coerces arrays for all resource fields', () => {
    const result = coerceOrgExportPayload({
      agents: [{ id: '1' }],
      rules: [{ id: '2' }],
    });
    expect(result.agents).toEqual([{ id: '1' }]);
    expect(result.rules).toEqual([{ id: '2' }]);
  });

  it('throws for null payload', () => {
    expect(() => coerceOrgExportPayload(null)).toThrow('not an object');
  });

  it('throws for non-object payload', () => {
    expect(() => coerceOrgExportPayload('string')).toThrow('not an object');
  });

  it('uses agent_settings as fallback for agentSettings', () => {
    const result = coerceOrgExportPayload({ agent_settings: [{ id: '1' }] });
    expect(result.agentSettings).toEqual([{ id: '1' }]);
  });
});

// =============================================================================
// buildDiffRows
// =============================================================================

describe('buildDiffRows', () => {
  const makeExport = (overrides: Partial<OrgExport> = {}): OrgExport => ({
    version: '1.0.0',
    orgId: 'test',
    exportedAt: new Date().toISOString(),
    agents: [],
    rules: [],
    skills: [],
    attributes: [],
    functions: [],
    examples: [],
    evals: [],
    datasets: [],
    agentSettings: [],
    ...overrides,
  });

  it('detects added items', () => {
    const before = makeExport({ agents: [] });
    const after = makeExport({ agents: [{ id: 'agent-1', name: 'Test' }] });
    const rows = buildDiffRows(before, after);
    const agentRow = rows.find((r) => r.collection === 'agents');
    expect(agentRow).toBeDefined();
    expect(agentRow!.added).toBe(1);
    expect(agentRow!.removed).toBe(0);
    expect(agentRow!.changed).toBe(0);
  });

  it('detects removed items', () => {
    const before = makeExport({ rules: [{ id: 'rule-1' }] });
    const after = makeExport({ rules: [] });
    const rows = buildDiffRows(before, after);
    const ruleRow = rows.find((r) => r.collection === 'rules');
    expect(ruleRow!.removed).toBe(1);
    expect(ruleRow!.added).toBe(0);
  });

  it('detects changed items', () => {
    const before = makeExport({ agents: [{ id: 'a1', name: 'Before' }] });
    const after = makeExport({ agents: [{ id: 'a1', name: 'After' }] });
    const rows = buildDiffRows(before, after);
    const agentRow = rows.find((r) => r.collection === 'agents');
    expect(agentRow!.changed).toBe(1);
    expect(agentRow!.added).toBe(0);
    expect(agentRow!.removed).toBe(0);
  });

  it('handles identical exports', () => {
    const data = makeExport({ agents: [{ id: 'a1', name: 'Same' }] });
    const rows = buildDiffRows(data, data);
    for (const row of rows) {
      expect(row.added).toBe(0);
      expect(row.removed).toBe(0);
      expect(row.changed).toBe(0);
    }
  });
});

// =============================================================================
// asStringRecord / asRecordArray / toDisplayValue / stripQuotes
// =============================================================================

describe('asStringRecord', () => {
  it('returns object as-is', () => {
    const obj = { a: 1 };
    expect(asStringRecord(obj)).toBe(obj);
  });

  it('returns empty object for non-objects', () => {
    expect(asStringRecord(null)).toEqual({});
    expect(asStringRecord(42)).toEqual({});
    expect(asStringRecord('str')).toEqual({});
    expect(asStringRecord([1, 2])).toEqual({});
  });
});

describe('asRecordArray', () => {
  it('filters to valid record entries', () => {
    const result = asRecordArray([{ id: '1' }, null, 42, { id: '2' }]);
    expect(result).toEqual([{ id: '1' }, { id: '2' }]);
  });

  it('returns empty for non-array', () => {
    expect(asRecordArray('hello')).toEqual([]);
    expect(asRecordArray(null)).toEqual([]);
  });

  it('filters out arrays within the array', () => {
    expect(asRecordArray([[1, 2], { id: '1' }])).toEqual([{ id: '1' }]);
  });
});

describe('toDisplayValue', () => {
  it('returns "-" for null/undefined', () => {
    expect(toDisplayValue(null)).toBe('-');
    expect(toDisplayValue(undefined)).toBe('-');
  });

  it('converts primitives to string', () => {
    expect(toDisplayValue('hello')).toBe('hello');
    expect(toDisplayValue(42)).toBe('42');
    expect(toDisplayValue(true)).toBe('true');
  });

  it('JSON-stringifies objects', () => {
    expect(toDisplayValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe('stripQuotes', () => {
  it('strips double quotes', () => {
    expect(stripQuotes('"hello"')).toBe('hello');
  });

  it('strips single quotes', () => {
    expect(stripQuotes("'hello'")).toBe('hello');
  });

  it('trims whitespace', () => {
    expect(stripQuotes('  hello  ')).toBe('hello');
  });

  it('does not strip mismatched quotes', () => {
    expect(stripQuotes('"hello\'')).toBe('"hello\'');
  });

  it('does not strip unquoted text', () => {
    expect(stripQuotes('hello')).toBe('hello');
  });
});

// =============================================================================
// toPositiveInteger / toNonNegativeInteger / parsePositiveIntegerOption
// =============================================================================

describe('toPositiveInteger', () => {
  it('returns fallback for empty input', () => {
    expect(toPositiveInteger(undefined, 10, 100)).toBe(10);
  });

  it('parses valid integer', () => {
    expect(toPositiveInteger('5', 10, 100)).toBe(5);
  });

  it('clamps to max', () => {
    expect(toPositiveInteger('200', 10, 100)).toBe(100);
  });

  it('returns fallback for non-integer', () => {
    expect(toPositiveInteger('5.5', 10, 100)).toBe(10);
  });

  it('returns fallback for zero', () => {
    expect(toPositiveInteger('0', 10, 100)).toBe(10);
  });

  it('returns fallback for negative', () => {
    expect(toPositiveInteger('-5', 10, 100)).toBe(10);
  });

  it('returns fallback for non-numeric', () => {
    expect(toPositiveInteger('abc', 10, 100)).toBe(10);
  });
});

describe('toNonNegativeInteger', () => {
  it('returns fallback for empty input', () => {
    expect(toNonNegativeInteger(undefined, 0, 100)).toBe(0);
  });

  it('accepts zero', () => {
    expect(toNonNegativeInteger('0', 5, 100)).toBe(0);
  });

  it('parses valid positive integer', () => {
    expect(toNonNegativeInteger('10', 0, 100)).toBe(10);
  });

  it('clamps to max', () => {
    expect(toNonNegativeInteger('500', 0, 100)).toBe(100);
  });

  it('returns fallback for negative', () => {
    expect(toNonNegativeInteger('-1', 0, 100)).toBe(0);
  });
});

describe('parsePositiveIntegerOption', () => {
  it('returns undefined for empty input', () => {
    expect(parsePositiveIntegerOption(undefined)).toBeUndefined();
    expect(parsePositiveIntegerOption('')).toBeUndefined();
  });

  it('parses valid positive integer', () => {
    expect(parsePositiveIntegerOption('5')).toBe(5);
  });

  it('returns undefined for zero', () => {
    expect(parsePositiveIntegerOption('0')).toBeUndefined();
  });

  it('returns undefined for negative', () => {
    expect(parsePositiveIntegerOption('-1')).toBeUndefined();
  });

  it('parses integer part from float string (parseInt behavior)', () => {
    // parseInt('3.5', 10) returns 3 which is a valid positive integer
    expect(parsePositiveIntegerOption('3.5')).toBe(3);
  });
});

// =============================================================================
// extractEntityRows / extractEntityId
// =============================================================================

describe('extractEntityRows', () => {
  it('returns empty for non-array', () => {
    expect(extractEntityRows('hello')).toEqual([]);
    expect(extractEntityRows(null)).toEqual([]);
  });

  it('filters to valid records', () => {
    expect(extractEntityRows([{ id: '1' }, null, 42])).toEqual([{ id: '1' }]);
  });
});

describe('extractEntityId', () => {
  it('uses id field', () => {
    expect(extractEntityId({ id: 'abc' }, 0)).toBe('abc');
  });

  it('falls back to uuid', () => {
    expect(extractEntityId({ uuid: 'xyz' }, 0)).toBe('xyz');
  });

  it('falls back to agent_name', () => {
    expect(extractEntityId({ agent_name: 'bot' }, 0)).toBe('agent:bot');
  });

  it('falls back to rule_name', () => {
    expect(extractEntityId({ rule_name: 'r1' }, 0)).toBe('rule:r1');
  });

  it('falls back to name', () => {
    expect(extractEntityId({ name: 'test' }, 0)).toBe('name:test');
  });

  it('falls back to index', () => {
    expect(extractEntityId({}, 3)).toBe('index:3');
  });
});

// =============================================================================
// normalizeSnapshotRef / isCurrentSnapshotReference / isLatestSnapshotReference
// =============================================================================

describe('normalizeSnapshotRef', () => {
  it('returns empty string for undefined', () => {
    expect(normalizeSnapshotRef()).toBe('');
    expect(normalizeSnapshotRef(undefined)).toBe('');
  });

  it('trims whitespace', () => {
    expect(normalizeSnapshotRef('  latest  ')).toBe('latest');
  });
});

describe('isCurrentSnapshotReference', () => {
  it('matches current/live/remote', () => {
    expect(isCurrentSnapshotReference('current')).toBe(true);
    expect(isCurrentSnapshotReference('live')).toBe(true);
    expect(isCurrentSnapshotReference('remote')).toBe(true);
    expect(isCurrentSnapshotReference('Current')).toBe(true);
  });

  it('does not match others', () => {
    expect(isCurrentSnapshotReference('latest')).toBe(false);
    expect(isCurrentSnapshotReference('snapshot-1')).toBe(false);
  });
});

describe('isLatestSnapshotReference', () => {
  it('matches latest', () => {
    expect(isLatestSnapshotReference('latest')).toBe(true);
    expect(isLatestSnapshotReference('Latest')).toBe(true);
  });

  it('does not match others', () => {
    expect(isLatestSnapshotReference('current')).toBe(false);
  });
});

// =============================================================================
// parseDiffRefs
// =============================================================================

describe('parseDiffRefs', () => {
  it('uses from/to when both provided', () => {
    expect(parseDiffRefs([], 'a', 'b')).toEqual({ from: 'a', to: 'b' });
  });

  it('falls back to positional args', () => {
    expect(parseDiffRefs(['snap1', 'snap2'])).toEqual({ from: 'snap1', to: 'snap2' });
  });

  it('single positional defaults from to latest', () => {
    expect(parseDiffRefs(['snap1'])).toEqual({ from: 'latest', to: 'snap1' });
  });

  it('no args defaults to latest vs current', () => {
    expect(parseDiffRefs([])).toEqual({ from: 'latest', to: 'current' });
  });

  it('uses from and defaults to when only from provided', () => {
    expect(parseDiffRefs([], 'x')).toEqual({ from: 'x', to: 'current' });
  });

  it('uses to and defaults from when only to provided', () => {
    expect(parseDiffRefs([], undefined, 'y')).toEqual({ from: 'latest', to: 'y' });
  });
});

// =============================================================================
// formatImportCounts
// =============================================================================

describe('formatImportCounts', () => {
  it('formats nonzero counts', () => {
    const result = { agents: 3, rules: 2 } as unknown as ImportResult;
    const formatted = formatImportCounts(result);
    expect(formatted).toContain('3 agents');
    expect(formatted).toContain('2 rules');
  });

  it('returns "nothing" for zero counts', () => {
    const result = {
      agents: 0,
      rules: 0,
      skills: 0,
      attributes: 0,
      functions: 0,
      examples: 0,
      evals: 0,
      datasets: 0,
      datasetEntries: 0,
      agentSettings: 0,
      skipped: 0,
      failures: [],
      sourceOrgId: 'test',
    } as ImportResult;
    expect(formatImportCounts(result)).toBe('nothing');
  });
});

// =============================================================================
// coerceResourceArray
// =============================================================================

describe('coerceResourceArray', () => {
  it('returns array as-is', () => {
    const arr = [1, 2, 3];
    expect(coerceResourceArray('agents', arr)).toBe(arr);
  });

  it('throws for non-array', () => {
    expect(() => coerceResourceArray('agents', 'hello')).toThrow('expected an array');
    expect(() => coerceResourceArray('rules', null)).toThrow('expected an array');
  });
});

// =============================================================================
// toLines
// =============================================================================

describe('toLines', () => {
  it('trims and filters empty strings', () => {
    expect(toLines(['  hello  ', '', '  world  ', '  '])).toEqual(['hello', 'world']);
  });

  it('returns empty for empty input', () => {
    expect(toLines([])).toEqual([]);
  });
});

// =============================================================================
// nowSuffix
// =============================================================================

describe('nowSuffix', () => {
  it('returns an ISO-like string without colons or dots', () => {
    const result = nowSuffix();
    expect(result).not.toContain(':');
    expect(result).not.toContain('.');
    expect(result.length).toBeGreaterThan(10);
  });
});
