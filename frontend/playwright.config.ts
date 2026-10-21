import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: process.env.QUOTEGUARD_BASE_URL || "http://127.0.0.1:8780",
    headless: true,
    // APIRequestContext needs an Origin on HTTPS, just like browser requests.
    extraHTTPHeaders: { Origin: new URL(process.env.QUOTEGUARD_BASE_URL || "http://127.0.0.1:8780").origin },
    channel: process.env.QUOTEGUARD_BROWSER_CHANNEL as "chrome" | undefined,
    viewport: { width: 1440, height: 1050 },
  },
  reporter: [["list"]],
  outputDir:
    process.env.QUOTEGUARD_WORK ||
    "../../work/playwright",
});
