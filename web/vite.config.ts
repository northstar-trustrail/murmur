// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  base: "./", // relative paths, so the build works under any GitHub Pages sub-path
  plugins: [wasm()],
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ["@midnightntwrk/onchain-runtime-v4"] },
});
