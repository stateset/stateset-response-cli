import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ExtensionManager } from '../extensions.js';

const trackedTempDirs: string[] = [];

afterEach(() => {
  for (const dir of trackedTempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function setupTempExtensions(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-ext-'));
  const extensionsDir = path.join(dir, '.stateset', 'extensions');
  fs.mkdirSync(extensionsDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(extensionsDir, `${name}.js`), content, 'utf-8');
  }
  trackedTempDirs.push(dir);
  return dir;
}

function setupTrustRoot(cwd: string, policy: Record<string, unknown>): void {
  const trustDir = path.join(cwd, '.stateset');
  fs.mkdirSync(trustDir, { recursive: true });
  fs.writeFileSync(path.join(trustDir, 'extension-trust.json'), JSON.stringify(policy), 'utf-8');
  fs.writeFileSync(path.join(trustDir, 'extensions-trust.json'), JSON.stringify(policy), 'utf-8');
}

async function withEnv<T>(
  updates: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(updates)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
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

  it('enforces allowlist-only trust policy', async () => {
    const cwd = setupTempExtensions({
      allowed: `
        export default function register(api) {
          api.registerCommand({ name: 'ok', handler: () => 'ok' });
        }
      `,
      blocked: `
        export default function register(api) {
          api.registerCommand({ name: 'nope', handler: () => 'nope' });
        }
      `,
    });

    setupTrustRoot(cwd, { allow: ['allowed'] });

    await withEnv({ STATESET_EXTENSIONS_ALLOW: 'allowed' }, async () => {
      const manager = new ExtensionManager();
      await manager.load(cwd);
      const loaded = manager.listExtensions().map((ext) => ext.name);

      expect(loaded).toEqual(['allowed']);
      expect(manager.listDiagnostics().some((d) => d.message.includes('Add to allowlist'))).toBe(
        false,
      );
    });
  });

  it('supports deny-only trust policy without enabling global enforcement', async () => {
    const cwd = setupTempExtensions({
      allowed: `
        export default function register(api) {
          api.registerCommand({ name: 'ok', handler: () => 'ok' });
        }
      `,
      blocked: `
        export default function register(api) {
          api.registerCommand({ name: 'nope', handler: () => 'nope' });
        }
      `,
    });

    setupTrustRoot(cwd, { deny: ['blocked'] });

    await withEnv({ STATESET_EXTENSIONS_DENY: 'blocked' }, async () => {
      const manager = new ExtensionManager();
      await manager.load(cwd);
      const loaded = manager.listExtensions().map((ext) => ext.name);

      expect(loaded).toEqual(['allowed']);
      expect(
        manager.listDiagnostics().some((d) => d.message.includes('blocked by trust policy')),
      ).toBe(true);
    });
  });

  it('combines file and env trust overrides, with deny taking precedence', async () => {
    const cwd = setupTempExtensions({
      fileOnly: `
        export default function register(api) {
          api.registerCommand({ name: 'fileonly', handler: () => 'fileonly' });
        }
      `,
      envOnly: `
        export default function register(api) {
          api.registerCommand({ name: 'envoverride', handler: () => 'envoverride' });
        }
      `,
      blocked: `
        export default function register(api) {
          api.registerCommand({ name: 'blocked', handler: () => 'blocked' });
        }
      `,
    });

    const policy = { allow: ['fileonly'], deny: ['blocked'] };
    setupTrustRoot(cwd, policy);

    await withEnv({ STATESET_EXTENSIONS_ALLOW: 'envonly' }, async () => {
      const manager = new ExtensionManager();
      await manager.load(cwd);
      const loaded = manager
        .listExtensions()
        .map((ext) => ext.name.toLowerCase())
        .sort();

      expect(loaded).toEqual(['envonly', 'fileonly'].sort());
    });
  });

  it('gives deny precedence when deny and allow list intersect', async () => {
    const cwd = setupTempExtensions({
      fileOnly: `
        export default function register(api) {
          api.registerCommand({ name: 'fileonly', handler: () => 'fileonly' });
        }
      `,
      envOnly: `
        export default function register(api) {
          api.registerCommand({ name: 'envoverride', handler: () => 'envoverride' });
        }
      `,
      denied: `
        export default function register(api) {
          api.registerCommand({ name: 'denied', handler: () => 'denied' });
        }
      `,
    });

    const policy = { allow: ['fileonly', 'denied'], deny: ['denied'] };
    setupTrustRoot(cwd, policy);

    await withEnv({ STATESET_EXTENSIONS_ALLOW: 'envoverride,denied' }, async () => {
      const manager = new ExtensionManager();
      await manager.load(cwd);
      const loaded = manager
        .listExtensions()
        .map((ext) => ext.name.toLowerCase())
        .sort();

      expect(loaded).toEqual(['envoverride', 'fileonly'].sort());
    });
  });
});
