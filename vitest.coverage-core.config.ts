import { webcrypto } from 'node:crypto';
import { defineConfig } from 'vitest/config';

const globalRef = globalThis as typeof globalThis & {
  crypto?: { getRandomValues?: unknown };
};
if (typeof globalRef.crypto?.getRandomValues !== 'function') {
  globalRef.crypto = webcrypto as typeof globalRef.crypto;
}

/**
 * Core unit-coverage profile:
 * - Enforces a strict 100% gate for deterministic core modules
 * - Keeps interactive/runtime-heavy entrypoints in broader coverage profiles
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['src/__tests__/setup-env.ts'],
    include: ['src/**/*.test.ts'],
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
        'src/cli/shortcuts/types.ts',
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
