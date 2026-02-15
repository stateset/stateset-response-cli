import fs from 'node:fs';
import path from 'node:path';
import { getStateSetDir } from './session.js';

export interface ResourceFile {
  path: string;
  displayPath: string;
  content: string;
}

export interface PromptTemplate {
  name: string;
  path: string;
  displayPath: string;
  content: string;
  variables: Array<{ name: string; defaultValue?: string }>;
}

export interface SkillResource {
  name: string;
  path: string;
  displayPath: string;
  description: string;
  content: string;
}

const CONTEXT_FILENAMES = ['AGENTS.md', 'CLAUDE.md'];

function readFileIfExists(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.trim().length ? content.trim() : null;
  } catch {
    return null;
  }
}

export function getDisplayPath(cwd: string, filePath: string): string {
  const rel = path.relative(cwd, filePath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return filePath;
  }
  return rel.startsWith('.') ? rel : `./${rel}`;
}

export function collectParentDirs(cwd: string): string[] {
  const dirs: string[] = [];
  let current = path.resolve(cwd);
  while (true) {
    dirs.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs.reverse();
}

export function loadContextFiles(cwd: string = process.cwd()): ResourceFile[] {
  const results: ResourceFile[] = [];
  const seen = new Set<string>();
  const addFile = (filePath: string) => {
    const content = readFileIfExists(filePath);
    if (!content) return;
    if (seen.has(filePath)) return;
    seen.add(filePath);
    results.push({
      path: filePath,
      displayPath: getDisplayPath(cwd, filePath),
      content,
    });
  };

  const globalDir = getStateSetDir();
  for (const name of CONTEXT_FILENAMES) {
    addFile(path.join(globalDir, name));
  }

  const projectDir = path.join(cwd, '.stateset');
  for (const name of CONTEXT_FILENAMES) {
    addFile(path.join(projectDir, name));
  }

  for (const dir of collectParentDirs(cwd)) {
    for (const name of CONTEXT_FILENAMES) {
      addFile(path.join(dir, name));
    }
  }

  return results;
}

export function loadSystemPromptFiles(cwd: string = process.cwd()): {
  override: ResourceFile | null;
  append: ResourceFile[];
} {
  const globalDir = getStateSetDir();
  const projectDir = path.join(cwd, '.stateset');

  const overridePath = fs.existsSync(path.join(projectDir, 'SYSTEM.md'))
    ? path.join(projectDir, 'SYSTEM.md')
    : fs.existsSync(path.join(globalDir, 'SYSTEM.md'))
      ? path.join(globalDir, 'SYSTEM.md')
      : null;

  const overrideContent = overridePath ? readFileIfExists(overridePath) : null;
  const override =
    overridePath && overrideContent
      ? {
          path: overridePath,
          displayPath: getDisplayPath(cwd, overridePath),
          content: overrideContent,
        }
      : null;

  const append: ResourceFile[] = [];
  const appendPaths = [
    path.join(globalDir, 'APPEND_SYSTEM.md'),
    path.join(projectDir, 'APPEND_SYSTEM.md'),
  ];

  for (const filePath of appendPaths) {
    const content = readFileIfExists(filePath);
    if (!content) continue;
    append.push({
      path: filePath,
      displayPath: getDisplayPath(cwd, filePath),
      content,
    });
  }

  return { override, append };
}

export function extractTemplateVariables(
  content: string,
): Array<{ name: string; defaultValue?: string }> {
  const regex = /{{\s*([a-zA-Z0-9_-]+)(?:\s*=\s*([^}]+?))?\s*}}/g;
  const vars = new Map<string, { name: string; defaultValue?: string }>();
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(content))) {
    const name = match[1];
    const defaultValue = match[2] ? match[2].trim().replace(/^['"]|['"]$/g, '') : undefined;
    if (!vars.has(name)) {
      vars.set(name, { name, defaultValue });
    } else if (defaultValue && !vars.get(name)?.defaultValue) {
      vars.set(name, { name, defaultValue });
    }
  }

  const condRegex = /{{#(?:if|unless)\s+([a-zA-Z0-9_-]+)(?:\s*=\s*([^}]+?))?\s*}}/g;
  while ((match = condRegex.exec(content))) {
    const name = match[1];
    const defaultValue = match[2] ? match[2].trim().replace(/^['"]|['"]$/g, '') : undefined;
    if (!vars.has(name)) {
      vars.set(name, { name, defaultValue });
    } else if (defaultValue && !vars.get(name)?.defaultValue) {
      vars.set(name, { name, defaultValue });
    }
  }
  return Array.from(vars.values());
}

interface PromptTemplateFile {
  name: string;
  path: string;
  displayPath: string;
  content: string;
}

function loadPromptTemplateFilesFromDir(
  dir: string,
  cwd: string,
  map: Map<string, PromptTemplateFile>,
): void {
  if (!fs.existsSync(dir)) return;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.md')) continue;
    const fullPath = path.join(dir, entry.name);
    const content = readFileIfExists(fullPath);
    if (!content) continue;
    const name = entry.name.replace(/\.md$/i, '');
    map.set(name, {
      name,
      path: fullPath,
      displayPath: getDisplayPath(cwd, fullPath),
      content,
    });
  }
}

function loadPromptTemplateFiles(cwd: string): Map<string, PromptTemplateFile> {
  const map = new Map<string, PromptTemplateFile>();
  const globalDir = path.join(getStateSetDir(), 'prompts');
  const projectDir = path.join(cwd, '.stateset', 'prompts');
  loadPromptTemplateFilesFromDir(globalDir, cwd, map);
  loadPromptTemplateFilesFromDir(projectDir, cwd, map);
  return map;
}

export function parseIncludeArgs(
  rawArgs: string,
  parentVars: Record<string, string>,
): Record<string, string> {
  const vars: Record<string, string> = { ...parentVars };
  if (!rawArgs) return vars;
  const argText = rawArgs.trim();
  if (!argText) return vars;
  const regex = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(argText))) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    vars[key] = value;
  }
  return vars;
}

function applyIncludeVars(content: string, vars: Record<string, string>): string {
  if (!vars || Object.keys(vars).length === 0) return content;
  let output = content;
  for (const [key, value] of Object.entries(vars)) {
    const regex = new RegExp(`{{\\s*${key}(?:\\s*=\\s*[^}]+?)?\\s*}}`, 'g');
    output = output.replace(regex, value);
  }
  return output;
}

function expandPromptTemplate(
  name: string,
  files: Map<string, PromptTemplateFile>,
  stack: string[] = [],
  parentVars: Record<string, string> = {},
  collectedDefaults?: Map<string, string>,
): string {
  if (stack.includes(name)) {
    throw new Error(`Prompt include cycle detected: ${[...stack, name].join(' -> ')}`);
  }
  const file = files.get(name);
  if (!file) {
    throw new Error(`Prompt template "${name}" not found`);
  }

  const includeRegex = /{{\s*(?:>\s*|include:)\s*([a-zA-Z0-9_-]+)([^}]*)}}/g;
  const nextStack = [...stack, name];

  return file.content.replace(includeRegex, (_match, includeName: string, rawArgs: string) => {
    const childName = String(includeName || '').trim();
    if (!childName) return '';
    const vars = parseIncludeArgs(rawArgs || '', parentVars);
    if (collectedDefaults) {
      for (const [key, value] of Object.entries(vars)) {
        if (!collectedDefaults.has(key)) {
          collectedDefaults.set(key, value);
        }
      }
    }
    const expanded = expandPromptTemplate(childName, files, nextStack, vars, collectedDefaults);
    return applyIncludeVars(expanded, vars);
  });
}

function mergeCollectedDefaults(
  variables: Array<{ name: string; defaultValue?: string }>,
  collectedDefaults: Map<string, string>,
): Array<{ name: string; defaultValue?: string }> {
  for (const v of variables) {
    if (!v.defaultValue && collectedDefaults.has(v.name)) {
      v.defaultValue = collectedDefaults.get(v.name);
    }
  }
  return variables;
}

export function listPromptTemplates(cwd: string = process.cwd()): PromptTemplate[] {
  const files = loadPromptTemplateFiles(cwd);
  const templates: PromptTemplate[] = [];
  for (const file of files.values()) {
    let content = file.content;
    const collectedDefaults = new Map<string, string>();
    try {
      content = expandPromptTemplate(file.name, files, [], {}, collectedDefaults);
    } catch {
      content = file.content;
    }
    const variables = mergeCollectedDefaults(extractTemplateVariables(content), collectedDefaults);
    templates.push({
      name: file.name,
      path: file.path,
      displayPath: file.displayPath,
      content,
      variables,
    });
  }
  return templates.sort((a, b) => a.name.localeCompare(b.name));
}

export function getPromptTemplate(
  name: string,
  cwd: string = process.cwd(),
): PromptTemplate | null {
  const files = loadPromptTemplateFiles(cwd);
  const file = files.get(name);
  if (!file) return null;
  const collectedDefaults = new Map<string, string>();
  const content = expandPromptTemplate(name, files, [], {}, collectedDefaults);
  const variables = mergeCollectedDefaults(extractTemplateVariables(content), collectedDefaults);
  return {
    name: file.name,
    path: file.path,
    displayPath: file.displayPath,
    content,
    variables,
  };
}

export function getPromptTemplateFile(
  name: string,
  cwd: string = process.cwd(),
): PromptTemplateFile | null {
  const files = loadPromptTemplateFiles(cwd);
  return files.get(name) || null;
}

export function stripFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== '---') {
    return { frontmatter: {}, body: content.trim() };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { frontmatter: {}, body: content.trim() };
  }

  const frontmatterLines = lines.slice(1, endIndex);
  const frontmatter: Record<string, string> = {};
  for (const line of frontmatterLines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) frontmatter[key] = value;
  }

  const body = lines
    .slice(endIndex + 1)
    .join('\n')
    .trim();
  return { frontmatter, body };
}

function extractDescription(body: string): string {
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    return trimmed;
  }
  return '';
}

function loadSkillFromFile(filePath: string, name: string, cwd: string): SkillResource | null {
  const content = readFileIfExists(filePath);
  if (!content) return null;
  const { frontmatter, body } = stripFrontmatter(content);
  const description = (frontmatter.description as string | undefined) || extractDescription(body);
  return {
    name,
    path: filePath,
    displayPath: getDisplayPath(cwd, filePath),
    description: description || '',
    content: body,
  };
}

function loadSkillsFromDir(dir: string, cwd: string, map: Map<string, SkillResource>): void {
  if (!fs.existsSync(dir)) return;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules') continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const name = entry.name.replace(/\.md$/i, '');
      const skill = loadSkillFromFile(fullPath, name, cwd);
      if (skill) map.set(name, skill);
      continue;
    }

    if (entry.isDirectory()) {
      const skillPath = path.join(fullPath, 'SKILL.md');
      if (!fs.existsSync(skillPath)) continue;
      const name = entry.name;
      const skill = loadSkillFromFile(skillPath, name, cwd);
      if (skill) map.set(name, skill);
    }
  }
}

export function listSkills(cwd: string = process.cwd()): SkillResource[] {
  const map = new Map<string, SkillResource>();
  const globalDir = path.join(getStateSetDir(), 'skills');
  const projectDir = path.join(cwd, '.stateset', 'skills');
  loadSkillsFromDir(globalDir, cwd, map);
  loadSkillsFromDir(projectDir, cwd, map);
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function getSkill(name: string, cwd: string = process.cwd()): SkillResource | null {
  const skills = listSkills(cwd);
  return skills.find((skill) => skill.name === name) || null;
}
