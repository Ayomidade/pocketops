import js from "@eslint/js";

export default [
  { ignores: ["coverage/**"] },
  js.configs.recommended,
  {
    files: ["src/**/*.js", "tests/**/*.js", "scripts/**/*.js", "vitest.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        AbortController: "readonly",
        AbortSignal: "readonly",
        Buffer: "readonly",
        clearInterval: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        Response: "readonly",
        setInterval: "readonly",
        setImmediate: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
