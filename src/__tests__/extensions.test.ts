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

async function withProjectExtensionsTrusted<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const extensionsDir = path.join(cwd, '.stateset', 'extensions');
  const extensions = fs.existsSync(extensionsDir)
    ? fs
        .readdirSync(extensionsDir, { withFileTypes: true })
        .filter((entry) => {
          if (!entry.isFile()) return false;
          return ['.js', '.mjs', '.cjs'].includes(path.extname(entry.name));
        })
        .map((entry) => path.basename(entry.name, path.extname(entry.name)))
    : [];

  return withEnv(
    {
      STATESET_EXTENSIONS_ENFORCE_TRUST: extensions.length > 0 ? 'true' : undefined,
      STATESET_EXTENSIONS_ALLOW: extensions.length > 0 ? extensions.join(',') : undefined,
    },
    fn,
  );
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
    await withProjectExtensionsTrusted(cwd, async () => {
      await manager.load(cwd);
      const diagnostics = manager.listDiagnostics().map((d) => d.message);
      expect(diagnostics.some((m) => m.toLowerCase().includes('already registered'))).toBe(true);
    });
  });

  it('blocks project-local extensions when trust policy is disabled', async () => {
    const cwd = setupTempExtensions({
      alpha: `
        export default function register(api) {
          api.registerCommand({ name: 'ok', handler: () => 'ok' });
        }
      `,
    });

    const manager = new ExtensionManager();
    await manager.load(cwd);
    const loaded = manager.listExtensions();
    const diagnostics = manager.listDiagnostics().map((d) => d.message);

    expect(loaded).toEqual([]);
    expect(
      diagnostics.some((message) => message.includes('Project extension "alpha" is blocked')),
    ).toBe(true);
  });

  it('skips project extension directories that are not safe directories', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-ext-bad-dir-'));
    const realExtensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-real-ext-'));
    const linkedExtensionsDir = path.join(cwd, '.stateset', 'extensions');
    const extensionPath = path.join(realExtensionsDir, 'safe-ext.js');

    fs.mkdirSync(path.dirname(linkedExtensionsDir), { recursive: true });
    fs.symlinkSync(realExtensionsDir, linkedExtensionsDir, 'dir');
    fs.writeFileSync(
      extensionPath,
      `export default function register(api) {api.registerCommand({name:'ok', handler:() => 'ok'});}`,
      'utf-8',
    );

    trackedTempDirs.push(cwd);
    trackedTempDirs.push(realExtensionsDir);

    const manager = new ExtensionManager();
    await manager.load(cwd);

    expect(manager.listExtensions()).toEqual([]);
    expect(
      manager.listDiagnostics().some((d) => d.message.includes('Skipping extension directory')),
    ).toBe(true);
  });

  it('requires allowlist when STATESET_EXTENSIONS_ENFORCE_TRUST=true', async () => {
    const cwd = setupTempExtensions({
      alpha: `
        export default function register(api) {
          api.registerCommand({ name: 'ok', handler: () => 'ok' });
        }
      `,
    });

    const manager = new ExtensionManager();
    await withEnv({ STATESET_EXTENSIONS_ENFORCE_TRUST: 'true' }, async () => {
      await manager.load(cwd);
      const loaded = manager.listExtensions();
      const diagnostics = manager.listDiagnostics().map((d) => d.message);

      expect(loaded).toEqual([]);
      expect(diagnostics.some((message) => message.includes('without an allowlist'))).toBe(true);
    });
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

  it('supports deny-only trust policy with explicit enforcement enabled', async () => {
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

    await withEnv(
      {
        STATESET_EXTENSIONS_ENFORCE_TRUST: 'true',
        STATESET_EXTENSIONS_DENY: 'blocked',
      },
      async () => {
        const manager = new ExtensionManager();
        await manager.load(cwd);
        const loaded = manager.listExtensions().map((ext) => ext.name);

        expect(loaded).toEqual(['allowed']);
        expect(
          manager.listDiagnostics().some((d) => d.message.includes('without an allowlist')),
        ).toBe(false);
      },
    );
  });

  it('continues on malformed trust JSON when explicit trust variables are provided', async () => {
    const cwd = setupTempExtensions({
      alpha: `
        export default function register(api) {
          api.registerCommand({ name: 'ok', handler: () => 'ok' });
        }
      `,
    });
    const trustDir = path.join(cwd, '.stateset');
    fs.writeFileSync(path.join(trustDir, 'extension-trust.json'), '{bad json}', 'utf-8');

    const manager = new ExtensionManager();
    await withEnv(
      {
        STATESET_EXTENSIONS_ENFORCE_TRUST: 'true',
        STATESET_EXTENSIONS_ALLOW: 'alpha',
      },
      async () => {
        await manager.load(cwd);
        const loaded = manager.listExtensions().map((ext) => ext.name);
        const diagnostics = manager.listDiagnostics().map((d) => d.message);

        expect(loaded).toEqual(['alpha']);
        expect(diagnostics.some((d) => d.includes('Failed to load extension trust policy'))).toBe(
          true,
        );
        expect(diagnostics.some((d) => d.includes('without an allowlist'))).toBe(false);
      },
    );
  });

  it('supports deny-only trust policy from explicit trust file with enforce true', async () => {
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

    setupTrustRoot(cwd, { enforce: true, deny: ['blocked'] });

    const manager = new ExtensionManager();
    await withEnv({ STATESET_EXTENSIONS_ENFORCE_TRUST: undefined }, async () => {
      await manager.load(cwd);
      const loaded = manager.listExtensions().map((ext) => ext.name);

      expect(loaded).toEqual(['allowed']);
      expect(
        manager.listDiagnostics().some((d) => d.message.includes('without an allowlist')),
      ).toBe(false);
    });
  });

  it('blocks all when trust file enables enforcement without rules', async () => {
    const cwd = setupTempExtensions({
      allowed: `
        export default function register(api) {
          api.registerCommand({ name: 'ok', handler: () => 'ok' });
        }
      `,
    });

    setupTrustRoot(cwd, { enforce: true });

    const manager = new ExtensionManager();
    await manager.load(cwd);

    const loaded = manager.listExtensions().map((ext) => ext.name);
    expect(loaded).toEqual([]);
    expect(manager.listDiagnostics().some((d) => d.message.includes('without an allowlist'))).toBe(
      true,
    );
  });

  it('rejects symlinked extension trust files', async () => {
    const cwd = setupTempExtensions({
      alpha: `
        export default function register(api) {
          api.registerCommand({ name: 'ok', handler: () => 'ok' });
        }
      `,
    });
    const trustDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-ext-trust-real-'));
    const realTrustFile = path.join(trustDir, 'extension-trust.json');
    const trustTarget = path.join(cwd, '.stateset', 'extension-trust.json');
    fs.mkdirSync(path.dirname(trustTarget), { recursive: true });
    fs.writeFileSync(realTrustFile, JSON.stringify({ allow: ['alpha'] }), 'utf-8');
    fs.symlinkSync(realTrustFile, trustTarget, 'file');

    const manager = new ExtensionManager();
    await withEnv({ STATESET_EXTENSIONS_ENFORCE_TRUST: 'true' }, async () => {
      await manager.load(cwd);
      const diagnostics = manager.listDiagnostics().map((d) => d.message);

      expect(manager.listExtensions()).toEqual([]);
      expect(diagnostics.some((d) => d.includes('Skipping extension trust policy'))).toBe(true);
      expect(diagnostics.some((d) => d.includes('without an allowlist'))).toBe(true);
    });

    trackedTempDirs.push(trustDir);
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

  it('rejects extensions with unsafe filenames', async () => {
    const cwd = setupTempExtensions({
      'bad.name': `
        export default function register(api) {
          api.registerCommand({ name: 'ok', handler: () => 'ok' });
        }
      `,
    });

    const manager = new ExtensionManager();
    await manager.load(cwd);
    const diagnostics = manager.listDiagnostics().map((d) => d.message);

    expect(manager.listExtensions()).toEqual([]);
    expect(
      diagnostics.some((message) => message.includes('Invalid extension filename "bad.name.js".')),
    ).toBe(true);
  });

  it('rejects oversized extension files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-ext-large-'));
    const extensionsDir = path.join(root, '.stateset', 'extensions');
    fs.mkdirSync(extensionsDir, { recursive: true });
    const filePath = path.join(extensionsDir, 'too-large.js');
    fs.writeFileSync(filePath, 'x'.repeat(1_048_577));
    trackedTempDirs.push(root);

    const manager = new ExtensionManager();
    await manager.load(root);
    const diagnostics = manager.listDiagnostics().map((d) => d.message);

    expect(manager.listExtensions()).toEqual([]);
    expect(
      diagnostics.some((message) =>
        message.includes('Skipping extension file too large: too-large.js (>1MB).'),
      ),
    ).toBe(true);
  });
});
