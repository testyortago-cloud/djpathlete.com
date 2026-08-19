// @vitest-environment node
//
// Fix wave (Critical 2). `appOrigin()` mints the origin for every unsubscribe
// link and every List-Unsubscribe header the sequence engine puts into
// outbound mail. It used to read `APP_URL ?? NEXT_PUBLIC_SITE_URL` and fall
// back to `http://localhost:3050`:
//
//   - `.env.example:124` says Next.js server-side code reads NEXTAUTH_URL and
//     that APP_URL is Firebase-side only, so APP_URL is not set in the Vercel
//     runtime this code executes in.
//   - NEXT_PUBLIC_SITE_URL is declared nowhere — not in `.env.example`, not in
//     `.env.local`. Every other use of it in this repo pairs it with its own
//     hardcoded fallback.
//
// So in production both reads missed and every unsubscribe link shipped
// pointing at localhost. Silently. These tests pin the chain that every other
// email-link builder here uses (lib/url.ts, lib/email.ts, lib/shop/emails.ts,
// lib/messaging/email-new-message.ts) and pin the refusal: a path that mints
// links for outbound mail must never quietly invent a local one.

import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { appOrigin } from "@/lib/automation/sequence-tick-runner"

const KEYS = ["NEXTAUTH_URL", "NEXT_PUBLIC_APP_URL", "APP_URL", "NEXT_PUBLIC_SITE_URL"] as const
const saved: Record<string, string | undefined> = {}
for (const k of KEYS) saved[k] = process.env[k]

function clearAll() {
  for (const k of KEYS) delete process.env[k]
}

beforeEach(clearAll)

afterAll(() => {
  clearAll()
  for (const k of KEYS) if (saved[k] !== undefined) process.env[k] = saved[k]
})

describe("appOrigin", () => {
  it("prefers NEXTAUTH_URL — the variable Next.js server code actually reads here", () => {
    process.env.NEXTAUTH_URL = "https://nextauth.test"
    process.env.NEXT_PUBLIC_APP_URL = "https://public.test"
    process.env.APP_URL = "https://firebase.test"
    expect(appOrigin()).toBe("https://nextauth.test")
  })

  it("falls back to NEXT_PUBLIC_APP_URL, then APP_URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://public.test"
    process.env.APP_URL = "https://firebase.test"
    expect(appOrigin()).toBe("https://public.test")

    delete process.env.NEXT_PUBLIC_APP_URL
    expect(appOrigin()).toBe("https://firebase.test")
  })

  it("THROWS when none is set — it must never invent a localhost origin", () => {
    expect(() => appOrigin()).toThrow(/no public origin configured/i)
  })

  it("never returns a localhost origin from an unset environment", () => {
    // The specific regression: the old fallback returned
    // "http://localhost:3050" and every unsubscribe link in every sent email
    // pointed there. Asserting the throw is not enough — assert that no
    // future 'helpful' default reintroduces a value here.
    let returned: string | null = null
    try {
      returned = appOrigin()
    } catch {
      returned = null
    }
    expect(returned).toBeNull()
  })

  it("ignores NEXT_PUBLIC_SITE_URL, which is declared nowhere in this repo", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://site.test"
    expect(() => appOrigin()).toThrow(/no public origin configured/i)
  })

  it("treats a blank value as unset rather than minting a relative link", () => {
    process.env.NEXTAUTH_URL = "   "
    expect(() => appOrigin()).toThrow(/no public origin configured/i)
  })

  it("strips trailing slashes so the built URL has exactly one", () => {
    process.env.NEXTAUTH_URL = "https://nextauth.test///"
    expect(appOrigin()).toBe("https://nextauth.test")
  })
})
