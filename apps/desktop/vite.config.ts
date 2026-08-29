import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const isElectron = process.env.ELECTRON === "true";

export default defineConfig({
  plugins: [react()],
  base: isElectron ? "./" : "/",
  clearScreen: false,
  server: {
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
