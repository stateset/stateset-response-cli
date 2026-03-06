import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

require('./scripts/runtime-compat.cjs');

/**
 * Core unit-coverage profile:
 * - Enforces a strict 100% gate for deterministic core modules
 * - Complements (does not replace) full-suite coverage in `vitest.config.ts`
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['src/__tests__/setup-env.ts'],
    include: [
      'src/__tests__/arg-utils.test.ts',
      'src/__tests__/circuit-breaker.test.ts',
      'src/__tests__/format.test.ts',
      'src/__tests__/integration-limit.test.ts',
      'src/__tests__/integration-loop.test.ts',
      'src/__tests__/integration-shipfusion.test.ts',
      'src/__tests__/integration-shiphawk.test.ts',
      'src/__tests__/integration-shipstation.test.ts',
      'src/__tests__/integration-shopify.test.ts',
      'src/__tests__/integration-zendesk.test.ts',
      'src/__tests__/memory.test.ts',
      'src/__tests__/redact.test.ts',
      'src/__tests__/registry.test.ts',
    ],
    testTimeout: 10000,
    coverage: {
      all: true,
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: [
        'src/memory.ts',
        'src/lib/circuit-breaker.ts',
        'src/cli/arg-utils.ts',
        'src/integrations/format.ts',
        'src/integrations/limit.ts',
        'src/integrations/loop.ts',
        'src/integrations/redact.ts',
        'src/integrations/registry.ts',
        'src/integrations/shipfusion.ts',
        'src/integrations/shiphawk.ts',
        'src/integrations/shipstation.ts',
        'src/integrations/shopify.ts',
        'src/integrations/zendesk.ts',
      ],
      exclude: [
        'node_modules',
        'dist',
        '**/*.d.ts',
        'src/__tests__/**',
        'src/mcp-server/tools/**',
        'src/mcp-server/server.ts',
        'src/mcp-server/index.ts',
        'src/slack/**',
        'src/whatsapp/**',
        'src/events.ts',
        'src/cli/chat-action.ts',
        'src/cli/commands-shortcuts.ts',
        'src/cli/operations-store.ts',
        'src/cli/shortcuts/deployments.ts',
        'src/integrations/shopify-orders.ts',
        'src/integrations/shopify-hold-ops.ts',
        'src/integrations/shopify-refund-ops.ts',
      ],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
