// @vitest-environment node
//
// Leo Sayag, 2026-09-10 and 09-17: a reset link lasted one hour, and asking
// again deleted the link already in the inbox. He clicked a dead link twice
// and gave up. A link now lasts 24 hours, and asking again re-sends the SAME
// link with its clock pushed out — never cut short (a 7-day invite stays 7 days).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]> }))

vi.mock("@/lib/supabase", async () => {
  const { createTableFake } = await import("../../helpers/table-fake")
  return {
    createServiceRoleClient: () => createTableFake(state.tables, { password_reset_tokens: () => ({ used_at: null }) }),
  }
})

import { createPasswordResetToken, validatePasswordResetToken } from "@/lib/db/password-reset-tokens"

const USER = "user-1"
const HOUR = 3_600_000
const T0 = new Date("2026-10-08T12:00:00.000Z").getTime()
const rows = () => state.tables.password_reset_tokens ?? []

beforeEach(() => {
  state.tables = {}
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(T0)
})
afterEach(() => vi.useRealTimers())

describe("createPasswordResetToken", () => {
  it("makes a link that lasts 24 hours", async () => {
    await createPasswordResetToken(USER)
    expect(Date.parse(rows()[0].expires_at as string)).toBe(T0 + 24 * HOUR)
  })

  it("re-sends the same link when asked again, with its expiry pushed out", async () => {
    const first = await createPasswordResetToken(USER)
    vi.setSystemTime(T0 + 2 * HOUR)
    const second = await createPasswordResetToken(USER)
    expect(second).toBe(first)
    expect(rows()).toHaveLength(1)
    expect(Date.parse(rows()[0].expires_at as string)).toBe(T0 + 26 * HOUR)
  })

  it("never shortens a longer-lived invite link", async () => {
    const invite = await createPasswordResetToken(USER, 24 * 7)
    vi.setSystemTime(T0 + HOUR)
    expect(await createPasswordResetToken(USER)).toBe(invite)
    expect(Date.parse(rows()[0].expires_at as string)).toBe(T0 + 24 * 7 * HOUR)
  })

  it("mints a new link once the old one has expired, and clears the dead one", async () => {
    const old = await createPasswordResetToken(USER)
    vi.setSystemTime(T0 + 25 * HOUR)
    const fresh = await createPasswordResetToken(USER)
    expect(fresh).not.toBe(old)
    expect(rows().map((r) => r.token)).toEqual([fresh])
  })

  it("does not hand back a link that was already used", async () => {
    const used = await createPasswordResetToken(USER)
    rows()[0].used_at = new Date().toISOString()
    expect(await createPasswordResetToken(USER)).not.toBe(used)
  })

  it("keeps another account's link out of it", async () => {
    const other = await createPasswordResetToken("user-2")
    expect(await createPasswordResetToken(USER)).not.toBe(other)
  })

  it("the re-sent link still validates", async () => {
    const token = await createPasswordResetToken(USER)
    await createPasswordResetToken(USER)
    expect(await validatePasswordResetToken(token)).not.toBeNull()
  })
})
