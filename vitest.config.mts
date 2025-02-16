import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/build/**",
    ],
    globals: true,
    hookTimeout: 30000,
  },
});