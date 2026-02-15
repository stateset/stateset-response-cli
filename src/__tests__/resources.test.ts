import { describe, it, expect } from 'vitest';
import {
  extractTemplateVariables,
  parseIncludeArgs,
  stripFrontmatter,
  getDisplayPath,
  collectParentDirs,
} from '../resources.js';

describe('extractTemplateVariables', () => {
  it('extracts simple variable', () => {
    const vars = extractTemplateVariables('Hello {{name}}!');
    expect(vars).toEqual([{ name: 'name' }]);
  });

  it('extracts variable with default value', () => {
    const vars = extractTemplateVariables('Color: {{color = "blue"}}');
    expect(vars).toEqual([{ name: 'color', defaultValue: 'blue' }]);
  });

  it('extracts variable with single-quoted default', () => {
    const vars = extractTemplateVariables("Mode: {{mode = 'dark'}}");
    expect(vars).toEqual([{ name: 'mode', defaultValue: 'dark' }]);
  });

  it('extracts conditional variable from #if', () => {
    const vars = extractTemplateVariables('{{#if active}}show{{/if}}');
    expect(vars).toEqual([{ name: 'active' }]);
  });

  it('extracts conditional variable from #unless with default', () => {
    const vars = extractTemplateVariables("{{#unless mode = 'dark'}}light{{/unless}}");
    expect(vars).toEqual([{ name: 'mode', defaultValue: 'dark' }]);
  });

  it('returns empty array when no variables', () => {
    expect(extractTemplateVariables('Hello world!')).toEqual([]);
  });

  it('deduplicates same variable referenced twice', () => {
    const vars = extractTemplateVariables('{{name}} and {{name}}');
    expect(vars).toHaveLength(1);
    expect(vars[0].name).toBe('name');
  });

  it('uses first non-empty default when variable appears with and without default', () => {
    const vars = extractTemplateVariables('{{color}} then {{color = "red"}}');
    expect(vars).toHaveLength(1);
    expect(vars[0]).toEqual({ name: 'color', defaultValue: 'red' });
  });

  it('extracts multiple distinct variables', () => {
    const vars = extractTemplateVariables('{{first}} {{last}} {{#if active}}yes{{/if}}');
    expect(vars).toHaveLength(3);
    const names = vars.map((v) => v.name);
    expect(names).toContain('first');
    expect(names).toContain('last');
    expect(names).toContain('active');
  });
});

describe('parseIncludeArgs', () => {
  it('parses double-quoted values', () => {
    const result = parseIncludeArgs('name="hello world"', {});
    expect(result).toEqual({ name: 'hello world' });
  });

  it('parses single-quoted values', () => {
    const result = parseIncludeArgs("color='red'", {});
    expect(result).toEqual({ color: 'red' });
  });

  it('parses unquoted values', () => {
    const result = parseIncludeArgs('key=val', {});
    expect(result).toEqual({ key: 'val' });
  });

  it('returns copy of parentVars when args empty', () => {
    const parent = { existing: 'value' };
    const result = parseIncludeArgs('', parent);
    expect(result).toEqual({ existing: 'value' });
    expect(result).not.toBe(parent); // should be a new object
  });

  it('inherits and overrides parent vars', () => {
    const parent = { a: '1', b: '2' };
    const result = parseIncludeArgs('b="overridden" c="3"', parent);
    expect(result).toEqual({ a: '1', b: 'overridden', c: '3' });
  });

  it('handles multiple args', () => {
    const result = parseIncludeArgs('x="1" y=2 z=\'three\'', {});
    expect(result).toEqual({ x: '1', y: '2', z: 'three' });
  });
});

describe('stripFrontmatter', () => {
  it('extracts frontmatter key-value pairs and body', () => {
    const content = '---\ntitle: My Template\nauthor: Test\n---\nBody content here';
    const result = stripFrontmatter(content);
    expect(result.frontmatter).toEqual({ title: 'My Template', author: 'Test' });
    expect(result.body).toBe('Body content here');
  });

  it('returns empty frontmatter when none present', () => {
    const content = 'Just body content';
    const result = stripFrontmatter(content);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe('Just body content');
  });

  it('returns empty frontmatter when unclosed', () => {
    const content = '---\ntitle: incomplete\nNo closing delimiter';
    const result = stripFrontmatter(content);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(content.trim());
  });

  it('handles empty body after frontmatter', () => {
    const content = '---\nkey: value\n---\n';
    const result = stripFrontmatter(content);
    expect(result.frontmatter).toEqual({ key: 'value' });
    expect(result.body).toBe('');
  });

  it('splits only on first colon in values', () => {
    const content = '---\nurl: https://example.com:8080/path\n---\nbody';
    const result = stripFrontmatter(content);
    expect(result.frontmatter).toEqual({ url: 'https://example.com:8080/path' });
    expect(result.body).toBe('body');
  });

  it('handles empty string', () => {
    const result = stripFrontmatter('');
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe('');
  });
});

describe('getDisplayPath', () => {
  it('returns relative path for file inside cwd', () => {
    const result = getDisplayPath('/home/user/project', '/home/user/project/src/file.ts');
    expect(result).toBe('./src/file.ts');
  });

  it('returns absolute path for file outside cwd', () => {
    const result = getDisplayPath('/home/user/project', '/etc/config.json');
    expect(result).toBe('/etc/config.json');
  });

  it('returns dotfile path as-is', () => {
    const result = getDisplayPath('/home/user/project', '/home/user/project/.stateset/config');
    expect(result).toBe('.stateset/config');
  });

  it('handles same directory', () => {
    const result = getDisplayPath('/home/user/project', '/home/user/project/file.ts');
    expect(result).toBe('./file.ts');
  });
});

describe('collectParentDirs', () => {
  it('returns root-to-leaf order', () => {
    const dirs = collectParentDirs('/home/user/project');
    expect(dirs[0]).toBe('/');
    expect(dirs[dirs.length - 1]).toBe('/home/user/project');
  });

  it('returns just root for root path', () => {
    const dirs = collectParentDirs('/');
    expect(dirs).toEqual(['/']);
  });

  it('includes all ancestors for deep path', () => {
    const dirs = collectParentDirs('/a/b/c');
    expect(dirs).toEqual(['/', '/a', '/a/b', '/a/b/c']);
  });
});
