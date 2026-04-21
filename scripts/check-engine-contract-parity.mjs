#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

const DEFAULT_ENGINE_API_MAIN = path.resolve(
  REPO_ROOT,
  '..',
  'next-temporal-rs',
  'crates',
  'engine-api',
  'src',
  'main.rs',
);
const DEFAULT_ENGINE_CLIENT = path.join(REPO_ROOT, 'src', 'lib', 'engine-client.ts');

const IGNORED_ENGINE_ROUTES = new Map([
  [
    '/v1/workflows/{workflow_id}/events',
    'Server-sent event stream; expose through a streaming follow/log command, not JSON RPC parity.',
  ],
  [
    '/v1/brands/yse-beauty/tickets',
    'Brand-specific YSE workflow entrypoint; not part of the reusable StateSet Response CLI contract.',
  ],
  [
    '/v1/brands/yse-beauty/refuse-rts/import',
    'Brand-specific YSE import workflow; not part of the reusable StateSet Response CLI contract.',
  ],
]);

const ALLOWED_CLIENT_ONLY_ROUTES = new Map([
  [
    '/v1/brands/{brand_id}/config-versions',
    'Optional history endpoint. The CLI falls back to current config when the Rust engine does not expose it.',
  ],
]);

const TEMPLATE_VARIABLES = new Map([
  ['brandId', 'brand_id'],
  ['brandSlug', 'brand_slug'],
  ['connectorId', 'connector_id'],
  ['dlqId', 'dlq_id'],
  ['periodId', 'period_id'],
  ['policySetKey', 'policy_set_key'],
  ['runId', 'run_id'],
  ['templateKey', 'template_key'],
  ['workflowId', 'workflow_id'],
  ['version', 'version'],
]);

function parseArgs(argv) {
  return {
    strict: argv.includes('--strict'),
  };
}

function toSnakeCase(value) {
  return value.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}

function normalizePath(rawPath) {
  let normalized = rawPath.trim();
  normalized = normalized.replace(/\$\{qs[\s\S]*$/, '');
  normalized = normalized.replace(/\?.*$/, '');
  normalized = normalized.replace(/\$\{\s*([^}\s]+)\s*\}/g, (_, variableName) => {
    return `{${TEMPLATE_VARIABLES.get(variableName) ?? toSnakeCase(variableName)}}`;
  });
  normalized = normalized.replace(/\/+/g, '/');
  return normalized;
}

function extractRustRoutes(source) {
  const routes = new Set();
  const routeRegex = /\.route\(\s*"([^"]+)"/g;
  for (const match of source.matchAll(routeRegex)) {
    routes.add(normalizePath(match[1]));
  }
  return routes;
}

function extractClientRoutes(source) {
  const routes = new Set();
  const literalRegex = /(['"`])(\/(?:v1\/|health\b|healthz\b|readyz\b|metrics\b)[\s\S]*?)\1/g;
  for (const match of source.matchAll(literalRegex)) {
    routes.add(normalizePath(match[2]));
  }
  return routes;
}

function formatList(items, details) {
  return items
    .map((item) => {
      const detail = details?.get(item);
      return detail ? `  - ${item} (${detail})` : `  - ${item}`;
    })
    .join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const engineApiMain = process.env.STATESET_ENGINE_API_MAIN || DEFAULT_ENGINE_API_MAIN;
  const engineClientPath = process.env.STATESET_ENGINE_CLIENT_PATH || DEFAULT_ENGINE_CLIENT;

  if (!fs.existsSync(engineApiMain)) {
    const message = `Workflow engine route file not found: ${engineApiMain}`;
    if (args.strict) {
      console.error(`Engine contract parity check failed: ${message}`);
      process.exit(1);
    }
    console.log(`Engine contract parity check skipped: ${message}`);
    return;
  }

  if (!fs.existsSync(engineClientPath)) {
    console.error(
      `Engine contract parity check failed: client file not found: ${engineClientPath}`,
    );
    process.exit(1);
  }

  const rustRoutes = extractRustRoutes(fs.readFileSync(engineApiMain, 'utf-8'));
  const clientRoutes = extractClientRoutes(fs.readFileSync(engineClientPath, 'utf-8'));

  const requiredRoutes = [...rustRoutes]
    .filter((route) => !IGNORED_ENGINE_ROUTES.has(route))
    .sort();
  const missingRoutes = requiredRoutes.filter((route) => !clientRoutes.has(route));
  const staleClientRoutes = [...clientRoutes]
    .filter((route) => !rustRoutes.has(route) && !ALLOWED_CLIENT_ONLY_ROUTES.has(route))
    .sort();

  if (missingRoutes.length > 0 || staleClientRoutes.length > 0) {
    console.error('Engine contract parity check failed.');
    if (missingRoutes.length > 0) {
      console.error('\nMissing CLI client routes for Rust engine routes:');
      console.error(formatList(missingRoutes));
    }
    if (staleClientRoutes.length > 0) {
      console.error('\nCLI client routes not present in the Rust engine router:');
      console.error(formatList(staleClientRoutes));
    }
    if (IGNORED_ENGINE_ROUTES.size > 0) {
      console.error('\nIntentional engine exclusions:');
      console.error(formatList([...IGNORED_ENGINE_ROUTES.keys()].sort(), IGNORED_ENGINE_ROUTES));
    }
    if (ALLOWED_CLIENT_ONLY_ROUTES.size > 0) {
      console.error('\nAllowed client-only routes:');
      console.error(
        formatList([...ALLOWED_CLIENT_ONLY_ROUTES.keys()].sort(), ALLOWED_CLIENT_ONLY_ROUTES),
      );
    }
    process.exit(1);
  }

  console.log(
    `Engine contract parity check passed: ${requiredRoutes.length} Rust route(s) covered, ` +
      `${IGNORED_ENGINE_ROUTES.size} intentional exclusion(s), ` +
      `${ALLOWED_CLIENT_ONLY_ROUTES.size} allowed client-only route(s).`,
  );
}

main();
