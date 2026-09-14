// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  applyAbsoluteCap,
  isPastAbsoluteCap,
  shouldWarn,
  SESSION_ABSOLUTE_MAX_AGE_MS,
  SESSION_IDLE_MAX_AGE_SECONDS,
  SESSION_WARN_BEFORE_MS,
} from "@/lib/session-policy"

const NOW = Date.UTC(2026, 8, 14, 12, 0, 0)

describe("isPastAbsoluteCap", () => {
  it("lets a session that signed in inside the window through", () => {
    expect(isPastAbsoluteCap(NOW - SESSION_ABSOLUTE_MAX_AGE_MS + 1000, NOW)).toBe(false)
  })

  it("ends a session that signed in longer ago than the cap", () => {
    expect(isPastAbsoluteCap(NOW - SESSION_ABSOLUTE_MAX_AGE_MS - 1000, NOW)).toBe(true)
  })

  it("does not end a session at the exact boundary", () => {
    expect(isPastAbsoluteCap(NOW - SESSION_ABSOLUTE_MAX_AGE_MS, NOW)).toBe(false)
  })

  it("treats a token with NO loginAt as inside the window, not infinitely old", () => {
    // Every session already live when this shipped has no stamp. Reading that
    // as expired would sign the whole product out the moment the deploy landed.
    expect(isPastAbsoluteCap(undefined, NOW)).toBe(false)
    expect(isPastAbsoluteCap(null, NOW)).toBe(false)
    expect(isPastAbsoluteCap("2026-09-14", NOW)).toBe(false)
    expect(isPastAbsoluteCap(Number.NaN, NOW)).toBe(false)
  })
})

describe("shouldWarn", () => {
  it("stays quiet well before expiry", () => {
    expect(shouldWarn(NOW + SESSION_WARN_BEFORE_MS + 1000, NOW)).toBe(false)
  })

  it("warns once inside the window", () => {
    expect(shouldWarn(NOW + SESSION_WARN_BEFORE_MS - 1000, NOW)).toBe(true)
  })

  it("stops warning at expiry — that case is a redirect, not a dialog", () => {
    expect(shouldWarn(NOW, NOW)).toBe(false)
    expect(shouldWarn(NOW - 1000, NOW)).toBe(false)
  })

  it("stays quiet when the expiry is unknown", () => {
    expect(shouldWarn(null, NOW)).toBe(false)
    expect(shouldWarn(Number.NaN, NOW)).toBe(false)
  })
})

describe("the two windows", () => {
  it("warns well inside the idle window, so the dialog is reachable", () => {
    // A warning longer than the window it guards would be on screen from the
    // moment the session started.
    expect(SESSION_WARN_BEFORE_MS).toBeLessThan(SESSION_IDLE_MAX_AGE_SECONDS * 1000)
  })

  it("caps absolutely at a longer horizon than the idle window", () => {
    // The reverse would make the idle timer dead code: every session would hit
    // the absolute cap first.
    expect(SESSION_ABSOLUTE_MAX_AGE_MS).toBeGreaterThan(SESSION_IDLE_MAX_AGE_SECONDS * 1000)
  })
})

describe("applyAbsoluteCap", () => {
  it("starts the clock at sign-in", () => {
    const token = { id: "u1" } as { id: string; loginAt?: number }
    expect(applyAbsoluteCap(token, true, NOW)).toBe(token)
    expect(token.loginAt).toBe(NOW)
  })

  it("re-stamps at sign-in even when an older stamp is carried in", () => {
    // Signing in again is a NEW session and must get a full window; inheriting
    // a stale stamp would expire someone moments after they logged in.
    const token = { loginAt: NOW - SESSION_ABSOLUTE_MAX_AGE_MS + 1000 }
    expect(applyAbsoluteCap(token, true, NOW)).toBe(token)
    expect(token.loginAt).toBe(NOW)
  })

  it("carries an existing stamp forward untouched on an ordinary request", () => {
    // The whole point: activity must not move this clock.
    const loginAt = NOW - 3 * 24 * 60 * 60 * 1000
    const token = { loginAt }
    expect(applyAbsoluteCap(token, false, NOW)).toBe(token)
    expect(token.loginAt).toBe(loginAt)
  })

  it("destroys a session past the cap, however recently it was used", () => {
    const token = { loginAt: NOW - SESSION_ABSOLUTE_MAX_AGE_MS - 1 }
    expect(applyAbsoluteCap(token, false, NOW)).toBeNull()
  })

  it("grandfathers a token minted before this policy shipped", () => {
    // No loginAt: stamp it now and let it live, rather than signing out every
    // user in the product the moment the deploy lands.
    const token: { loginAt?: number } = {}
    expect(applyAbsoluteCap(token, false, NOW)).toBe(token)
    expect(token.loginAt).toBe(NOW)
  })

  it("still ends a grandfathered session a full window later", () => {
    const token: { loginAt?: number } = {}
    applyAbsoluteCap(token, false, NOW)
    expect(applyAbsoluteCap(token, false, NOW + SESSION_ABSOLUTE_MAX_AGE_MS + 1)).toBeNull()
  })
})
