import { describe, expect, it, vi } from 'vitest';
import type { ShortcutLogger, ShortcutRunner } from '../cli/shortcuts/types.js';
import { runRulesCommand } from '../cli/shortcuts/rules.js';
import { runAgentsCommand } from '../cli/shortcuts/agents.js';

function createLogger(): ShortcutLogger & {
  success: ReturnType<typeof vi.fn>;
  warning: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  output: ReturnType<typeof vi.fn>;
  done: ReturnType<typeof vi.fn>;
} {
  return {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    output: vi.fn(),
    done: vi.fn(),
  };
}

describe('bulk shortcut operations', () => {
  it('disables rules by tag using bulk_update_rule_status', async () => {
    const logger = createLogger();
    const runner: ShortcutRunner = {
      callTool: vi.fn(async (toolName: string) => {
        if (toolName === 'list_rules') {
          return {
            payload: [
              { id: 'rule-1', metadata: { tags: ['holiday-promo'] } },
              { id: 'rule-2', metadata: { tags: ['holiday-promo', 'seasonal'] } },
              { id: 'rule-3', metadata: { tags: ['other'] } },
            ],
            rawText: '',
            isError: false,
          };
        }
        if (toolName === 'bulk_update_rule_status') {
          return {
            payload: { affected_rows: 2 },
            rawText: '',
            isError: false,
          };
        }
        throw new Error(`Unexpected tool ${toolName}`);
      }) as unknown as ShortcutRunner['callTool'],
    };

    await runRulesCommand(['disable', '--tag', 'holiday-promo'], runner, logger, false);

    expect(runner.callTool).toHaveBeenCalledWith('list_rules', { limit: 1000, offset: 0 });
    expect(runner.callTool).toHaveBeenCalledWith('bulk_update_rule_status', {
      ids: ['rule-1', 'rule-2'],
      activated: false,
    });
  });

  it('updates model across all agent settings', async () => {
    const logger = createLogger();
    const runner: ShortcutRunner = {
      callTool: vi.fn(async (toolName: string, args?: Record<string, unknown>) => {
        if (toolName === 'list_agent_settings') {
          return {
            payload: [{ id: 1 }, { id: 2 }],
            rawText: '',
            isError: false,
          };
        }
        if (toolName === 'update_agent_settings') {
          return {
            payload: { id: args?.id, model_name: args?.model_name },
            rawText: '',
            isError: false,
          };
        }
        throw new Error(`Unexpected tool ${toolName}`);
      }) as unknown as ShortcutRunner['callTool'],
    };

    await runAgentsCommand(
      ['update', '--all', '--model', 'claude-sonnet-4'],
      runner,
      logger,
      false,
    );

    expect(runner.callTool).toHaveBeenCalledWith('list_agent_settings', {});
    expect(runner.callTool).toHaveBeenCalledWith('update_agent_settings', {
      id: 1,
      model_name: 'claude-sonnet-4',
    });
    expect(runner.callTool).toHaveBeenCalledWith('update_agent_settings', {
      id: 2,
      model_name: 'claude-sonnet-4',
    });
    expect(logger.success).toHaveBeenCalledWith('Updated 2 target(s)');
  });
});
