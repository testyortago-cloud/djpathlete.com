import { describe, it, expect } from "vitest"
import { selectPacksNeedingReminder, classifyPackReminders } from "@/lib/automation/pack-renewal-scanner"
import type { ClientPackage } from "@/types/database"

const now = new Date("2026-06-13T00:00:00Z")

function pkg(p: Partial<ClientPackage>): ClientPackage {
  return {
    id: "p",
    client_user_id: "c",
    product_id: null,
    session_type: "1-on-1",
    credits_total: 10,
    credits_used: 0,
    price_cents: 0,
    payment_method: "stripe",
    payment_status: "paid",
    stripe_session_id: null,
    stripe_payment_id: null,
    purchased_at: "2026-06-01T00:00:00Z",
    expires_at: null,
    status: "active",
    last_reminded_threshold: null,
    notes: null,
    bill_to_email: null,
    bill_to_emailed_at: null,
    auto_renew: false,
    renewed_from_package_id: null,
    renewal_attempted_at: null,
    created_by: null,
    created_at: "",
    updated_at: "",
    ...p,
  }
}

describe("selectPacksNeedingReminder", () => {
  it("selects empty, low, and expiring packs", () => {
    const res = selectPacksNeedingReminder(
      [
        pkg({ id: "empty", credits_used: 10 }),
        pkg({ id: "low", credits_used: 8 }),
        pkg({ id: "expiring", credits_used: 1, expires_at: "2026-06-17T00:00:00Z" }),
        pkg({ id: "healthy", credits_used: 1 }),
      ],
      now,
      2,
      7,
    )
    const map = Object.fromEntries(res.map((r) => [r.pkg.id, r.threshold]))
    expect(map).toEqual({ empty: "empty", low: "low", expiring: "expiring" })
  })

  it("skips packs already nudged at the same or higher severity", () => {
    const res = selectPacksNeedingReminder([pkg({ id: "x", credits_used: 8, last_reminded_threshold: "low" })], now, 2, 7)
    expect(res).toHaveLength(0)
  })

  it("re-selects when severity escalates from low to empty", () => {
    const res = selectPacksNeedingReminder([pkg({ id: "x", credits_used: 10, last_reminded_threshold: "low" })], now, 2, 7)
    expect(res).toHaveLength(1)
    expect(res[0].threshold).toBe("empty")
  })

  it("ignores healthy packs", () => {
    expect(selectPacksNeedingReminder([pkg({ credits_used: 1 })], now, 2, 7)).toHaveLength(0)
  })
})

describe("classifyPackReminders", () => {
  const cardYes = () => true
  const cardNo = () => false

  it("armed + card + low -> warns", () => {
    const reminders = [{ pkg: pkg({ id: "a", auto_renew: true }), threshold: "low" as const }]
    const res = classifyPackReminders(reminders, cardYes)
    expect(res).toEqual([{ ...reminders[0], action: "warn_auto_renew" }])
  })

  it("armed + no card + low -> the manual reminder, NOT the warning", () => {
    const reminders = [{ pkg: pkg({ id: "a", auto_renew: true }), threshold: "low" as const }]
    const res = classifyPackReminders(reminders, cardNo)
    expect(res).toEqual([{ ...reminders[0], action: "remind_manually" }])
  })

  it("unarmed + low -> the manual reminder", () => {
    const reminders = [{ pkg: pkg({ id: "a", auto_renew: false }), threshold: "low" as const }]
    // Even with a card on file, an unarmed pack never gets the warning.
    const res = classifyPackReminders(reminders, cardYes)
    expect(res).toEqual([{ ...reminders[0], action: "remind_manually" }])
  })

  it("armed + empty -> neither email (suppressed) regardless of card", () => {
    const withCard = pkg({ id: "a", auto_renew: true })
    const withoutCard = pkg({ id: "b", auto_renew: true })
    const res = classifyPackReminders(
      [
        { pkg: withCard, threshold: "empty" as const },
        { pkg: withoutCard, threshold: "empty" as const },
      ],
      (p) => p.id === "a",
    )
    expect(res).toHaveLength(0)
  })

  it("unarmed + empty -> the manual reminder (unchanged)", () => {
    const reminders = [{ pkg: pkg({ id: "a", auto_renew: false }), threshold: "empty" as const }]
    const res = classifyPackReminders(reminders, cardNo)
    expect(res).toEqual([{ ...reminders[0], action: "remind_manually" }])
  })

  it("reuses last_reminded_threshold escalation — a pack already reminded at this severity is never re-selected", () => {
    const p = pkg({ id: "x", credits_used: 8, auto_renew: true, last_reminded_threshold: "low" })
    // selectPacksNeedingReminder is the ONE mechanism that decides "already nudged" —
    // classifyPackReminders must not invent a second one.
    const reminders = selectPacksNeedingReminder([p], now, 2, 7)
    expect(reminders).toHaveLength(0)
    expect(classifyPackReminders(reminders, cardYes)).toHaveLength(0)
  })

  it("never calls hasCard for a threshold other than low — card presence is irrelevant there", () => {
    const calls: string[] = []
    const reminders = [
      {
        pkg: pkg({ id: "a", auto_renew: false, credits_used: 1, expires_at: "2026-06-17T00:00:00Z" }),
        threshold: "expiring" as const,
      },
    ]
    const res = classifyPackReminders(reminders, (p) => {
      calls.push(p.id)
      return true
    })
    expect(calls).toHaveLength(0)
    expect(res[0].action).toBe("remind_manually")
  })
})
