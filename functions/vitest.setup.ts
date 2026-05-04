import { vi } from "vitest"

// Default no-op mock for Resend so any future test that imports
// newsletter-send (or anything else doing `new Resend(...)`) cannot hit
// the live API. Per-file vi.mock("resend", ...) still wins.
vi.mock("resend", () => ({
  Resend: vi.fn(() => ({
    emails: {
      send: vi.fn().mockResolvedValue({ data: { id: "test-email" }, error: null }),
    },
  })),
}))
