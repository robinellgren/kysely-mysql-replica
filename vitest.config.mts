import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
    exclude: [
      "**/node_modules/**",
      "**/build/**",
    ],
    hookTimeout: 30000,
  },
});