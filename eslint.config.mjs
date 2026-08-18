import js from "@eslint/js";
import tseslint from "typescript-eslint";
import playwright from "eslint-plugin-playwright";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  js.configs.recommended, // <-- Corrección: "configs" en plural
  ...tseslint.configs.recommended,
  {
    ...playwright.configs["flat/recommended"],
    files: ["tests/**", "src/**"],
  },
  prettier,
  {
    ignores: ["node_modules/", "playwright-report/", "test-results/", "dist/"],
  }
);
