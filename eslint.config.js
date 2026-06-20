// Flat ESLint config (ESLint 9+). Lenient on purpose: the codebase is plain
// ES5-style JS with a dual CommonJS/browser-global module pattern.
const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  { ignores: ["**/vendor/**", "**/dist-firefox/**", "**/node_modules/**", "docs/**"] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-empty": "off",
      "no-prototype-builtins": "off",
      "no-cond-assign": ["error", "except-parens"],
      "no-control-regex": "off",
    },
  },
  // Files that are genuine ES modules.
  {
    files: ["**/offscreen.js"],
    languageOptions: { sourceType: "module" },
  },
];
