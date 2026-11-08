import { defineConfig } from '@playwright/test';

// Real-browser integration lane, separate from the Vitest unit suite.
// Projects:
//   web        — the app served by `vite preview`; provider, model, keyboard tests.
//   extension  — the packed MV3 extension loaded into headful Chromium.
// See docs/e2e-testing.md for local and CI usage.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Extension contexts share a machine-wide Chromium profile per test and the
  // model tests download real weights; parallel workers only add flakiness.
  workers: 1,
  reporter: 'list',
  projects: [
    {
      name: 'web',
      testMatch: '**/*.web.spec.ts',
      use: {
        browserName: 'chromium',
        headless: true,
        baseURL: 'http://127.0.0.1:4173',
        trace: 'retain-on-failure',
      },
    },
    {
      name: 'extension',
      testMatch: '**/*.extension.spec.ts',
      use: { trace: 'retain-on-failure' },
    },
  ],
  webServer: {
    command:
      'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
