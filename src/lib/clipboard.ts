/**
 * Cross-platform clipboard support.
 *
 * Priority:
 * 1. OSC 52 escape sequence (works over SSH/mosh)
 * 2. Native clipboard tool (pbcopy, xclip, xsel, wl-copy, clip.exe)
 */

import { execSync } from 'node:child_process';

const COPY_TIMEOUT_MS = 5_000;

function detectCopyCommand(): string | null {
  const platform = process.platform;

  if (platform === 'darwin') return 'pbcopy';
  if (platform === 'win32') return 'clip';

  // Linux: check for Wayland first, then X11
  if (process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland') {
    try {
      execSync('which wl-copy', { stdio: 'pipe', timeout: 2000 });
      return 'wl-copy';
    } catch {
      // fall through
    }
  }

  // Try xclip, then xsel
  for (const cmd of ['xclip -selection clipboard', 'xsel --clipboard --input']) {
    try {
      const bin = cmd.split(' ')[0];
      execSync(`which ${bin}`, { stdio: 'pipe', timeout: 2000 });
      return cmd;
    } catch {
      // continue
    }
  }

  return null;
}

/**
 * Copy text to the system clipboard.
 * Returns true on success, false on failure.
 */
export function copyToClipboard(text: string): boolean {
  // Try OSC 52 first (works in modern terminals, even over SSH)
  if (process.stdout.isTTY) {
    try {
      const b64 = Buffer.from(text).toString('base64');
      process.stdout.write(`\x1b]52;c;${b64}\x07`);
      return true;
    } catch {
      // fall through to native tool
    }
  }

  // Try native clipboard tool
  const cmd = detectCopyCommand();
  if (!cmd) return false;

  try {
    execSync(cmd, {
      input: text,
      timeout: COPY_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}
