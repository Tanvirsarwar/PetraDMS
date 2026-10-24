import { defineConfig } from '@playwright/test';

const ci = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  // A GitHub-hosted runner is about three times slower than a developer machine; give each test and each assertion headroom
  // there, and keep the strict local limits.
  timeout: ci ? 90_000 : 60_000,
  expect: { timeout: ci ? 10_000 : 5_000 },
  // One retry on CI only. The 'github' reporter shows the failure of the first attempt as an annotation, and the HTML report
  // marks a test that needed its retry as flaky, so a retry never hides an unreliable test.
  retries: ci ? 1 : 0,
  workers: 1,
  reporter: ci ? [['list'], ['github'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' }
});
