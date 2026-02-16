import { describe, it, expect } from 'vitest';
import { resolveSlashRouteAction } from '../cli/chat-action.js';

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
