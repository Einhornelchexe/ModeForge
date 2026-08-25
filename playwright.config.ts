// Playwright E2E configuration (S18f): Chromium-only browser suite for the
// image analyzer, running against the existing Vite dev server (package.json
// script "dev:web"). The global setup regenerates the binary TIFF fixtures
// on demand, so no binary is committed.
//
// Run with: npx playwright test

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev:web",
    url: "http://127.0.0.1:5173",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
  // Playwright requires a file path here (a config-inline function is
  // rejected by its validator); the setup file spawns the deterministic
  // fixture generator.
  globalSetup: "./tests/e2e/global-setup.mjs",
});
