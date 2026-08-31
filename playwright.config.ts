import { defineConfig, devices } from '@playwright/test';

// When PLAYWRIGHT_PRODUCTION=1, skip the local dev server entirely.
// Authenticated production tests target https://space.cloistr.xyz directly
// and do not need a local Vite server. On this machine, Vite hits ENOSPC
// (inotify watch limit) frequently; that crash is fatal to the full run.
const isProduction = !!process.env.PLAYWRIGHT_PRODUCTION;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  // global-setup runs for ALL projects. When the signer credential file is
  // absent (local dev without test credentials) it exits cleanly without
  // writing a fixture — unauthenticated tests don't read the fixture.
  globalSetup: './tests/e2e/global-setup.ts',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },

  projects: [
    // ------------------------------------------------------------------
    // Existing projects — local dev server, unauthenticated smoke tests.
    // These run in CI via the existing gate. NOT CHANGED.
    // ------------------------------------------------------------------
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['**/authenticated.spec.ts'],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: ['**/authenticated.spec.ts'],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: ['**/authenticated.spec.ts'],
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
      testIgnore: ['**/authenticated.spec.ts'],
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
      testIgnore: ['**/authenticated.spec.ts'],
    },

    // ------------------------------------------------------------------
    // Authenticated production walkthrough
    //
    // Targets https://space.cloistr.xyz with a real NIP-46 session
    // established in global-setup.ts.
    //
    // NOT in the existing CI gate — adding as a gate is a separate decision.
    //
    // Run:  PLAYWRIGHT_PRODUCTION=1 npx playwright test --project=authenticated-production
    // Needs: ~/.credentials/cliostr-test-account (username\npassword)
    // ------------------------------------------------------------------
    {
      name: 'authenticated-production',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        baseURL: 'https://space.cloistr.xyz',
        screenshot: 'only-on-failure',
        video: 'on-first-retry',
        trace: 'on-first-retry',
      },
      testMatch: ['**/authenticated.spec.ts'],
    },
  ],

  // Skip the dev server when running production tests. The dev server is only
  // needed for the local smoke-test projects (chromium/firefox/webkit).
  webServer: isProduction ? undefined : {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 10000,
  },
});
