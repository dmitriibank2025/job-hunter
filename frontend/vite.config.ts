import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/users": "http://localhost:4000",
      "/auth": "http://localhost:4000",
      "/jobs": "http://localhost:4000",
      "/technologies": "http://localhost:4000",
      "/admin": "http://localhost:4000",
      "/plans": "http://localhost:4000",
      "/email": "http://localhost:4000",
      "/storage": "http://localhost:4000",
      "/candidate": "http://localhost:4000",
    }
  }
});
