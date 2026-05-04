import { defineConfig } from "vitest/config"

// Neutralize live third-party keys so functions tests cannot hit production
// services. Use placeholder (not empty) so truthiness guards don't short-
// circuit the (mocked) SDK call. The global vi.mock("resend") in
// vitest.setup.ts is what actually intercepts sends.
process.env.RESEND_API_KEY = "re_test_global"
process.env.RESEND_FROM_EMAIL = "test@example.com"

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
  },
})
