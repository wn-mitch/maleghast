import { defineConfig } from "vite";

// The Worker (wrangler dev, port 8787) serves game rooms; Vite proxies to it in development.
export default defineConfig({
  server: { proxy: { "/api": { target: "http://127.0.0.1:8787", ws: true } } },
});
