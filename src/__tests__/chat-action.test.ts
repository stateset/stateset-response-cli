import { Readable } from 'node:stream';
import { describe, it, expect } from 'vitest';
import { resolveOneShotInput } from '../cli/chat-action.js';

describe('resolveOneShotInput', () => {
  it('joins prompt arguments when provided', async () => {
    await expect(
      resolveOneShotInput({
        promptParts: ['summarize', 'latest', 'orders'],
        stdinIsTTY: true,
      }),
    ).resolves.toBe('summarize latest orders');
  });

  it('rejects mixing prompt arguments with --stdin', async () => {
    await expect(
      resolveOneShotInput({
        promptParts: ['hello'],
        stdin: true,
        stdinIsTTY: true,
      }),
    ).rejects.toThrow('Pass prompt text as arguments or use --stdin, not both.');
  });

  it('reads piped stdin when --stdin is set', async () => {
    await expect(
      resolveOneShotInput({
        stdin: true,
        stdinIsTTY: false,
        stdinStream: Readable.from(['  incident summary  ']),
      }),
    ).resolves.toBe('incident summary');
  });

  it('reads piped stdin implicitly when no prompt args are provided', async () => {
    await expect(
      resolveOneShotInput({
        stdinIsTTY: false,
        stdinStream: Readable.from(['ship ', 'status']),
      }),
    ).resolves.toBe('ship status');
  });

  it('rejects missing prompt text on an interactive terminal', async () => {
    await expect(
      resolveOneShotInput({
        stdinIsTTY: true,
      }),
    ).rejects.toThrow('Provide a message or pipe text via stdin.');
  });

  it('rejects --stdin when stdin is still a TTY', async () => {
    await expect(
      resolveOneShotInput({
        stdin: true,
        stdinIsTTY: true,
      }),
    ).rejects.toThrow('--stdin requires piped input.');
  });
});
