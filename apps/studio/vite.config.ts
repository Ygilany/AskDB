import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const studioRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "src/web",
  resolve: {
    alias: {
      "@": path.join(studioRoot, "src"),
    },
  },
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
});
