import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeSlashCommand } from '../cli/command-router.js';
import type { ChatContext, CommandResult } from '../cli/types.js';

vi.mock('../cli/commands-chat.js', () => ({
  handleChatCommand: vi.fn(async () => ({ handled: false })),
}));

vi.mock('../cli/commands-session.js', () => ({
  handleSessionCommand: vi.fn(async () => false),
}));

vi.mock('../cli/commands-export.js', () => ({
  handleExportCommand: vi.fn(async () => false),
}));

import { handleChatCommand } from '../cli/commands-chat.js';
import { handleSessionCommand } from '../cli/commands-session.js';
import { handleExportCommand } from '../cli/commands-export.js';

const mockChat = vi.mocked(handleChatCommand);
const mockSession = vi.mocked(handleSessionCommand);
const mockExport = vi.mocked(handleExportCommand);

const ctx = {} as ChatContext;

describe('routeSlashCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChat.mockResolvedValue({ handled: false });
    mockSession.mockResolvedValue(false);
    mockExport.mockResolvedValue(false);
  });

  it('returns chat result when chat handler matches', async () => {
    mockChat.mockResolvedValue({ handled: true });
    const result = await routeSlashCommand('/help', ctx);
    expect(result).toEqual({ handled: true });
    expect(mockSession).not.toHaveBeenCalled();
    expect(mockExport).not.toHaveBeenCalled();
  });

  it('returns sendMessage from chat handler', async () => {
    mockChat.mockResolvedValue({ handled: true, sendMessage: 'expanded' });
    const result = await routeSlashCommand('/prompt test', ctx);
    expect(result).toEqual({ handled: true, sendMessage: 'expanded' });
  });

  it('returns needsPrompt when chat handler sends blank message', async () => {
    mockChat.mockResolvedValue({ handled: true, sendMessage: '   ' });
    const result = await routeSlashCommand('/prompt test', ctx);
    expect(result).toEqual({ handled: true, needsPrompt: true });
  });

  it('returns needsPrompt when chat handler sends non-string payload', async () => {
    mockChat.mockResolvedValue({ handled: true, sendMessage: 123 as unknown as string });
    const result = await routeSlashCommand('/prompt test', ctx);
    expect(result).toEqual({ handled: true, needsPrompt: true });
  });

  it('normalizes malformed needsPrompt into prompt flow', async () => {
    mockChat.mockResolvedValue({
      handled: true,
      needsPrompt: 'yes' as unknown as boolean,
    });
    const result = await routeSlashCommand('/prompt test', ctx);
    expect(result).toEqual({ handled: true, needsPrompt: true });
  });

  it('normalizes explicit false needsPrompt to canonical handled result', async () => {
    mockChat.mockResolvedValue({ handled: true, needsPrompt: false });
    const result = await routeSlashCommand('/prompt test', ctx);
    expect(result).toEqual({ handled: true });
  });

  it('falls through to session when chat not handled', async () => {
    mockSession.mockResolvedValue(true);
    const result = await routeSlashCommand('/session', ctx);
    expect(result).toEqual({ handled: true });
    expect(mockChat).toHaveBeenCalledWith('/session', ctx);
    expect(mockSession).toHaveBeenCalledWith('/session', ctx);
    expect(mockExport).not.toHaveBeenCalled();
  });

  it('falls through to export when chat and session not handled', async () => {
    mockExport.mockResolvedValue(true);
    const result = await routeSlashCommand('/export', ctx);
    expect(result).toEqual({ handled: true });
    expect(mockChat).toHaveBeenCalled();
    expect(mockSession).toHaveBeenCalled();
    expect(mockExport).toHaveBeenCalledWith('/export', ctx);
  });

  it('returns unhandled when no handler matches', async () => {
    const result = await routeSlashCommand('/unknown-command', ctx);
    expect(result).toEqual({ handled: false });
    expect(mockChat).toHaveBeenCalled();
    expect(mockSession).toHaveBeenCalled();
    expect(mockExport).toHaveBeenCalled();
  });

  it('routes extension commands through context extension registry', async () => {
    const extensionCtx = {
      extensions: {
        getCommand: vi.fn((name: string) =>
          name === 'demo'
            ? {
                name: 'demo',
                handler: vi.fn(async () => '/demo-response'),
              }
            : null,
        ),
      },
      buildExtensionContext: vi.fn(() => ({})),
    } as unknown as ChatContext;

    const result = await routeSlashCommand('/demo hi', extensionCtx);
    expect(result).toEqual({ handled: true, sendMessage: '/demo-response' });
    expect(extensionCtx.extensions.getCommand).toHaveBeenCalledWith('demo');
    expect(extensionCtx.buildExtensionContext).toHaveBeenCalled();
  });

  it('accepts extension responses using send payload', async () => {
    const extensionCtx = {
      extensions: {
        getCommand: vi.fn((name: string) =>
          name === 'demo-send'
            ? {
                name: 'demo-send',
                handler: vi.fn(async () => ({ send: '/demo-send-response' })),
              }
            : null,
        ),
      },
      buildExtensionContext: vi.fn(() => ({})),
    } as unknown as ChatContext;

    const result = await routeSlashCommand('/demo-send hi', extensionCtx);
    expect(result).toEqual({ handled: true, sendMessage: '/demo-send-response' });
    expect(extensionCtx.extensions.getCommand).toHaveBeenCalledWith('demo-send');
    expect(extensionCtx.buildExtensionContext).toHaveBeenCalled();
  });

  it('returns handled-with-prompt when extension command emits no response', async () => {
    const extensionCtx = {
      extensions: {
        getCommand: vi.fn(() => ({
          name: 'silent',
          handler: vi.fn(async () => undefined),
        })),
      },
      buildExtensionContext: vi.fn(() => ({})),
    } as unknown as ChatContext;

    const result = await routeSlashCommand('/silent', extensionCtx);
    expect(result).toEqual({ handled: true, needsPrompt: true });
  });

  it('returns handled-with-prompt when extension command returns non-boolean handled', async () => {
    const extensionCtx = {
      extensions: {
        getCommand: vi.fn(() => ({
          name: 'weird',
          handler: vi.fn(async () => ({ handled: 'yes' as unknown as boolean })),
        })),
      },
      buildExtensionContext: vi.fn(() => ({})),
    } as unknown as ChatContext;

    const result = await routeSlashCommand('/weird', extensionCtx);
    expect(result).toEqual({ handled: true, needsPrompt: true });
  });

  it('returns handled-with-prompt when extension command returns empty send payload', async () => {
    const extensionCtx = {
      extensions: {
        getCommand: vi.fn(() => ({
          name: 'empty',
          handler: vi.fn(async () => ''),
        })),
      },
      buildExtensionContext: vi.fn(() => ({})),
    } as unknown as ChatContext;

    const result = await routeSlashCommand('/empty', extensionCtx);
    expect(result).toEqual({ handled: true, needsPrompt: true });
  });

  it('returns handled-with-prompt when extension command returns whitespace send payload', async () => {
    const extensionCtx = {
      extensions: {
        getCommand: vi.fn(() => ({
          name: 'spacey',
          handler: vi.fn(async () => ({ send: '   ' })),
        })),
      },
      buildExtensionContext: vi.fn(() => ({})),
    } as unknown as ChatContext;

    const result = await routeSlashCommand('/spacey', extensionCtx);
    expect(result).toEqual({ handled: true, needsPrompt: true });
  });

  it('returns handled-with-prompt when extension command send payload is not a string', async () => {
    const extensionCtx = {
      extensions: {
        getCommand: vi.fn(() => ({
          name: 'weird-send',
          handler: vi.fn(async () => ({ send: 123 as unknown as string })),
        })),
      },
      buildExtensionContext: vi.fn(() => ({})),
    } as unknown as ChatContext;

    const result = await routeSlashCommand('/weird-send', extensionCtx);
    expect(result).toEqual({ handled: true, needsPrompt: true });
  });

  it('returns handled when extension command explicitly suppresses follow-up', async () => {
    const extensionCtx = {
      extensions: {
        getCommand: vi.fn(() => ({
          name: 'suppress',
          handler: vi.fn(async () => ({ handled: true })),
        })),
      },
      buildExtensionContext: vi.fn(() => ({})),
    } as unknown as ChatContext;

    const result = await routeSlashCommand('/suppress', extensionCtx);
    expect(result).toEqual({ handled: true });
    expect(extensionCtx.extensions.getCommand).toHaveBeenCalledWith('suppress');
    expect(extensionCtx.buildExtensionContext).toHaveBeenCalled();
  });

  it('returns handled-with-prompt when extension command throws', async () => {
    const extensionCtx = {
      extensions: {
        getCommand: vi.fn(() => ({
          name: 'boom',
          handler: vi.fn(async () => {
            throw new Error('extension failed');
          }),
        })),
      },
      buildExtensionContext: vi.fn(() => ({})),
    } as unknown as ChatContext;

    const result = await routeSlashCommand('/boom', extensionCtx);
    expect(result).toEqual({ handled: true, needsPrompt: true });
    expect(extensionCtx.extensions.getCommand).toHaveBeenCalledWith('boom');
    expect(extensionCtx.buildExtensionContext).toHaveBeenCalled();
  });

  it('checks handlers in order: chat → session → export', async () => {
    const callOrder: string[] = [];
    mockChat.mockImplementation(async () => {
      callOrder.push('chat');
      return { handled: false };
    });
    mockSession.mockImplementation(async () => {
      callOrder.push('session');
      return false;
    });
    mockExport.mockImplementation(async () => {
      callOrder.push('export');
      return false;
    });

    await routeSlashCommand('/anything', ctx);
    expect(callOrder).toEqual(['chat', 'session', 'export']);
  });

  it('session returning false falls through to export', async () => {
    mockSession.mockResolvedValue(false);
    mockExport.mockResolvedValue(true);
    const result = await routeSlashCommand('/export-list', ctx);
    expect(result).toEqual({ handled: true });
  });

  it('routes /session-meta through session handler and not export', async () => {
    mockSession.mockResolvedValue(true);
    const result = await routeSlashCommand('/session-meta json out=/tmp/meta.json', ctx);

    expect(result).toEqual({ handled: true });
    expect(mockSession).toHaveBeenCalledWith('/session-meta json out=/tmp/meta.json', ctx);
    expect(mockExport).not.toHaveBeenCalled();
  });

  it('routes /policy commands through session/chat stage before export', async () => {
    mockSession.mockResolvedValue(true);
    const result = await routeSlashCommand('/policy export out=/tmp/policy.json', ctx);

    expect(result).toEqual({ handled: true });
    expect(mockSession).toHaveBeenCalled();
    expect(mockExport).not.toHaveBeenCalled();
  });

  it('returns handled-with-prompt when chat handler throws', async () => {
    const err = new Error('chat error');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockChat.mockRejectedValue(err);
    const result = await routeSlashCommand('/help', ctx);
    expect(result).toEqual({ handled: true, needsPrompt: true });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('returns handled-with-prompt when session handler throws', async () => {
    const err = new Error('session error');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockChat.mockResolvedValue({ handled: false });
    mockSession.mockRejectedValue(err);
    const result = await routeSlashCommand('/session', ctx);
    expect(result).toEqual({ handled: true, needsPrompt: true });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('returns handled-with-prompt when export handler throws', async () => {
    const err = new Error('export error');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockChat.mockResolvedValue({ handled: false });
    mockSession.mockResolvedValue(false);
    mockExport.mockRejectedValue(err);
    const result = await routeSlashCommand('/export', ctx);
    expect(result).toEqual({ handled: true, needsPrompt: true });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('returns handled-with-prompt when extension registry throws', async () => {
    const err = new Error('registry error');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const extensionCtx = {
      extensions: {
        getCommand: vi.fn(() => {
          throw err;
        }),
      },
    } as unknown as ChatContext;

    const result = await routeSlashCommand('/boom', extensionCtx);
    expect(result).toEqual({ handled: true, needsPrompt: true });
    expect(extensionCtx.extensions.getCommand).toHaveBeenCalledWith('boom');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('returns handled-with-prompt when extension context builder throws', async () => {
    const err = new Error('context builder error');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const extensionCtx = {
      extensions: {
        getCommand: vi.fn(() => ({
          name: 'context-bug',
          handler: vi.fn(async () => '/should-not-run'),
        })),
      },
      buildExtensionContext: vi.fn(() => {
        throw err;
      }),
    } as unknown as ChatContext;

    const result = await routeSlashCommand('/context-bug', extensionCtx);
    expect(result).toEqual({ handled: true, needsPrompt: true });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('export returning false results in unhandled', async () => {
    mockExport.mockResolvedValue(false);
    const result = await routeSlashCommand('/nonexistent', ctx);
    expect(result).toEqual({ handled: false });
  });

  it('falls through when chat is explicitly unhandled', async () => {
    mockChat.mockResolvedValue({ handled: false } as CommandResult);
    mockSession.mockResolvedValue(true);
    mockExport.mockResolvedValue(false);
    const result = await routeSlashCommand('/session', ctx);
    expect(mockSession).toHaveBeenCalled();
    expect(result).toEqual({ handled: true });
  });

  it('continues when chat handler returns malformed result', async () => {
    mockChat.mockResolvedValue(undefined as unknown as CommandResult);
    mockSession.mockResolvedValue(false);
    mockExport.mockResolvedValue(false);
    const result = await routeSlashCommand('/nonexistent', ctx);
    expect(result).toEqual({ handled: false });
  });

  it('requires strict boolean handling from chat handler results', async () => {
    mockChat.mockResolvedValue({ handled: 'yes' as unknown as boolean });
    const result = await routeSlashCommand('/nonexistent', ctx);
    expect(mockSession).toHaveBeenCalled();
    expect(mockExport).toHaveBeenCalled();
    expect(result).toEqual({ handled: false });
  });
});
