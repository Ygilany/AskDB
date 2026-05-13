import importPlugin from "eslint-plugin-import";
import tseslint from "typescript-eslint";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const tsconfigWeb = path.join(root, "tsconfig.web.json");

const studioWebSources = ["src/web/**/*.{ts,tsx}", "src/shared/**/*.ts", "vite.config.ts"];

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src/bin.ts",
      "src/cli.ts",
      "src/index.ts",
      "src/server.ts",
      "src/server.test.ts",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: studioWebSources,
    plugins: { import: importPlugin },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    settings: {
      "import/resolver": {
        typescript: {
          project: tsconfigWeb,
          alwaysTryTypes: true,
        },
        node: true,
      },
    },
    rules: {
      "import/no-unresolved": "error",
    },
  },
);
