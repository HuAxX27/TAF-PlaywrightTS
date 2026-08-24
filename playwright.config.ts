import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import { env } from "./src/config/env";

dotenv.config();

const IGNORE_CANDIDATES = /.*[\\/]candidates[\\/].*\.spec\.ts/;
const includeCandidates = process.env.AQA_INCLUDE_CANDIDATES === "true";

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
    testDir: "./tests",
    /* Run tests in files in parallel */
    fullyParallel: true,
    /* Fail the build on CI if you accidentally left test.only in the source code. */
    forbidOnly: !!process.env.CI,
    /* Retry on CI only */
    retries: process.env.CI ? 2 : 0,
    /* Opt out of parallel tests on CI. */
    workers: process.env.CI ? 4 : undefined,
    /* Reporter to use. See https://playwright.dev/docs/test-reporters */
    reporter: [
        ["list"],
        ["html", { open: "never" }],
        ["json", { outputFile: "test-results/results.json" }],
    ],
    /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
    use: {
        baseURL: env.baseURL,
        trace: "on-first-retry",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
    },

    /* Configure projects for major browsers */
    projects: [
        {
            name: "chromium",
            testIgnore: includeCandidates ? [] : IGNORE_CANDIDATES,
            use: { ...devices["Desktop Chrome"] },
        },

        {
            name: "firefox",
            testIgnore: includeCandidates ? [] : IGNORE_CANDIDATES,
            use: { ...devices["Desktop Firefox"] },
        },

        {
            name: "webkit",
            testIgnore: includeCandidates ? [] : IGNORE_CANDIDATES,
            use: { ...devices["Desktop Safari"] },
        },

        /* Test against mobile viewports. */
        // {
        //   name: 'Mobile Chrome',
        //   use: { ...devices['Pixel 5'] },
        // },
        // {
        //   name: 'Mobile Safari',
        //   use: { ...devices['iPhone 12'] },
        // },
    ],
});
