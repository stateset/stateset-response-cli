import { beforeAll, describe, expect, it } from 'vitest';
import {
  getSlashCommandSuggestions,
  resolveSlashInputAction,
  resolveSlashRouteAction,
} from '../cli/slash-routing.js';
import { registerAllCommands } from '../cli/command-registry.js';

beforeAll(() => {
  registerAllCommands();
});

describe('resolveSlashRouteAction', () => {
  it('returns send when handled with non-empty message', () => {
    const result = resolveSlashRouteAction({
      handled: true,
      sendMessage: '  /prompt run  ',
    });
    expect(result).toEqual('send');
  });

  it('returns prompt when handled with needsPrompt flag', () => {
    const result = resolveSlashRouteAction({
      handled: true,
      needsPrompt: true,
    });
    expect(result).toEqual('prompt');
  });

  it('returns handled when handled with no follow-up action', () => {
    const result = resolveSlashRouteAction({
      handled: true,
    });
    expect(result).toEqual('handled');
  });

  it('returns ignore when not handled', () => {
    const result = resolveSlashRouteAction({
      handled: false,
    });
    expect(result).toEqual('ignore');
  });

  it('normalizes malformed handled value as ignore', () => {
    const result = resolveSlashRouteAction({
      handled: 'yes' as unknown as boolean,
    });
    expect(result).toEqual('ignore');
  });

  it('treats malformed needsPrompt as prompt', () => {
    const result = resolveSlashRouteAction({
      handled: true,
      needsPrompt: 'yes' as unknown as boolean,
    });
    expect(result).toEqual('prompt');
  });

  it('normalizes malformed send message type to handled', () => {
    const result = resolveSlashRouteAction({
      handled: true,
      sendMessage: 123 as unknown as string,
    });
    expect(result).toEqual('handled');
  });

  it('normalizes blank send message to handled', () => {
    const result = resolveSlashRouteAction({
      handled: true,
      sendMessage: '   ',
    });
    expect(result).toEqual('handled');
  });
});

describe('resolveSlashInputAction', () => {
  it('resolves /exit slash command to exit action', () => {
    expect(resolveSlashInputAction('/exit', { handled: false })).toEqual('exit');
  });

  it('resolves /quit slash command to exit action', () => {
    expect(resolveSlashInputAction('/quit', { handled: false })).toEqual('exit');
  });

  it('resolves unknown slash input to unhandled', () => {
    expect(resolveSlashInputAction('/unknown', { handled: false })).toEqual('unhandled');
  });

  it('resolves handled command to handled action', () => {
    expect(resolveSlashInputAction('/help', { handled: true })).toEqual('handled');
  });

  it('returns send when route has sendMessage, even for /exit', () => {
    expect(resolveSlashInputAction('/exit', { handled: true, sendMessage: 'goodbye' })).toEqual(
      'send',
    );
  });

  it('returns prompt when route needs prompt, even for /quit', () => {
    expect(resolveSlashInputAction('/quit', { handled: true, needsPrompt: true })).toEqual(
      'prompt',
    );
  });

  it('returns unhandled for non-exit unknown commands', () => {
    expect(resolveSlashInputAction('/foo', { handled: false })).toEqual('unhandled');
    expect(resolveSlashInputAction('/bar baz', { handled: false })).toEqual('unhandled');
  });

  it('returns handled when route is handled and no other flags', () => {
    expect(resolveSlashInputAction('/whatever', { handled: true })).toEqual('handled');
  });
});

describe('getSlashCommandSuggestions', () => {
  it('suggests commands by prefix when possible', () => {
    const suggestions = getSlashCommandSuggestions('/se');
    expect(suggestions).toContain('/search');
    expect(suggestions).toContain('/session-meta');
    expect(suggestions).toContain('/sessions');
    expect(suggestions).toContain('/session');
  });

  it('suggests near-miss slash commands', () => {
    const suggestions = getSlashCommandSuggestions('/hlp');
    expect(suggestions).toContain('/help');
    expect(suggestions.length).toBeLessThanOrEqual(3);
  });

  it('suggests extension commands when provided', () => {
    const suggestions = getSlashCommandSuggestions('/ext', ['ext-demo', '/export']);
    expect(suggestions).toContain('/ext-demo');
    expect(suggestions).toContain('/extensions');
  });

  it('does not suggest for bare "/" input', () => {
    expect(getSlashCommandSuggestions('/')).toEqual([]);
  });

  it('returns empty for plain text without slash', () => {
    expect(getSlashCommandSuggestions('hello world')).toEqual([]);
  });

  it('handles multi-word slash input by using first token', () => {
    const suggestions = getSlashCommandSuggestions('/he some args');
    expect(suggestions).toContain('/help');
  });

  it('deduplicates extension commands that overlap with known commands', () => {
    const suggestions = getSlashCommandSuggestions('/hel', ['/help']);
    expect(suggestions).toContain('/help');
    expect(new Set(suggestions).size).toBe(suggestions.length);
  });

  it('returns fuzzy matches sorted by distance', () => {
    const suggestions = getSlashCommandSuggestions('/analytic');
    expect(suggestions[0]).toBe('/analytics');
  });

  it('includes extension commands in prefix matching', () => {
    const suggestions = getSlashCommandSuggestions('/foo', ['foobar']);
    expect(suggestions).toContain('/foobar');
  });

  it('returns empty when only "/" typed', () => {
    expect(getSlashCommandSuggestions('/')).toEqual([]);
  });

  it('returns empty for non-slash input', () => {
    expect(getSlashCommandSuggestions('hello')).toEqual([]);
  });

  it('fuzzy matches close misspellings', () => {
    const suggestions = getSlashCommandSuggestions('/sesssions');
    expect(suggestions).toContain('/sessions');
  });

  it('does not suggest for very different input', () => {
    const suggestions = getSlashCommandSuggestions('/zzzzzzzzzzz');
    expect(suggestions).toEqual([]);
  });

  it('limits prefix results to 6 max', () => {
    const suggestions = getSlashCommandSuggestions('/rul');
    expect(suggestions.length).toBeLessThanOrEqual(6);
  });

  it('exact prefix match takes priority over fuzzy', () => {
    const suggestions = getSlashCommandSuggestions('/exp');
    for (const suggestion of suggestions) {
      expect(suggestion.startsWith('/exp')).toBe(true);
    }
  });

  it('finds exact match with 0 distance', () => {
    const suggestions = getSlashCommandSuggestions('/help');
    expect(suggestions).toContain('/help');
  });

  it('finds match at distance 1', () => {
    const suggestions = getSlashCommandSuggestions('/modl');
    expect(suggestions).toContain('/model');
  });

  it('finds match at distance 2', () => {
    const suggestions = getSlashCommandSuggestions('/cler');
    expect(suggestions).toContain('/clear');
  });

  it('sorts by distance then alphabetically', () => {
    const suggestions = getSlashCommandSuggestions('/stat');
    expect(suggestions).toContain('/stats');
    expect(suggestions).toContain('/status');
  });

  it('resolves typo alias /hlep to /help', () => {
    const suggestions = getSlashCommandSuggestions('/hlep');
    expect(suggestions).toEqual(['/help']);
  });

  it('resolves typo alias /engien to /engine', () => {
    const suggestions = getSlashCommandSuggestions('/engien');
    expect(suggestions).toEqual(['/engine']);
  });

  it('resolves typo alias /modle to /model', () => {
    const suggestions = getSlashCommandSuggestions('/modle');
    expect(suggestions).toEqual(['/model']);
  });

  it('resolves typo alias /agen to /agents', () => {
    const suggestions = getSlashCommandSuggestions('/agen');
    expect(suggestions).toEqual(['/agents']);
  });

  it('resolves typo alias /clera to /clear', () => {
    const suggestions = getSlashCommandSuggestions('/clera');
    expect(suggestions).toEqual(['/clear']);
  });
});
