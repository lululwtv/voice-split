import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()], base: "/static/", build: { outDir: "static", emptyOutDir: true },
  server: { proxy: { "/api": { target: "http://127.0.0.1:4320", ws: true } } },
});
