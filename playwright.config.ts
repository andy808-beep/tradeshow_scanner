import { defineConfig, devices } from "@playwright/test";

const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3210);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 120_000,
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: "retain-on-failure",
    // The offline catalogue is per browser context, so each test starts clean.
    serviceWorkers: "allow",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node e2e/serve.mjs",
    url: `http://127.0.0.1:${APP_PORT}/login`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
  },
});
