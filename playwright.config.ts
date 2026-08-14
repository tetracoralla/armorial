import { defineConfig } from "@playwright/test";

process.env["NO_PROXY"] = "127.0.0.1,localhost";
process.env["no_proxy"] = "127.0.0.1,localhost";

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4178",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start:ui -- --port 4178",
    url: "http://127.0.0.1:4178/api/health",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
