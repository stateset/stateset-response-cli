import { webcrypto } from 'node:crypto';
import { defineConfig } from 'vitest/config';

const globalRef = globalThis as typeof globalThis & {
  crypto?: { getRandomValues?: unknown };
};
if (typeof globalRef.crypto?.getRandomValues !== 'function') {
  globalRef.crypto = webcrypto as typeof globalRef.crypto;
}

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
      include: ['src/**/*.ts'],
      exclude: [
        'node_modules',
        'dist',
        '**/*.d.ts',
        'src/__tests__/helpers/**',
        'src/__tests__/**',
        'src/cli.ts',
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
        'vitest.config.ts',
      ],
      thresholds: {
        lines: 75,
        branches: 75,
        functions: 75,
        statements: 75,
      },
    },
  },
});
