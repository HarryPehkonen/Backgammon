/**
 * Vite + Vitest configuration.
 *
 * The dev/build side needs no configuration at all — Vite 8 finds
 * `index.html` on its own. The `test` block is what earns this file: unit
 * tests run in a `happy-dom` environment so the Lit component can mount a
 * real custom element with a shadow root, and only `*.test.ts` files under
 * `src/` are collected (the engine has its own Deno test suite in the repo
 * root, which is none of Vitest's business).
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
});
