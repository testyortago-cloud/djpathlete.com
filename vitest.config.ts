import { defineConfig } from "vitest/config"
import path from "path"
import dotenv from "dotenv"
import { expand } from "dotenv-expand"

// Load env variables from .env.local before tests run
expand(dotenv.config({ path: ".env.local" }))

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./__tests__/setup.tsx"],
    include: ["__tests__/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", ".next/", "__tests__/setup.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
})
