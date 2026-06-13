import { defineConfig, configDefaults } from "vitest/config"
import path from "path"
import dotenv from "dotenv"
import { expand } from "dotenv-expand"

// Load env variables from .env.local before tests run
expand(dotenv.config({ path: ".env.local" }))

// Neutralize live third-party keys so tests cannot hit production services
// even if a test forgets to mock them. Use a placeholder (not empty) so
// truthiness guards in lib/email.ts and friends don't short-circuit the
// (mocked) SDK call. The global vi.mock("resend") in __tests__/setup.tsx
// is what actually intercepts sends. Per-test vi.stubEnv still works.
process.env.RESEND_API_KEY = "re_test_global"
process.env.RESEND_FROM_EMAIL = "test@example.com"

// `npm run test:integration` opts in to tests that hit the real Supabase DB.
// Default `npm test` excludes them so CI / pre-commit runs stay clean.
const isIntegration = (process.env.npm_lifecycle_event ?? "").startsWith(
  "test:integration",
)

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./__tests__/setup.tsx"],
    include: isIntegration
      ? ["__tests__/integration/**/*.test.{ts,tsx}"]
      : ["__tests__/**/*.test.{ts,tsx}"],
    exclude: isIntegration
      ? configDefaults.exclude
      : [...configDefaults.exclude, "__tests__/integration/**"],
    // Inline next-auth so Vite transforms it (and applies the next/server alias
    // below) instead of leaving Node's ESM resolver to choke on its bare
    // `import "next/server"`. Without this, every test that transitively imports
    // @/lib/auth (e.g. via lib/audit) fails to load.
    server: {
      deps: {
        inline: ["next-auth", "@auth/core"],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", ".next/", "__tests__/setup.ts"],
    },
  },
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, ".") },
      // next-auth v5's lib/env.js does `import { NextRequest } from "next/server"`
      // (no extension). next 16 has no package `exports` map, so the test env's
      // ESM resolver can't resolve the bare specifier for this externalized dep.
      // Point it straight at the real file.
      { find: /^next\/server$/, replacement: path.resolve(__dirname, "node_modules/next/server.js") },
    ],
  },
})
