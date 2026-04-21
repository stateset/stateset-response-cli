import { describe, expect, it } from 'vitest';
import {
  deriveDashboardUrl,
  resolveDashboardInfo,
  runDashboardCommand,
} from '../cli/commands-dashboard.js';

describe('commands-dashboard', () => {
  it('derives the dashboard URL from GraphQL endpoints', () => {
    expect(deriveDashboardUrl('https://response.stateset.app/v1/graphql')).toBe(
      'https://response.stateset.app',
    );
    expect(deriveDashboardUrl('https://example.com/custom/v1/graphql')).toBe(
      'https://example.com/custom',
    );
    expect(deriveDashboardUrl('https://api.example.com/graphql')).toBe('https://api.example.com');
  });

  it('prefers an explicit instance URL from the environment', () => {
    const info = resolveDashboardInfo({
      STATESET_INSTANCE_URL: 'https://console.example.com/',
      STATESET_GRAPHQL_ENDPOINT: 'https://ignored.example.com/v1/graphql',
    } as NodeJS.ProcessEnv);

    expect(info).toEqual({
      source: 'instance_env',
      url: 'https://console.example.com',
    });
  });

  it('falls back to the configured org endpoint when env overrides are absent', () => {
    const info = resolveDashboardInfo({} as NodeJS.ProcessEnv, {
      configExistsFn: () => true,
      loadConfigFn: () =>
        ({
          currentOrg: 'acme',
          organizations: {
            acme: {
              name: 'Acme',
              graphqlEndpoint: 'https://acme.example.com/v1/graphql',
            },
          },
        }) as any,
    });

    expect(info).toEqual({
      currentOrg: 'acme',
      source: 'config',
      url: 'https://acme.example.com',
    });
  });

  it('prints JSON dashboard info', async () => {
    const logs: string[] = [];

    const exitCode = await runDashboardCommand(
      { json: true },
      {
        log: (message) => logs.push(message),
        configExistsFn: () => false,
      },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(logs[0] ?? '')).toMatchObject({
      source: 'default',
      url: 'https://response.stateset.app',
      openRequested: false,
    });
  });

  it('returns an error when browser launch fails', async () => {
    const logs: string[] = [];
    const errors: string[] = [];

    const exitCode = await runDashboardCommand(
      { open: true },
      {
        log: (message) => logs.push(message),
        error: (message) => errors.push(message),
        openBrowser: () => false,
        configExistsFn: () => false,
      },
    );

    expect(exitCode).toBe(1);
    expect(logs.join('\n')).toContain('response dashboard');
    expect(errors.join('\n')).toContain('Unable to open a browser automatically');
  });
});
