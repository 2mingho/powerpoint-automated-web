import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

/*
 * Todas las baterias contra un solo servidor (BASE_URL, por defecto 3301) y
 * una sola base (DATABASE_URL de .env), sembrada una vez por e2e/preparar.ts.
 * Comparten base y sesiones: un solo worker.
 */
process.env.TZ = "UTC";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/preparar.ts",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: process.env.BASE_URL ?? "http://127.0.0.1:3301", trace: "retain-on-failure" },
  projects: [
    { name: "escritorio", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "movil", use: { ...devices["Pixel 7"] } },
  ],
});
