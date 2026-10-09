import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
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
    files: ["apps/authenticator/**/*.{ts,tsx}"],
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
    files: ["apps/authenticator/src/**/*.{ts,tsx}"],
    ignores: ["apps/authenticator/src/server/**"],
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
    files: ["apps/authenticator/src/wallet/session.ts", "apps/authenticator/src/wallet/persistence.ts"],
    rules: {
      "no-restricted-properties": ["error",
        { object: "document", property: "cookie" },
        { object: "navigator", property: "sendBeacon" },
      ],
    },
  },
  {
    files: [
      "apps/authenticator/src/server/**/*.{ts,tsx}",
      "apps/authenticator/src/**/*.server.{ts,tsx}",
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
);
