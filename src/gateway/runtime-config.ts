import {
  configExists,
  getConfigPath,
  resolveModelOrThrow,
  saveConfig,
  type StateSetConfig,
} from '../config.js';

export interface GatewayRuntimeConfigBootstrapResult {
  created: boolean;
  configPath: string;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function ensureGatewayRuntimeConfigFromEnv(): GatewayRuntimeConfigBootstrapResult {
  const configPath = getConfigPath();
  if (configExists()) {
    return { created: false, configPath };
  }

  const orgId = readEnv('STATESET_ORG_ID');
  const orgName = readEnv('STATESET_ORG_NAME') ?? orgId ?? 'StateSet Response';
  const graphqlEndpoint = readEnv('STATESET_GRAPHQL_ENDPOINT');
  const cliToken = readEnv('STATESET_CLI_TOKEN');
  const adminSecret = readEnv('STATESET_ADMIN_SECRET');
  const model = readEnv('STATESET_MODEL');

  if (!orgId && !graphqlEndpoint && !cliToken && !adminSecret && !model) {
    return { created: false, configPath };
  }

  if (!orgId) {
    throw new Error('STATESET_ORG_ID is required to bootstrap gateway runtime config.');
  }
  if (!graphqlEndpoint) {
    throw new Error('STATESET_GRAPHQL_ENDPOINT is required to bootstrap gateway runtime config.');
  }
  if (!cliToken && !adminSecret) {
    throw new Error(
      'Set STATESET_CLI_TOKEN or STATESET_ADMIN_SECRET to bootstrap gateway runtime config.',
    );
  }

  const config: StateSetConfig = {
    currentOrg: orgId,
    anthropicApiKey: undefined,
    model: model ? resolveModelOrThrow(model, 'valid') : undefined,
    organizations: {
      [orgId]: {
        name: orgName,
        graphqlEndpoint,
        cliToken,
        adminSecret,
      },
    },
  };

  saveConfig(config);
  return { created: true, configPath };
}
