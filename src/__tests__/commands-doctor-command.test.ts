import { describe, expect, it, vi } from 'vitest';
import { applyDoctorFixes, runDoctorCommand, type DoctorCheck } from '../cli/commands-doctor.js';

describe('commands-doctor command runner', () => {
  it('applies repairs and reports post-repair JSON status', async () => {
    const logs: string[] = [];
    const fix = vi.fn();
    const runChecks = vi
      .fn()
      .mockResolvedValueOnce([
        {
          name: 'Permissions',
          status: 'warn',
          message: 'Config file permissions need repair',
          fix,
          fixDescription: 'Tighten permissions',
        },
      ])
      .mockResolvedValueOnce([
        {
          name: 'Permissions',
          status: 'pass',
          message: 'Permissions OK',
        },
      ]);

    const exitCode = await runDoctorCommand(
      { json: true, repair: true },
      {
        log: (message) => logs.push(message),
        runChecks,
      },
    );

    expect(exitCode).toBe(0);
    expect(fix).toHaveBeenCalledTimes(1);
    expect(runChecks).toHaveBeenCalledTimes(2);

    const payload = JSON.parse(logs[0] ?? '');
    expect(payload).toMatchObject({
      repairRequested: true,
      summary: { passed: 0, warnings: 1, failed: 0 },
      repairs: [{ name: 'Permissions', status: 'applied', description: 'Tighten permissions' }],
      postRepair: {
        summary: { passed: 1, warnings: 0, failed: 0 },
      },
    });
  });

  it('returns the original failure when repair is requested but nothing is fixable', async () => {
    const logs: string[] = [];

    const exitCode = await runDoctorCommand(
      { repair: true },
      {
        log: (message) => logs.push(message),
        runChecks: async () => [
          {
            name: 'Config',
            status: 'fail',
            message: 'Missing configuration',
          },
        ],
      },
    );

    expect(exitCode).toBe(1);
    expect(logs.join('\n')).toContain('No auto-fixable issues found.');
  });

  it('captures repair failures without stopping the remaining report', () => {
    const checks: DoctorCheck[] = [
      {
        name: 'Permissions',
        status: 'warn',
        message: 'Permissions need repair',
        fix: () => {
          throw new Error('chmod failed');
        },
      },
    ];

    expect(applyDoctorFixes(checks)).toEqual([
      {
        name: 'Permissions',
        status: 'failed',
        error: 'chmod failed',
      },
    ]);
  });
});
