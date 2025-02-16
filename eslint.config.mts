import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import perfectionist from "eslint-plugin-perfectionist";
import typescriptEslint from "typescript-eslint";

export default typescriptEslint.config(
  eslint.configs.recommended,
  eslintConfigPrettier,
  perfectionist.configs["recommended-natural"],
  ...typescriptEslint.configs.recommended,
  {
    ignores: ["dist/*", "build/*"],
  },
);
