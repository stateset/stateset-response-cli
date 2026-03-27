/**
 * Tests for clipboard module
 */
import { describe, it, expect, vi, beforeEach, afterEach, type SpyInstance } from 'vitest';

// Mock child_process before importing the module under test
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { copyToClipboard } from '../lib/clipboard.js';
import { execSync } from 'node:child_process';

const execSyncMock = vi.mocked(execSync);

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function setTTY(isTTY: boolean) {
  Object.defineProperty(process.stdout, 'isTTY', {
    value: isTTY,
    writable: true,
    configurable: true,
  });
}

/* ------------------------------------------------------------------ */
/*  OSC 52 path                                                       */
/* ------------------------------------------------------------------ */

describe('copyToClipboard – OSC 52', () => {
  let writeSpy: SpyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    setTTY(true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('returns true when stdout is a TTY and write succeeds', () => {
    const result = copyToClipboard('hello');
    expect(result).toBe(true);
  });

  it('writes the correct OSC 52 escape sequence', () => {
    copyToClipboard('hello');

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const written = writeSpy.mock.calls[0][0] as string;

    // The OSC 52 format is: ESC ] 52 ; c ; <base64> BEL
    const b64 = Buffer.from('hello').toString('base64');
    expect(written).toBe(`\x1b]52;c;${b64}\x07`);
  });

  it('base64 encodes the input text correctly', () => {
    const text = 'Hello, World! Special chars: <>&"\'';
    copyToClipboard(text);

    const written = writeSpy.mock.calls[0][0] as string;
    const expectedB64 = Buffer.from(text).toString('base64');
    expect(written).toContain(expectedB64);
  });

  it('handles empty string', () => {
    const result = copyToClipboard('');
    expect(result).toBe(true);

    const written = writeSpy.mock.calls[0][0] as string;
    const emptyB64 = Buffer.from('').toString('base64');
    expect(written).toBe(`\x1b]52;c;${emptyB64}\x07`);
  });

  it('handles multi-byte unicode', () => {
    const text = 'cafe\u0301'; // e with combining accent
    copyToClipboard(text);

    const written = writeSpy.mock.calls[0][0] as string;
    const expectedB64 = Buffer.from(text).toString('base64');
    expect(written).toContain(expectedB64);
  });

  it('falls through to native tool if stdout.write throws', () => {
    writeSpy.mockImplementation(() => {
      throw new Error('write failed');
    });
    // With no native tool available and not on darwin/win32, returns false
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    execSyncMock.mockImplementation(() => {
      throw new Error('not found');
    });

    const result = copyToClipboard('hello');
    expect(result).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  No TTY, no native tool                                            */
/* ------------------------------------------------------------------ */

describe('copyToClipboard – no TTY, no native tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTTY(false);
    // Ensure we are on Linux with no clipboard tools
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    delete process.env.WAYLAND_DISPLAY;
    delete process.env.XDG_SESSION_TYPE;
  });

  it('returns false when no TTY and no native clipboard tool is found', () => {
    // All `which` calls will throw (tool not found)
    execSyncMock.mockImplementation(() => {
      throw new Error('not found');
    });

    const result = copyToClipboard('hello');
    expect(result).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Native clipboard tools (no TTY fallback)                          */
/* ------------------------------------------------------------------ */

describe('copyToClipboard – native tools (no TTY)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTTY(false);
  });

  afterEach(() => {
    delete process.env.WAYLAND_DISPLAY;
    delete process.env.XDG_SESSION_TYPE;
  });

  it('uses pbcopy on darwin', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    execSyncMock.mockReturnValue(Buffer.from(''));

    const result = copyToClipboard('test');
    expect(result).toBe(true);

    // The clipboard command call (not the `which` call)
    expect(execSyncMock).toHaveBeenCalledWith(
      'pbcopy',
      expect.objectContaining({
        input: 'test',
        timeout: 5_000,
      }),
    );
  });

  it('uses clip on win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    execSyncMock.mockReturnValue(Buffer.from(''));

    const result = copyToClipboard('test');
    expect(result).toBe(true);

    expect(execSyncMock).toHaveBeenCalledWith('clip', expect.objectContaining({ input: 'test' }));
  });

  it('tries wl-copy on Linux with WAYLAND_DISPLAY', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    process.env.WAYLAND_DISPLAY = 'wayland-0';

    // `which wl-copy` succeeds, then the actual wl-copy call succeeds
    execSyncMock.mockReturnValue(Buffer.from(''));

    const result = copyToClipboard('test');
    expect(result).toBe(true);

    // First call: which wl-copy
    expect(execSyncMock).toHaveBeenCalledWith('which wl-copy', expect.anything());
    // Second call: wl-copy with input
    expect(execSyncMock).toHaveBeenCalledWith(
      'wl-copy',
      expect.objectContaining({ input: 'test' }),
    );
  });

  it('falls back to xclip when wl-copy is not available on Wayland', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    process.env.WAYLAND_DISPLAY = 'wayland-0';

    execSyncMock.mockImplementation((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr === 'which wl-copy') throw new Error('not found');
      if (cmdStr === 'which xclip') return Buffer.from('/usr/bin/xclip');
      // Actual copy call
      return Buffer.from('');
    });

    const result = copyToClipboard('test');
    expect(result).toBe(true);

    expect(execSyncMock).toHaveBeenCalledWith(
      'xclip -selection clipboard',
      expect.objectContaining({ input: 'test' }),
    );
  });

  it('returns false if the native tool throws', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    execSyncMock.mockImplementation(() => {
      throw new Error('pbcopy failed');
    });

    const result = copyToClipboard('hello');
    expect(result).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  OSC 52 escape sequence format                                     */
/* ------------------------------------------------------------------ */

describe('OSC 52 escape sequence format', () => {
  let writeSpy: SpyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    setTTY(true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('starts with ESC ] 52 ; c ;', () => {
    copyToClipboard('x');
    const written = writeSpy.mock.calls[0][0] as string;
    expect(written.startsWith('\x1b]52;c;')).toBe(true);
  });

  it('ends with BEL character (\\x07)', () => {
    copyToClipboard('x');
    const written = writeSpy.mock.calls[0][0] as string;
    expect(written.endsWith('\x07')).toBe(true);
  });

  it('contains valid base64 between delimiters', () => {
    copyToClipboard('test data');
    const written = writeSpy.mock.calls[0][0] as string;

    // Extract the base64 portion
    const prefix = '\x1b]52;c;';
    const suffix = '\x07';
    const b64Part = written.slice(prefix.length, -suffix.length);

    // Verify it is valid base64 that decodes to the original text
    expect(Buffer.from(b64Part, 'base64').toString()).toBe('test data');
  });
});
