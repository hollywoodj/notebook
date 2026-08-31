import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const isElectron = process.env.ELECTRON === "true";

export default defineConfig({
  plugins: [react()],
  base: isElectron ? "./" : "/",
  clearScreen: false,
  server: {
    // `electron/main.cjs` loads DEV_URL at 127.0.0.1. Without this Vite binds
    // localhost only, that address refuses, and the Electron window comes up
    // blank with nothing logged.
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_"],
  build: {
    outDir: "dist",
    target: "esnext",
    minify: "esbuild",
    sourcemap: false,
  },
});
