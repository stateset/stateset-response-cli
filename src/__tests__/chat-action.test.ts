import { describe, it, expect, beforeAll } from 'vitest';
import {
  resolveSlashInputAction,
  resolveSlashRouteAction,
  getSlashCommandSuggestions,
} from '../cli/chat-action.js';
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

  it('suggests commands by prefix when possible', () => {
    const suggestions = getSlashCommandSuggestions('/se');
    expect(suggestions).toContain('/search');
    expect(suggestions).toContain('/session-meta');
    expect(suggestions).toContain('/sessions');
    expect(suggestions).toContain('/session');
  });

  it('suggests near-miss slash commands', () => {
    expect(getSlashCommandSuggestions('/hlp')).toEqual(['/help', '/bulk', '/kb']);
  });

  it('suggests extension commands when provided', () => {
    const suggestions = getSlashCommandSuggestions('/ext', ['ext-demo', '/export']);
    expect(suggestions).toContain('/ext-demo');
    expect(suggestions).toContain('/extensions');
  });

  it('does not suggest for bare "/" input', () => {
    expect(getSlashCommandSuggestions('/')).toEqual([]);
  });
});

describe('resolveSlashInputAction — extended', () => {
  it('returns "send" when route has sendMessage, even for /exit', () => {
    expect(resolveSlashInputAction('/exit', { handled: true, sendMessage: 'goodbye' })).toEqual(
      'send',
    );
  });

  it('returns "prompt" when route needs prompt, even for /quit', () => {
    expect(resolveSlashInputAction('/quit', { handled: true, needsPrompt: true })).toEqual(
      'prompt',
    );
  });

  it('returns "unhandled" for non-exit unknown commands', () => {
    expect(resolveSlashInputAction('/foo', { handled: false })).toEqual('unhandled');
    expect(resolveSlashInputAction('/bar baz', { handled: false })).toEqual('unhandled');
  });

  it('returns "handled" when route is handled and no other flags', () => {
    expect(resolveSlashInputAction('/whatever', { handled: true })).toEqual('handled');
  });
});

describe('resolveSlashRouteAction — edge cases', () => {
  it('ignores undefined handled', () => {
    const result = resolveSlashRouteAction({} as { handled: boolean });
    expect(result).toBe('ignore');
  });

  it('returns send for non-empty trimmed sendMessage', () => {
    expect(resolveSlashRouteAction({ handled: true, sendMessage: '  x  ' })).toBe('send');
  });

  it('returns handled for empty sendMessage and needsPrompt=false', () => {
    expect(resolveSlashRouteAction({ handled: true, sendMessage: '', needsPrompt: false })).toBe(
      'handled',
    );
  });

  it('returns handled for needsPrompt undefined', () => {
    expect(resolveSlashRouteAction({ handled: true, needsPrompt: undefined })).toBe('handled');
  });
});

describe('getSlashCommandSuggestions — extended', () => {
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
    // No duplicates
    const uniqueSuggestions = new Set(suggestions);
    expect(uniqueSuggestions.size).toBe(suggestions.length);
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

  it('limits fuzzy results to 3 max', () => {
    const suggestions = getSlashCommandSuggestions('/rul');
    expect(suggestions.length).toBeLessThanOrEqual(6); // prefix match limit
  });

  it('exact prefix match takes priority over fuzzy', () => {
    const suggestions = getSlashCommandSuggestions('/exp');
    // Should get exact prefix matches like /export, /export-list, etc.
    for (const s of suggestions) {
      expect(s.startsWith('/exp')).toBe(true);
    }
  });
});

// =============================================================================
// levenshteinDistance (tested indirectly through getSlashCommandSuggestions)
// =============================================================================

describe('levenshtein fuzzy matching', () => {
  it('finds exact match with 0 distance (prefix match)', () => {
    const suggestions = getSlashCommandSuggestions('/help');
    expect(suggestions).toContain('/help');
  });

  it('finds match at distance 1 (single char typo)', () => {
    const suggestions = getSlashCommandSuggestions('/modl');
    expect(suggestions).toContain('/model');
  });

  it('finds match at distance 2 (two char changes)', () => {
    const suggestions = getSlashCommandSuggestions('/cler');
    expect(suggestions).toContain('/clear');
  });

  it('sorts by distance then alphabetically', () => {
    const suggestions = getSlashCommandSuggestions('/stat');
    // /stats and /status are both prefix matches, so they come sorted
    expect(suggestions).toContain('/stats');
    expect(suggestions).toContain('/status');
  });
});
