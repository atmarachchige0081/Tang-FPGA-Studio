import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: ["es2022", "chrome120"],
    // Keep optional debug maps out of customer packages (44 MB in this bundle).
    sourcemap: loadEnv(mode, ".", "FPGA_STUDIO_").FPGA_STUDIO_SOURCEMAPS === "1",
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    pool: "threads",
    maxWorkers: 1,
    fileParallelism: false,
  },
}));
