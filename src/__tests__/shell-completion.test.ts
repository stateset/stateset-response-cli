import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import {
  createCompletionSpec,
  renderBashCompletion,
  renderCompletionScript,
  renderFishCompletion,
  renderZshCompletion,
} from '../cli/shell-completion.js';

function buildProgram(): Command {
  const program = new Command();
  program.name('response').option('--json', 'json output').option('--output <mode>', 'output mode');

  program.command('capabilities');
  program
    .command('evals')
    .argument('[args...]', 'Evals command: list|create|create-from-response|update|review|<id>')
    .option('--status <status>', 'status filter')
    .option('--seed <mode>', 'seed mode')
    .option('--out <path>', 'output path');
  program
    .command('bulk')
    .argument('[args...]', 'bulk command: export [path] | import <file|directory>')
    .option('--out <path>', 'output path')
    .option('--dry-run', 'dry run');
  program
    .command('finetune')
    .argument('[args...]', 'Finetune command: list|export|validate|create|deploy')
    .option('--format <format>', 'dataset format')
    .option('--status <status>', 'status filter')
    .option('--method <method>', 'training method');
  program.command('config').command('show');

  const engine = program.command('engine');
  engine.command('status');
  engine.command('config').command('pull');

  return program;
}

describe('shell completion', () => {
  it('builds a completion spec from the commander tree', () => {
    const spec = createCompletionSpec(buildProgram(), ['--profile', '--dev']);

    expect(spec.rootCommands).toEqual(
      expect.arrayContaining(['bulk', 'capabilities', 'config', 'engine', 'evals', 'finetune']),
    );
    expect(spec.rootFlags).toEqual(
      expect.arrayContaining(['--json', '--output', '--profile', '--dev']),
    );
    expect(spec.pathMap.engine).toEqual(expect.arrayContaining(['config', 'status']));
    expect(spec.pathMap['engine config']).toEqual(expect.arrayContaining(['pull']));
    expect(spec.pathMap.evals).toEqual(
      expect.arrayContaining(['create', 'create-from-response', 'list', 'review', 'update']),
    );
    expect(spec.pathMap.bulk).toEqual(expect.arrayContaining(['export', 'import']));
    expect(spec.pathMap['evals create']).toEqual([]);
    expect(spec.flagMap.evals).toEqual(
      expect.arrayContaining(['--help', '--out', '--seed', '--status']),
    );
    expect(spec.flagMap['evals create-from-response']).toEqual(
      expect.arrayContaining(['--help', '--out', '--seed', '--status']),
    );
    expect(spec.flagMap.bulk).toEqual(expect.arrayContaining(['--dry-run', '--help', '--out']));
    expect(spec.flagValueMap['::--model']).toEqual(
      expect.arrayContaining(['haiku', 'opus', 'sonnet']),
    );
    expect(spec.flagValueMap['::--output']).toEqual(
      expect.arrayContaining(['json', 'minimal', 'pretty']),
    );
    expect(spec.flagValueMap['evals create-from-response::--seed']).toEqual(
      expect.arrayContaining(['none', 'preferred', 'rejected']),
    );
    expect(spec.flagValueMap['finetune create::--method']).toEqual(
      expect.arrayContaining(['dpo', 'supervised']),
    );
  });

  it('renders bash, zsh, and fish scripts from the same spec', () => {
    const spec = createCompletionSpec(buildProgram(), ['--profile', '--dev']);

    expect(renderBashCompletion(spec)).toContain('capabilities');
    expect(renderBashCompletion(spec)).toContain('_response_subcommands');
    expect(renderBashCompletion(spec)).toContain('_response_flags');
    expect(renderBashCompletion(spec)).toContain('_response_flag_values');
    expect(renderBashCompletion(spec)).toContain('evals create');
    expect(renderBashCompletion(spec)).toContain("_response_flags['evals create-from-response']");
    expect(renderBashCompletion(spec)).toContain(
      "_response_flag_values['evals create-from-response::--seed']",
    );
    expect(renderBashCompletion(spec)).toContain('--seed');
    expect(renderZshCompletion(spec)).toContain('compdef _response response');
    expect(renderZshCompletion(spec)).toContain('_response_flags');
    expect(renderZshCompletion(spec)).toContain('_response_flag_values');
    expect(renderZshCompletion(spec)).toContain('engine config');
    expect(renderFishCompletion(spec)).toContain(
      'complete -c response -n \'__response_path_is ""\'',
    );
    expect(renderFishCompletion(spec)).toContain('bulk capabilities config engine evals');
    expect(renderFishCompletion(spec)).toContain("-l model -xa 'haiku opus sonnet'");
    expect(renderFishCompletion(spec)).toContain(
      `complete -c response -n '__response_path_is "evals create-from-response"' -l seed -xa 'none preferred rejected'`,
    );
    expect(renderFishCompletion(spec)).toContain('__response_path_is "evals"');
  });

  it('rejects unsupported shells', () => {
    expect(() => renderCompletionScript('powershell', buildProgram())).toThrow(
      'Unknown shell: powershell. Use bash, zsh, or fish.',
    );
  });
});
