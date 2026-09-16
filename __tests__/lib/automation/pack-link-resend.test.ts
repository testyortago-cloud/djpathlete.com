import { describe, it, expect } from "vitest"
import { selectPacksDueLinkResend, PACK_LINK_RESEND_THROTTLE_MS } from "@/lib/automation/pack-link-resend"

const NOW = new Date("2026-09-16T09:00:00Z")
const HOUR = 60 * 60 * 1000

function pack(
  over: Partial<{ id: string; payment_link_resent_count: number | null; payment_link_resent_at: string | null }> = {},
) {
  return { id: "pk-1", payment_link_resent_count: 0, payment_link_resent_at: null, ...over }
}

const OPTS = { maxResends: 3, throttleMs: PACK_LINK_RESEND_THROTTLE_MS }

describe("selectPacksDueLinkResend", () => {
  it("lets through a pack that has never been re-sent", () => {
    expect(selectPacksDueLinkResend([pack()], NOW, OPTS).map((p) => p.id)).toEqual(["pk-1"])
  })

  it("stops at the re-send budget", () => {
    expect(selectPacksDueLinkResend([pack({ payment_link_resent_count: 3 })], NOW, OPTS)).toEqual([])
  })

  it("still lets through the last re-send inside the budget", () => {
    expect(selectPacksDueLinkResend([pack({ payment_link_resent_count: 2 })], NOW, OPTS).map((p) => p.id)).toEqual([
      "pk-1",
    ])
  })

  it("never re-sends a pack that somehow exceeded the budget", () => {
    expect(selectPacksDueLinkResend([pack({ payment_link_resent_count: 9 })], NOW, OPTS)).toEqual([])
  })

  it("holds a pack re-sent too recently", () => {
    const at = new Date(NOW.getTime() - 3 * HOUR).toISOString()
    expect(
      selectPacksDueLinkResend([pack({ payment_link_resent_at: at, payment_link_resent_count: 1 })], NOW, OPTS),
    ).toEqual([])
  })

  it("releases a pack once the throttle has elapsed", () => {
    const at = new Date(NOW.getTime() - (PACK_LINK_RESEND_THROTTLE_MS + HOUR)).toISOString()
    expect(
      selectPacksDueLinkResend([pack({ payment_link_resent_at: at, payment_link_resent_count: 1 })], NOW, OPTS).map(
        (p) => p.id,
      ),
    ).toEqual(["pk-1"])
  })

  /**
   * The columns land in a migration; Vercel and the migration race on merge, so
   * for one deploy PostgREST may return rows without them. Treating a missing
   * count as "already at budget" would make the feature silently inert forever
   * once the columns DID arrive on some rows and not others — treat it as zero
   * and let the stamping write be the thing that fails safe.
   */
  it("treats a missing count column as never-re-sent", () => {
    const row = { id: "pk-old", payment_link_resent_count: null, payment_link_resent_at: null }
    expect(selectPacksDueLinkResend([row], NOW, OPTS).map((p) => p.id)).toEqual(["pk-old"])
  })

  it("treats an unparseable resent_at as no throttle rather than blocking forever", () => {
    const row = pack({ payment_link_resent_at: "not-a-date", payment_link_resent_count: 1 })
    expect(selectPacksDueLinkResend([row], NOW, OPTS).map((p) => p.id)).toEqual(["pk-1"])
  })

  it("keeps the packs that pass and drops the ones that don't, in one pass", () => {
    const due = pack({ id: "due" })
    const spent = pack({ id: "spent", payment_link_resent_count: 3 })
    const recent = pack({ id: "recent", payment_link_resent_at: new Date(NOW.getTime() - HOUR).toISOString() })
    expect(selectPacksDueLinkResend([due, spent, recent], NOW, OPTS).map((p) => p.id)).toEqual(["due"])
  })

  it("uses a throttle shorter than a Stripe session's 24h life, or a daily cron could never fire", () => {
    expect(PACK_LINK_RESEND_THROTTLE_MS).toBeLessThan(24 * HOUR)
  })
})
