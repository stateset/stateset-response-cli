import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getShellProfilePath,
  installCompletion,
  resolveCompletionCachePath,
  resolveCompletionShell,
} from '../cli/shell-completion.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-completion-install-'));
  tempDirs.push(dir);
  return dir;
}

function buildProgram(): Command {
  const program = new Command();
  program.name('response').option('--json', 'json output');
  program.command('update').option('--yes', 'apply update');
  return program;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('completion install helpers', () => {
  it('detects the shell from environment defaults', () => {
    expect(resolveCompletionShell(undefined, { SHELL: '/bin/zsh' } as NodeJS.ProcessEnv)).toBe(
      'zsh',
    );
    expect(
      resolveCompletionShell(undefined, { SHELL: '/usr/local/bin/pwsh' } as NodeJS.ProcessEnv),
    ).toBe('powershell');
  });

  it('resolves cache and profile paths for supported shells', () => {
    const homedir = '/tmp/response-home';

    expect(resolveCompletionCachePath('powershell', { homedir })).toBe(
      path.join(homedir, '.stateset', 'completions', 'response.ps1'),
    );
    expect(getShellProfilePath('bash', { homedir })).toBe(path.join(homedir, '.bashrc'));
    expect(getShellProfilePath('fish', { homedir })).toBe(
      path.join(homedir, '.config', 'fish', 'config.fish'),
    );
  });

  it('writes installable completion state and updates the shell profile', async () => {
    const homedir = createTempDir();

    const first = await installCompletion('bash', buildProgram(), ['--profile'], { homedir });
    const second = await installCompletion('bash', buildProgram(), ['--profile'], { homedir });

    expect(first.cachePath).toBe(path.join(homedir, '.stateset', 'completions', 'response.bash'));
    expect(first.profilePath).toBe(path.join(homedir, '.bashrc'));
    expect(second).toEqual(first);

    const completionScript = fs.readFileSync(first.cachePath, 'utf8');
    const profile = fs.readFileSync(first.profilePath, 'utf8');

    expect(completionScript).toContain('_response_completions');
    expect(profile).toContain('# StateSet Response Completion');
    expect(profile).toContain(`source "${first.cachePath}"`);
    expect(profile.match(/# StateSet Response Completion/g)).toHaveLength(1);
  });
});
