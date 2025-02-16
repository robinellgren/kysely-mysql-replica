import { defineConfig } from "tsup";

export default defineConfig({
  dts: true,
  entry: ["./src/index.ts"],
  format: ["cjs", "esm"],
  minify: true,
  sourcemap: true,
  treeshake: true,
  tsconfig: "./tsconfig.json",
});
