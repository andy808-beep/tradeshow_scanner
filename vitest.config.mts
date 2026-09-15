import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Resolves the "@/*" alias from tsconfig.json.
    tsconfigPaths: true,
    alias: {
      // "server-only" is supplied by Next rather than installed, so Vite cannot
      // resolve it. Point at the same empty module Next uses on the server,
      // which is the environment these modules are tested in.
      "server-only": "next/dist/compiled/server-only/empty.js",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["__tests__/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
  },
});
