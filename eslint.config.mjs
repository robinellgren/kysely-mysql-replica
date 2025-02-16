import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import perfectionist from 'eslint-plugin-perfectionist'
import typescriptEslint from "typescript-eslint";

export default typescriptEslint.config(
    eslint.configs.recommended,
    eslintConfigPrettier,
    perfectionist.configs['recommended-natural'],
    ...typescriptEslint.configs.recommended,
    {
      ignores: ["dist/*"],
    },
    {
      rules: {
        "no-console": "error",
      },
    },
    {
      files: ["**/test/**/*.ts", "**/test/**/*.tsx"],
      rules: {
        "@typescript-eslint/no-empty-function": "off",
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-non-null-assertion": "off",
        "no-console": "off",
        "unicorn/consistent-function-scoping": "off",
        "unicorn/no-null": "off",
        "unicorn/no-useless-undefined": "off",
      },
    },
  );