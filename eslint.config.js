import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const sourceFiles = ["src/**/*.{js,mjs,cjs,jsx}"];

export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  {
    files: sourceFiles,
    ...pluginJs.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser,
    },
    rules: {
      ...pluginJs.configs.recommended.rules,
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/**/*.jsx"],
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: globals.browser,
    },
    settings: {
      react: { version: "detect" },
    },
    plugins: {
      ...pluginReact.configs.flat.recommended.plugins,
      "react-hooks": pluginReactHooks,
    },
    rules: {
      ...pluginReact.configs.flat.recommended.rules,
      "no-unused-vars": "off",
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/no-unknown-property": [
        "error",
        { ignore: ["cmdk-input-wrapper", "toast-close"] },
      ],
      "react/no-unescaped-entities": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "off",
    },
  },
  {
    files: ["base44/**/*.ts"],
    ...pluginJs.configs.recommended,
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        Deno: "readonly",
      },
    },
    rules: {
      ...pluginJs.configs.recommended.rules,
      "no-undef": "off",
      "no-unused-vars": "off",
    },
  },
  {
    files: ["tests/**/*.{js,mjs}", "scripts/**/*.{js,mjs}", "*.config.js"],
    ...pluginJs.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      ...pluginJs.configs.recommended.rules,
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];
