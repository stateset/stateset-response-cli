import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'node:fs';
import { formatError, formatSuccess, formatWarning, formatTable } from '../utils/display.js';
import type { ChatContext, CommandResult } from './types.js';
import { getStateSetDir } from '../session.js';
import { hasCommand, ensureDirExists, resolveSafeOutputPath } from './utils.js';
import {
  writePermissionStore,
  readPolicyOverridesDetailed,
  writePolicyOverrides,
  readPolicyFile,
} from './permissions.js';

export async function handlePolicyCommand(input: string, ctx: ChatContext): Promise<CommandResult> {
  // /permissions — manage stored tool hook permissions
  if (hasCommand(input, '/permissions')) {
    const tokens = input.split(/\s+/).slice(1);
    const action = tokens[0];
    if (!action || action === 'list') {
      const entries = Object.entries(ctx.permissionStore.toolHooks || {});
      if (entries.length === 0) {
        console.log(formatSuccess('No stored permissions.'));
      } else {
        console.log(formatSuccess('Stored permissions:'));
        const rows = entries.map(([key, decision]) => {
          const [hook, tool] = key.split('::');
          return { hook: hook || key, tool: tool || '-', decision };
        });
        console.log(formatTable(rows, ['hook', 'tool', 'decision']));
      }
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    if (action === 'clear') {
      ctx.rl.pause();
      const { confirmClear } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmClear',
          message: 'Clear all stored permissions?',
          default: false,
        },
      ]);
      ctx.rl.resume();
      if (!confirmClear) {
        console.log(formatWarning('Permissions clear cancelled.'));
        console.log('');
        ctx.rl.prompt();
        return { handled: true };
      }
      ctx.permissionStore = { toolHooks: {} };
      writePermissionStore(ctx.permissionStore);
      console.log(formatSuccess('Stored permissions cleared.'));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    console.log(formatWarning('Usage: /permissions [list|clear]'));
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  // /policy — manage policy overrides
  if (hasCommand(input, '/policy')) {
    const tokens = input.split(/\s+/).slice(1);
    const action = tokens[0];
    if (!action || action === 'list') {
      const mode = tokens.includes('local')
        ? 'local'
        : tokens.includes('global')
          ? 'global'
          : 'merged';
      const data = readPolicyOverridesDetailed(ctx.cwd);
      const view = mode === 'local' ? data.local : mode === 'global' ? data.global : data.merged;
      const entries = Object.entries(view.toolHooks || {});
      if (entries.length === 0) {
        console.log(formatSuccess('No policy overrides set.'));
      } else {
        console.log(formatSuccess(`Policy overrides (${mode}):`));
        const rows: Record<string, string>[] = entries.map(([hook, decision]) => {
          const source = data.local.toolHooks[hook] ? 'local' : 'global';
          return { hook, decision: String(decision), source };
        });
        console.log(
          formatTable(
            rows,
            mode === 'merged' ? ['hook', 'decision', 'source'] : ['hook', 'decision'],
          ),
        );
      }
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    if (action === 'set') {
      const hook = tokens[1];
      const decision = tokens[2];
      if (!hook || !decision || !['allow', 'deny'].includes(decision)) {
        console.log(formatWarning('Usage: /policy set <hook> <allow|deny>'));
        console.log('');
        ctx.rl.prompt();
        return { handled: true };
      }
      const data = readPolicyOverridesDetailed(ctx.cwd).local;
      data.toolHooks[hook] = decision;
      writePolicyOverrides(ctx.cwd, data);
      await ctx.extensions.load(ctx.cwd);
      console.log(formatSuccess(`Policy set: ${hook} -> ${decision}`));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    if (action === 'unset') {
      const hook = tokens[1];
      if (!hook) {
        console.log(formatWarning('Usage: /policy unset <hook>'));
        console.log('');
        ctx.rl.prompt();
        return { handled: true };
      }
      const data = readPolicyOverridesDetailed(ctx.cwd).local;
      if (!data.toolHooks[hook]) {
        console.log(formatWarning(`No policy set for "${hook}".`));
        console.log('');
        ctx.rl.prompt();
        return { handled: true };
      }
      delete data.toolHooks[hook];
      writePolicyOverrides(ctx.cwd, data);
      await ctx.extensions.load(ctx.cwd);
      console.log(formatSuccess(`Policy removed: ${hook}`));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    if (action === 'clear') {
      ctx.rl.pause();
      const { confirmClear } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmClear',
          message: 'Clear all policy overrides?',
          default: false,
        },
      ]);
      ctx.rl.resume();
      if (!confirmClear) {
        console.log(formatWarning('Policy clear cancelled.'));
        console.log('');
        ctx.rl.prompt();
        return { handled: true };
      }
      writePolicyOverrides(ctx.cwd, { toolHooks: {} });
      await ctx.extensions.load(ctx.cwd);
      console.log(formatSuccess('Policy overrides cleared.'));
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    if (action === 'export') {
      const outToken = tokens.find((t) => t.startsWith('out='));
      const outPath = outToken ? outToken.slice('out='.length) : null;
      const allowUnsafePath = tokens.includes('--unsafe-path');
      const mode = tokens.includes('local')
        ? 'local'
        : tokens.includes('global')
          ? 'global'
          : 'merged';
      const data = readPolicyOverridesDetailed(ctx.cwd);
      const view = mode === 'local' ? data.local : mode === 'global' ? data.global : data.merged;
      const defaultPath = mode === 'global' ? data.globalPath : data.localPath;
      const resolved = outPath
        ? resolveSafeOutputPath(outPath, {
            label: 'Policy export target',
            allowOutside: allowUnsafePath,
            allowedRoots: [ctx.cwd, getStateSetDir()],
          })
        : defaultPath;
      try {
        ensureDirExists(resolved);
        fs.writeFileSync(resolved, JSON.stringify(view, null, 2), 'utf-8');
        console.log(formatSuccess(`Policy overrides (${mode}) exported to ${resolved}`));
      } catch (err) {
        console.error(formatError(err instanceof Error ? err.message : String(err)));
      }
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    if (action === 'edit') {
      const details = readPolicyOverridesDetailed(ctx.cwd);
      const target = details.localPath;
      console.log(formatSuccess('Policy file location:'));
      console.log(chalk.gray(`  ${target}`));
      if (!fs.existsSync(target)) {
        console.log(chalk.gray('  (file does not exist; it will be created on save)'));
      }
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    if (action === 'init') {
      const details = readPolicyOverridesDetailed(ctx.cwd);
      const target = details.localPath;
      if (fs.existsSync(target)) {
        console.log(formatWarning('Policy file already exists.'));
        console.log(chalk.gray(`  ${target}`));
        console.log('');
        ctx.rl.prompt();
        return { handled: true };
      }
      const starter = {
        toolHooks: {
          'example-hook': 'deny',
        },
      };
      try {
        ensureDirExists(target);
        fs.writeFileSync(target, JSON.stringify(starter, null, 2), 'utf-8');
        console.log(formatSuccess('Created policy file.'));
        console.log(chalk.gray(`  ${target}`));
      } catch (err) {
        console.error(formatError(err instanceof Error ? err.message : String(err)));
      }
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    if (action === 'import') {
      const fileToken = tokens[1];
      if (!fileToken) {
        console.log(formatWarning('Usage: /policy import <path> [merge|replace]'));
        console.log('');
        ctx.rl.prompt();
        return { handled: true };
      }
      const mode = tokens[2] === 'replace' ? 'replace' : 'merge';
      try {
        const incoming = readPolicyFile(fileToken);
        const current = readPolicyOverridesDetailed(ctx.cwd).local;
        const next =
          mode === 'replace'
            ? incoming
            : { toolHooks: { ...current.toolHooks, ...incoming.toolHooks } };
        writePolicyOverrides(ctx.cwd, next);
        await ctx.extensions.load(ctx.cwd);
        console.log(formatSuccess(`Policy overrides imported (${mode}).`));
      } catch (err) {
        console.error(formatError(err instanceof Error ? err.message : String(err)));
      }
      console.log('');
      ctx.rl.prompt();
      return { handled: true };
    }

    console.log(formatWarning('Usage: /policy [list|set|unset|clear|export|import]'));
    console.log('');
    ctx.rl.prompt();
    return { handled: true };
  }

  return { handled: false };
}
