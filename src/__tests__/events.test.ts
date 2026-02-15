import { describe, it, expect } from 'vitest';
import { parseEvent } from '../events.js';

describe('parseEvent', () => {
  it('parses a valid immediate event', () => {
    const content = JSON.stringify({ type: 'immediate', text: 'Hello world' });
    const result = parseEvent(content, 'test.json');
    expect(result).toEqual({ type: 'immediate', text: 'Hello world', session: undefined });
  });

  it('parses a valid one-shot event', () => {
    const content = JSON.stringify({
      type: 'one-shot',
      text: 'Send reminder',
      at: '2026-03-01T09:00:00Z',
    });
    const result = parseEvent(content, 'test.json');
    expect(result).toEqual({
      type: 'one-shot',
      text: 'Send reminder',
      at: '2026-03-01T09:00:00Z',
      session: undefined,
    });
  });

  it('parses a valid periodic event', () => {
    const content = JSON.stringify({
      type: 'periodic',
      text: 'Daily check',
      schedule: '0 9 * * *',
      timezone: 'America/New_York',
    });
    const result = parseEvent(content, 'test.json');
    expect(result).toEqual({
      type: 'periodic',
      text: 'Daily check',
      schedule: '0 9 * * *',
      timezone: 'America/New_York',
      session: undefined,
    });
  });

  it('preserves optional session field', () => {
    const content = JSON.stringify({
      type: 'immediate',
      text: 'Hello',
      session: 'my-session',
    });
    const result = parseEvent(content, 'test.json');
    expect(result).toEqual({
      type: 'immediate',
      text: 'Hello',
      session: 'my-session',
    });
  });

  it('throws on invalid JSON', () => {
    expect(() => parseEvent('not valid json', 'bad.json')).toThrow(
      /Invalid JSON in event file bad\.json/,
    );
  });

  it('throws on non-object JSON (string)', () => {
    expect(() => parseEvent('"just a string"', 'str.json')).toThrow(
      /Invalid event data in str\.json/,
    );
  });

  it('throws on non-object JSON (number)', () => {
    expect(() => parseEvent('42', 'num.json')).toThrow(/Invalid event data in num\.json/);
  });

  it('throws on null JSON', () => {
    expect(() => parseEvent('null', 'null.json')).toThrow(/Invalid event data in null\.json/);
  });

  it('throws when type is missing', () => {
    const content = JSON.stringify({ text: 'Hello' });
    expect(() => parseEvent(content, 'no-type.json')).toThrow(
      /Missing required fields \(type, text\) in no-type\.json/,
    );
  });

  it('throws when text is missing', () => {
    const content = JSON.stringify({ type: 'immediate' });
    expect(() => parseEvent(content, 'no-text.json')).toThrow(
      /Missing required fields \(type, text\) in no-text\.json/,
    );
  });

  it('throws when text is not a string', () => {
    const content = JSON.stringify({ type: 'immediate', text: 123 });
    expect(() => parseEvent(content, 'bad-text.json')).toThrow(
      /Missing required fields \(type, text\) in bad-text\.json/,
    );
  });

  it('throws when at is missing for one-shot event', () => {
    const content = JSON.stringify({ type: 'one-shot', text: 'Hello' });
    expect(() => parseEvent(content, 'no-at.json')).toThrow(
      /Missing 'at' for one-shot event in no-at\.json/,
    );
  });

  it('throws when schedule is missing for periodic event', () => {
    const content = JSON.stringify({
      type: 'periodic',
      text: 'Hello',
      timezone: 'UTC',
    });
    expect(() => parseEvent(content, 'no-sched.json')).toThrow(
      /Missing 'schedule' for periodic event in no-sched\.json/,
    );
  });

  it('throws when timezone is missing for periodic event', () => {
    const content = JSON.stringify({
      type: 'periodic',
      text: 'Hello',
      schedule: '* * * * *',
    });
    expect(() => parseEvent(content, 'no-tz.json')).toThrow(
      /Missing 'timezone' for periodic event in no-tz\.json/,
    );
  });

  it('throws on unknown event type', () => {
    const content = JSON.stringify({ type: 'webhook', text: 'Hello' });
    expect(() => parseEvent(content, 'unknown.json')).toThrow(
      /Unknown event type "webhook" in unknown\.json/,
    );
  });
});
