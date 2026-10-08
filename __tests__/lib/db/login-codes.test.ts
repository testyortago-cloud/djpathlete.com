// @vitest-environment node
//
// The rules that make a 6-digit emailed code safe to sign in with: it is
// stored hashed, lives 10 minutes, dies after 5 wrong tries, works once, and
// only the newest code works. A second "send" inside 60 seconds must NOT
// replace the code already in the inbox — that is the double-tap trap that
// killed Leo Sayag's reset link on 2026-09-10.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createTableFake } from "../../helpers/table-fake"

const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]> }))
const compareSpy = vi.hoisted(() => ({ calls: 0 }))

vi.mock("@/lib/supabase", async () => {
  const { createTableFake: make } = await import("../../helpers/table-fake")
  return {
    createServiceRoleClient: () => make(state.tables, { login_codes: () => ({ attempts: 0, used_at: null }) }),
  }
})
vi.mock("bcryptjs", async (importOriginal) => {
  const real = await importOriginal<typeof import("bcryptjs")>()
  return {
    ...real,
    compare: async (a: string, b: string) => {
      compareSpy.calls += 1
      return real.compare(a, b)
    },
  }
})

import {
  issueLoginCode,
  verifyLoginCode,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_MAX_PER_HOUR,
  LOGIN_CODE_MAX_PER_DAY,
} from "@/lib/db/login-codes"

const USER = "user-1"
const T0 = new Date("2026-10-08T12:00:00.000Z").getTime()
const codes = () => state.tables.login_codes ?? []

async function issue() {
  const r = await issueLoginCode(USER)
  if (r.status !== "issued") throw new Error(`expected issued, got ${r.status}`)
  return r.code
}
const wrongOf = (code: string) => (code === "000000" ? "111111" : "000000")

beforeEach(() => {
  state.tables = {}
  compareSpy.calls = 0
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(T0)
})
afterEach(() => vi.useRealTimers())

describe("issueLoginCode", () => {
  it("returns six digits and stores only a hash, expiring in 10 minutes", async () => {
    const code = await issue()
    expect(code).toMatch(/^\d{6}$/)
    expect(codes()).toHaveLength(1)
    expect(codes()[0].code_hash).not.toContain(code)
    expect(Date.parse(codes()[0].expires_at as string)).toBe(T0 + 10 * 60_000)
  })

  it("does not replace the code in the inbox when asked again within 60 seconds", async () => {
    const code = await issue()
    vi.setSystemTime(T0 + 59_000)
    expect((await issueLoginCode(USER)).status).toBe("cooldown")
    expect(codes()).toHaveLength(1)
    expect(await verifyLoginCode(USER, code)).toBe("ok")
  })

  it("does not hold back a new code when the last one is already used up", async () => {
    const code = await issue()
    expect(await verifyLoginCode(USER, code)).toBe("ok")
    vi.setSystemTime(T0 + 10_000)
    expect((await issueLoginCode(USER)).status).toBe("issued")
  })

  it("does not hold back a new code when the last one is locked by wrong tries", async () => {
    const code = await issue()
    for (let i = 0; i < LOGIN_CODE_MAX_ATTEMPTS; i++) await verifyLoginCode(USER, wrongOf(code))
    vi.setSystemTime(T0 + 10_000)
    expect((await issueLoginCode(USER)).status).toBe("issued")
  })

  it("issues a fresh code after the cooldown, and only the newest one works", async () => {
    const first = await issue()
    vi.setSystemTime(T0 + 61_000)
    const second = await issue()
    if (first !== second) expect(await verifyLoginCode(USER, first)).toBe("wrong")
    expect(await verifyLoginCode(USER, second)).toBe("ok")
  })

  it("caps codes per account per hour", async () => {
    for (let i = 0; i < LOGIN_CODE_MAX_PER_HOUR; i++) {
      vi.setSystemTime(T0 + i * 61_000)
      await issue()
    }
    vi.setSystemTime(T0 + LOGIN_CODE_MAX_PER_HOUR * 61_000)
    expect((await issueLoginCode(USER)).status).toBe("rate_limited")
    vi.setSystemTime(T0 + 61 * 60_000)
    expect((await issueLoginCode(USER)).status).toBe("issued")
  })

  it("caps codes per account per day, so slow guessing over weeks stays hopeless", async () => {
    // Two full hours' worth, then the third hour is refused by the daily cap.
    for (let i = 0; i < LOGIN_CODE_MAX_PER_DAY; i++) {
      const hour = Math.floor(i / LOGIN_CODE_MAX_PER_HOUR)
      vi.setSystemTime(T0 + hour * 61 * 60_000 + (i % LOGIN_CODE_MAX_PER_HOUR) * 61_000)
      await issue()
    }
    vi.setSystemTime(T0 + 3 * 61 * 60_000)
    expect((await issueLoginCode(USER)).status).toBe("rate_limited")
    vi.setSystemTime(T0 + 25 * 60 * 60_000)
    expect((await issueLoginCode(USER)).status).toBe("issued")
  })

  it("never counts or touches another account's codes", async () => {
    await issue()
    expect((await issueLoginCode("user-2")).status).toBe("issued")
  })
})

describe("verifyLoginCode", () => {
  it("accepts the right code once", async () => {
    const code = await issue()
    expect(await verifyLoginCode(USER, code)).toBe("ok")
    expect(await verifyLoginCode(USER, code)).toBe("used")
  })

  it("rejects a code after 10 minutes", async () => {
    const code = await issue()
    vi.setSystemTime(T0 + 10 * 60_000 + 1)
    expect(await verifyLoginCode(USER, code)).toBe("expired")
  })

  it("locks the code after the maximum wrong tries, even for the right digits", async () => {
    const code = await issue()
    for (let i = 0; i < LOGIN_CODE_MAX_ATTEMPTS; i++) {
      expect(await verifyLoginCode(USER, wrongOf(code))).toBe("wrong")
    }
    expect(await verifyLoginCode(USER, code)).toBe("locked")
  })

  it("answers no_code when none was ever sent", async () => {
    expect(await verifyLoginCode(USER, "123456")).toBe("no_code")
  })

  it("spends one try per comparison even when guesses arrive in parallel", async () => {
    const code = await issue()
    const results = await Promise.all(Array.from({ length: 10 }, () => verifyLoginCode(USER, wrongOf(code))))
    expect(results.every((r) => r === "wrong")).toBe(true)
    // Ten guesses raced for the same try; only the one that claimed it compared.
    expect(compareSpy.calls).toBe(1)
  })

  it("lets only one of several parallel right answers in", async () => {
    const code = await issue()
    const results = await Promise.all(Array.from({ length: 5 }, () => verifyLoginCode(USER, code)))
    expect(results.filter((r) => r === "ok")).toHaveLength(1)
  })
})
