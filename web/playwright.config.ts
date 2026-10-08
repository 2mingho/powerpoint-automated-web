import { defineConfig, devices } from "@playwright/test";

/* Cada modulo arranca su propio servidor en BASE_URL; por defecto el de desarrollo. */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  use: { baseURL: process.env.BASE_URL ?? "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [
    { name: "escritorio", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "movil", use: { ...devices["Pixel 7"] } },
  ],
});
