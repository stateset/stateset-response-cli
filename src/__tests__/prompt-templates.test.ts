import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getPromptTemplate } from '../resources.js';

function setupTempPrompts(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stateset-prompts-'));
  const promptsDir = path.join(dir, '.stateset', 'prompts');
  fs.mkdirSync(promptsDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(promptsDir, `${name}.md`), content, 'utf-8');
  }
  return dir;
}

describe('prompt templates', () => {
  it('expands includes with variables', () => {
    const cwd = setupTempPrompts({
      base: 'Hello {{> part name="Ada"}}',
      part: 'Name: {{name}}',
    });

    const template = getPromptTemplate('base', cwd);
    expect(template).not.toBeNull();
    expect(template?.content).toContain('Name: Ada');
  });

  it('preserves conditionals in included partials', () => {
    const cwd = setupTempPrompts({
      base: 'Intro {{> part flag=yes}}',
      part: '{{#if flag}}Visible{{/if}}',
    });

    const template = getPromptTemplate('base', cwd);
    expect(template).not.toBeNull();
    const flagVar = template?.variables.find((v) => v.name === 'flag');
    expect(flagVar?.defaultValue).toBe('yes');
    expect(template?.content).toContain('{{#if flag}}');
    expect(template?.content).toContain('{{/if}}');
  });

  it('detects include cycles', () => {
    const cwd = setupTempPrompts({
      a: 'A {{> b}}',
      b: 'B {{> a}}',
    });

    expect(() => getPromptTemplate('a', cwd)).toThrow(/cycle/i);
  });
});
