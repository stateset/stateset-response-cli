import chalk from 'chalk';
import inquirer from 'inquirer';
import { formatError, formatSuccess, formatWarning, formatTable } from '../utils/display.js';
import { getPromptTemplate, listPromptTemplates, getPromptTemplateFile } from '../resources.js';
import type { ChatContext, CommandResult } from './types.js';
import { readPromptHistory, appendPromptHistory } from './audit.js';
import { hasCommand } from './utils.js';

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function applyConditionals(content: string, vars: Record<string, string>): string {
  const hasValue = (v: string | undefined) => Boolean(v && v.trim().length > 0);
  const ifRegex = /{{#if\s+([a-zA-Z0-9_-]+)(?:\s*=\s*([^}]+?))?\s*}}([\s\S]*?){{\/if}}/g;
  const unlessRegex =
    /{{#unless\s+([a-zA-Z0-9_-]+)(?:\s*=\s*([^}]+?))?\s*}}([\s\S]*?){{\/unless}}/g;
  let output = content;
  output = output.replace(ifRegex, (_match, key: string, defaultRaw: string, body: string) => {
    const defaultValue = defaultRaw ? defaultRaw.trim().replace(/^['"]|['"]$/g, '') : '';
    const value = vars[key] ?? defaultValue;
    return hasValue(value) ? body : '';
  });
  output = output.replace(unlessRegex, (_match, key: string, defaultRaw: string, body: string) => {
    const defaultValue = defaultRaw ? defaultRaw.trim().replace(/^['"]|['"]$/g, '') : '';
    const value = vars[key] ?? defaultValue;
    return hasValue(value) ? '' : body;
  });
  return output;
}

export async function handleTemplateCommand(
  input: string,
  ctx: ChatContext,
): Promise<CommandResult> {
  // /prompts — list prompt templates
  if (hasCommand(input, '/prompts')) {
    const templates = listPromptTemplates(ctx.cwd);
    if (templates.length === 0) {
      console.log(formatSuccess('No prompt templates found.'));
    } else {
      console.log(formatSuccess('Available prompt templates:'));
      const rows = templates.map((template) => ({
        name: template.name,
        variables: template.variables.length
          ? template.variables
              .map((v) => (v.defaultValue ? `${v.name}=${v.defaultValue}` : v.name))
              .join(', ')
          : '-',
      }));
      console.log(formatTable(rows, ['name', 'variables']));
    }
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /prompt-history — show recent prompt template usage
  if (hasCommand(input, '/prompt-history')) {
    const history = readPromptHistory();
    if (history.length === 0) {
      console.log(formatSuccess('No prompt history yet.'));
    } else {
      console.log(formatSuccess('Recent prompt templates:'));
      const rows = history.map((entry) => ({
        template: entry.template,
        time: new Date(entry.ts).toLocaleString(),
        variables: Object.keys(entry.variables).length
          ? Object.entries(entry.variables)
              .map(([k, v]) => `${k}=${v}`)
              .join(', ')
          : '-',
      }));
      console.log(formatTable(rows, ['template', 'time', 'variables']));
    }
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /prompt-validate — validate prompt templates
  if (hasCommand(input, '/prompt-validate')) {
    const tokens = input.split(/\s+/).slice(1);
    const target = tokens[0];
    if (!target) {
      console.log(formatWarning('Usage: /prompt-validate <name|all>'));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    const templates =
      target === 'all'
        ? listPromptTemplates(ctx.cwd)
        : (() => {
            try {
              const template = getPromptTemplate(target, ctx.cwd);
              return template ? [template] : [];
            } catch (err) {
              console.error(formatError(err instanceof Error ? err.message : String(err)));
              return [];
            }
          })();

    if (templates.length === 0) {
      console.log(formatWarning(`No prompt templates found for "${target}".`));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    const results: Array<{ name: string; status: string; detail: string }> = [];
    for (const template of templates) {
      const file = getPromptTemplateFile(template.name, ctx.cwd);
      if (!file) {
        results.push({
          name: template.name,
          status: 'error',
          detail: 'Template file not found',
        });
        continue;
      }

      const rawContent = file.content;
      const includeRegex = /{{\s*(?:>\s*|include:)\s*([a-zA-Z0-9_-]+)([^}]*)}}/g;
      const includes = new Set<string>();
      let match: RegExpExecArray | null = null;
      while ((match = includeRegex.exec(rawContent))) {
        if (match[1]) includes.add(match[1].trim());
      }

      const missingIncludes = Array.from(includes).filter(
        (name) => !getPromptTemplateFile(name, ctx.cwd),
      );

      const errors: string[] = [];
      if (missingIncludes.length > 0) {
        errors.push(`Missing includes: ${missingIncludes.join(', ')}`);
      }

      const ifCount = (rawContent.match(/{{#if\s+[a-zA-Z0-9_-]+\s*}}/g) || []).length;
      const unlessCount = (rawContent.match(/{{#unless\s+[a-zA-Z0-9_-]+\s*}}/g) || []).length;
      const endIfCount = (rawContent.match(/{{\/if}}/g) || []).length;
      const endUnlessCount = (rawContent.match(/{{\/unless}}/g) || []).length;

      if (ifCount !== endIfCount) {
        errors.push(`Unmatched if blocks (${ifCount} open, ${endIfCount} close)`);
      }
      if (unlessCount !== endUnlessCount) {
        errors.push(`Unmatched unless blocks (${unlessCount} open, ${endUnlessCount} close)`);
      }

      const varMatches = rawContent.match(/{{\s*([a-zA-Z0-9_-]+)(?:\s*=.*)?\s*}}/g) || [];
      const declaredVars = new Set(template.variables.map((v) => v.name));
      const special = new Set(['#if', '/if', '#unless', '/unless']);
      const unknownVars = new Set<string>();
      const defaultValues = new Map<string, string>();
      const conflictingDefaults: string[] = [];
      for (const match of varMatches) {
        const tokenMatch = match.match(/{{\s*([a-zA-Z0-9_-]+)(?:\s*=.*)?\s*}}/);
        if (!tokenMatch) continue;
        const token = tokenMatch[1];
        if (special.has(token)) continue;
        if (declaredVars.has(token)) continue;
        unknownVars.add(token);

        const defaultMatch = match.match(/{{\s*([a-zA-Z0-9_-]+)\s*=\s*([^}]+?)\s*}}/);
        if (defaultMatch) {
          const name = defaultMatch[1];
          const value = defaultMatch[2].trim().replace(/^['"]|['"]$/g, '');
          if (defaultValues.has(name) && defaultValues.get(name) !== value) {
            conflictingDefaults.push(name);
          } else {
            defaultValues.set(name, value);
          }
        }
      }

      const condMatches =
        rawContent.match(/{{#(?:if|unless)\s+([a-zA-Z0-9_-]+)(?:\s*=\s*[^}]+?)?\s*}}/g) || [];
      for (const matchText of condMatches) {
        const tokenMatch = matchText.match(
          /{{#(?:if|unless)\s+([a-zA-Z0-9_-]+)(?:\s*=\s*([^}]+?))?\s*}}/,
        );
        if (!tokenMatch) continue;
        const name = tokenMatch[1];
        const value = tokenMatch[2] ? tokenMatch[2].trim().replace(/^['"]|['"]$/g, '') : undefined;
        if (value) {
          if (defaultValues.has(name) && defaultValues.get(name) !== value) {
            conflictingDefaults.push(name);
          } else {
            defaultValues.set(name, value);
          }
        }
      }

      if (unknownVars.size > 0) {
        errors.push(`Unknown variables: ${Array.from(unknownVars).join(', ')}`);
      }

      if (conflictingDefaults.length > 0) {
        const unique = Array.from(new Set(conflictingDefaults));
        errors.push(`Conflicting defaults: ${unique.join(', ')}`);
      }

      const usedVars = new Set<string>();
      for (const matchText of varMatches) {
        const tokenMatch = matchText.match(/{{\s*([a-zA-Z0-9_-]+)(?:\s*=.*)?\s*}}/);
        if (!tokenMatch) continue;
        const token = tokenMatch[1];
        if (special.has(token)) continue;
        usedVars.add(token);
      }
      for (const matchText of condMatches) {
        const tokenMatch = matchText.match(
          /{{#(?:if|unless)\s+([a-zA-Z0-9_-]+)(?:\s*=\s*[^}]+?)?\s*}}/,
        );
        if (!tokenMatch) continue;
        usedVars.add(tokenMatch[1]);
      }
      const unusedVars = Array.from(declaredVars).filter((name) => !usedVars.has(name));
      if (unusedVars.length > 0) {
        errors.push(`Unused variables: ${unusedVars.join(', ')}`);
      }

      if (errors.length > 0) {
        results.push({
          name: template.name,
          status: 'error',
          detail: errors.join('; '),
        });
      } else {
        results.push({ name: template.name, status: 'ok', detail: 'Valid' });
      }
    }

    console.log(formatSuccess('Prompt validation results:'));
    console.log(formatTable(results, ['name', 'status', 'detail']));
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /prompt <name> — expand and optionally send a prompt template
  if (hasCommand(input, '/prompt') && !hasCommand(input, '/prompt-')) {
    const templateName = input.slice('/prompt '.length).trim();
    if (!templateName) {
      console.log(formatWarning('Usage: /prompt <name>'));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    let template;
    try {
      template = getPromptTemplate(templateName, ctx.cwd);
    } catch (err) {
      console.error(formatError(err instanceof Error ? err.message : String(err)));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }
    if (!template) {
      console.log(
        formatWarning(
          `Prompt template "${templateName}" not found. Use /prompts to list templates.`,
        ),
      );
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    let expanded = template.content;

    const variableValues: Record<string, string> = {};
    if (template.variables.length > 0) {
      ctx.rl.pause();
      const answers = await inquirer.prompt(
        template.variables.map((variable) => ({
          type: 'input',
          name: variable.name,
          message: `${variable.name}:`,
          default: variable.defaultValue ?? undefined,
        })),
      );
      ctx.rl.resume();
      for (const variable of template.variables) {
        const value = String(answers[variable.name] ?? '').trim() || (variable.defaultValue ?? '');
        variableValues[variable.name] = value;
        expanded = expanded.replace(
          new RegExp(`{{\\s*${escapeRegExp(variable.name)}(?:\\s*=\\s*[^}]+?)?\\s*}}`, 'g'),
          value,
        );
      }
    }

    expanded = applyConditionals(expanded, variableValues);

    console.log(chalk.gray('\n  Prompt template preview:'));
    console.log(chalk.gray(expanded));
    ctx.rl.pause();
    const { send } = await inquirer.prompt([
      { type: 'confirm', name: 'send', message: 'Send this prompt?', default: true },
    ]);
    ctx.rl.resume();
    if (!send) {
      console.log(formatWarning('Prompt cancelled.'));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    appendPromptHistory({
      ts: new Date().toISOString(),
      template: template.name,
      variables: variableValues,
    });

    return { handled: true, sendMessage: expanded };
  }

  return { handled: false };
}
