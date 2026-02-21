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
