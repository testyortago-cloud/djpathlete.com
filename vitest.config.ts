import { defineConfig, configDefaults } from "vitest/config"
import path from "path"
import dotenv from "dotenv"
import { expand } from "dotenv-expand"

// THE DEFAULT ENVIRONMENT NEEDS require(esm). jsdom 28 is CommonJS and its
// html-encoding-sniffer dependency `require()`s the ESM-only @exodus/bytes, so
// on a Node without unflagged require(esm) — anything below 20.19 / 22.12 —
// every suite that uses the jsdom environment fails at WORKER START with
// ERR_REQUIRE_ESM, and vitest reports that as "no tests", which reads exactly
// like passing. 782 of 953 files were invisible this way until 2026-09-05.
// `process.features.require_module` is the capability itself, not a version
// proxy: it is true only when require(esm) is enabled in this binary. Refusing
// to run at all is deliberate — a partial run that silently drops the DOM
// suites is the disease, not a fallback. Production is Node 24 (Vercel, and
// package.json "engines" pins the same), so .nvmrc says 24 too.
if (!(process.features as { require_module?: boolean }).require_module) {
  throw new Error(
    `vitest: Node ${process.version} cannot load the jsdom environment (its dependency chain ` +
      `require()s an ES module, which this Node does not support). Use the version in .nvmrc: ` +
      `\`nvm install && nvm use\`, then re-run. Every suite that uses jsdom would otherwise ` +
      `report "no tests" instead of failing.`,
  )
}

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
    // node is the DEFAULT; a suite that renders needs `// @vitest-environment jsdom`
    // on line 1. Flipped 2026-09-05 from jsdom-by-default: with jsdom as the
    // default, a suite that cannot start its environment reports "no tests" (see
    // the guard above) — with node as the default, a DOM suite that forgot its
    // pragma fails loudly with "document is not defined" instead. The 191 files
    // that carry the pragma were found by measurement, not by grep: every file
    // that failed, or ran fewer tests, under node than under jsdom.
    environment: "node",
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
