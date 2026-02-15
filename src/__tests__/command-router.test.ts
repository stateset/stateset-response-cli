import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeSlashCommand } from '../cli/command-router.js';
import type { ChatContext } from '../cli/types.js';

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

  it('export returning false results in unhandled', async () => {
    mockExport.mockResolvedValue(false);
    const result = await routeSlashCommand('/nonexistent', ctx);
    expect(result).toEqual({ handled: false });
  });
});
