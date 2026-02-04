import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ExtensionManager } from '../extensions.js';

function setupTempExtensions(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-ext-'));
  const extensionsDir = path.join(dir, '.stateset', 'extensions');
  fs.mkdirSync(extensionsDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(extensionsDir, `${name}.js`), content, 'utf-8');
  }
  return dir;
}

describe('extensions', () => {
  it('rejects duplicate tool hook names', async () => {
    const cwd = setupTempExtensions({
      one: `
        export default function register(api) {
          api.registerToolHook({ name: "dup-hook", handler() { return { action: "allow" }; } });
        }
      `,
      two: `
        export default function register(api) {
          api.registerToolHook({ name: "dup-hook", handler() { return { action: "allow" }; } });
        }
      `,
    });

    const manager = new ExtensionManager();
    await manager.load(cwd);
    const diagnostics = manager.listDiagnostics().map((d) => d.message);
    expect(diagnostics.some((m) => m.toLowerCase().includes('already registered'))).toBe(true);
  });
});
