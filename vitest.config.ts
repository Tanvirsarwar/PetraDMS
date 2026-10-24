import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'core', include: ['packages/core/**/*.test.ts'], environment: 'node' } },
      { test: { name: 'db', include: ['packages/db/**/*.test.ts', 'tools/**/*.test.ts'], environment: 'node', testTimeout: 120000 } },
      { test: { name: 'desktop', include: ['apps/desktop/**/*.test.ts'], environment: 'node' } }
    ]
  }
});
