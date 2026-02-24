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
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules',
        'dist',
        '**/*.d.ts',
        'src/__tests__/helpers/**',
        'vitest.config.ts',
      ],
      thresholds: {
        lines: 70,
        branches: 60,
        functions: 70,
        statements: 70,
      },
    },
  },
});
