import js from "@eslint/js";
import tseslint from "typescript-eslint";
import playwright from "eslint-plugin-playwright";
import prettier from "eslint-config-prettier";

export default tseslint.config(
    {
        ignores: [
            "node_modules/",
            "playwright-report/",
            "test-results/",
            "dist/",
            "agent/artifacts/",
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        ...playwright.configs["flat/recommended"],
        files: ["tests/**"],
    },
    {
        // Los *.setup.ts preparan estado (login, seeding); no assertan nada.
        files: ["tests/**/*.setup.ts"],
        rules: {
            "playwright/expect-expect": "off",
        },
    },
    {
        files: ["agent/**/*.ts"],
        rules: {
            "no-console": "off",
        },
    },
    prettier
);
