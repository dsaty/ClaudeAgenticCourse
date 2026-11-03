import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    // Forward /api/* calls to the Python backend so the browser sees one origin.
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
