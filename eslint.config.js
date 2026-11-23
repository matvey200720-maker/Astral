import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/release/**",
      /* Выходная папка сборки — `release/`; скрипты релизов — исходники, их линтуем. */
      "!scripts/release/**",
      "**/runtime/**",
      "**/vendor/**",
      "**/native/**",
      "**/tools/**",
      "**/qa-artifacts/**",
    ],
  },
  {
    files: ["{apps,packages,scripts,tests}/**/*.{js,jsx,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    rules: {
      ...js.configs.recommended.rules,
      "react/jsx-uses-react": "off",
      "react/jsx-uses-vars": "error",
      "react/jsx-no-undef": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },
];
