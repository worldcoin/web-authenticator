import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "experiments/**",
      "demo/**",
      "**/.next/**",
      "**/target/**",
      "**/dist/**",
      "**/dist-server/**",
      "**/dist-static/**",
      "**/node_modules/**",
      ".artifacts/**",
      ".runtime/**",
      "playwright-report/**",
      "test-results/**",
      "**/.wrangler/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    files: ["web/**/*.{ts,tsx}", "api/**/*.{ts,tsx}"],
    plugins: {
      "jsx-a11y": jsxA11y,
      "react-hooks": reactHooks,
    },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      ...reactHooks.configs.flat.recommended.rules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "no-console": "error",
    },
  },
  {
    files: ["web/**/*.{ts,tsx}"],
    ignores: ["web/test/**", "web/vite.config.ts"],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      "no-restricted-globals": [
        "error",
        "Bun",
        "Buffer",
        "process",
        "localStorage",
        "sessionStorage",
        "indexedDB",
        "caches",
      ],
      "no-restricted-properties": [
        "error",
        { object: "window", property: "localStorage", message: "Browser persistence is forbidden." },
        { object: "window", property: "sessionStorage", message: "Browser persistence is forbidden." },
        { object: "window", property: "indexedDB", message: "Browser persistence is forbidden." },
        { object: "window", property: "caches", message: "Browser persistence is forbidden." },
        { object: "document", property: "cookie", message: "Browser persistence is forbidden." },
        { object: "navigator", property: "storage", message: "Browser persistence is forbidden." },
        { object: "navigator", property: "sendBeacon", message: "Beacon transport is forbidden." },
      ],
    },
  },
  {
    files: ["web/lib/wallet-session.ts", "web/lib/wallet-persistence.ts"],
    rules: {
      "no-restricted-properties": ["error",
        { object: "document", property: "cookie" },
        { object: "navigator", property: "sendBeacon" },
      ],
    },
  },
  {
    files: [
      "api/*.{ts,tsx}",
      "api/{lib,routes}/**/*.{ts,tsx}",
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        Bun: "readonly",
      },
    },
    rules: {
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "navigator",
        "localStorage",
        "sessionStorage",
        "indexedDB",
      ],
    },
  },
  {
    files: ["packages/**/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["**/experiments/**", "**/fixtures/**"], message: "Product code must not import experiments or test fixtures." }],
      }],
    },
  },
  {
    files: ["web/**/*.{ts,tsx}"],
    ignores: ["web/test/**", "web/vite.config.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: ["bun", "fs", "path", "crypto", "http", "https", "net", "tls", "child_process"],
        patterns: [
          { group: ["node:*", "bun:*", "@web-authenticator/api", "@web-authenticator/api/*", "**/api/**", "**/*.server", "**/*.server.*"], message: "Browser code must not import server modules." },
          { group: ["**/experiments/**", "**/test/**", "**/fixtures/**"], message: "Product code must not import experiments or tests." },
        ],
      }],
    },
  },
  {
    files: ["api/*.ts", "api/{lib,routes}/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["@web-authenticator/web", "@web-authenticator/web/*", "**/web/**"], message: "API code must not import browser implementation modules." },
          { group: ["**/experiments/**", "**/test/**", "**/fixtures/**"], message: "Product code must not import experiments or tests." },
        ],
      }],
    },
  },
  { files: ["web/lib/flow-logging.ts"], rules: { "no-console": "off" } },
);
