const js = require("@eslint/js");

module.exports = [
  { ignores: ["android/**", "ios/**", ".expo/**", "dist/**", "coverage/**"] },
  js.configs.recommended,
  {
    files: ["tests/**/*.test.jsx"],
    languageOptions: {
      globals: {
        jest: "readonly",
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
      },
    },
  },
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        AbortController: "readonly",
        console: "readonly",
        clearTimeout: "readonly",
        DOMException: "readonly",
        fetch: "readonly",
        Headers: "readonly",
        process: "readonly",
        Response: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
      },
    },
    rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_" }] },
  },
  {
    files: ["*.config.{js,cjs}", "src/theme/tokens.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { __dirname: "readonly" },
    },
  },
];
