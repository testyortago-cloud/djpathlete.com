import { describe, it, expect } from "vitest"
import { computeSetupItems, type SetupStatusSources } from "@/lib/bookkeeping/setup-status"

function allDone(over: Partial<SetupStatusSources> = {}): SetupStatusSources {
  return {
    gmailConnected: true,
    latestGmailCronDetail: { fetch_status: "ok", listed: 3 }, // no label_missing key = label exists
    forwarders: ["daz_paul@hotmail.com"],
    flags: { gmailReceipts: true, incomeSync: true, payoutSync: true, retention: true, receiptWatchdog: true, quarterlyPack: true },
    taxRatePercent: 22.5,
    accountantEmail: "cpa@example.com",
    statementEntryExists: true,
    manualChecks: ["categories_reviewed"],
    ...over,
  }
}
const byKey = (s: SetupStatusSources) => Object.fromEntries(computeSetupItems(s).map((i) => [i.key, i]))

describe("computeSetupItems", () => {
  it("fully configured system → every item done", () => {
    expect(computeSetupItems(allDone()).every((i) => i.status === "done")).toBe(true)
  })
  it("returns 11 items in stable order with unique keys", () => {
    const items = computeSetupItems(allDone())
    expect(items).toHaveLength(11)
    expect(new Set(items.map((i) => i.key)).size).toBe(11)
  })
  it("splits into exactly 6 plain basics (first) and 5 advanced extras", () => {
    const items = computeSetupItems(allDone())
    const basics = items.filter((i) => !i.advanced).map((i) => i.key)
    const advanced = items.filter((i) => i.advanced).map((i) => i.key)
    expect(basics).toEqual([
      "gmail_connected", "income_sync", "tax_rate",
      "accountant_email", "first_statement", "categories_reviewed",
    ])
    expect(advanced).toEqual([
      "email_receipts_cron", "forwarders", "gmail_label", "quarterly_pack", "housekeeping",
    ])
    // Basics render before advanced — the panel's collapsed section relies on it.
    expect(items.findIndex((i) => i.advanced)).toBe(6)
  })
  it("no gmail connection → only gmail_connected flips", () => {
    const items = byKey(allDone({ gmailConnected: false }))
    expect(items.gmail_connected.status).toBe("todo")
    expect(Object.values(items).filter((i) => i.status !== "done")).toHaveLength(1)
  })
  it("label_missing on the latest cron run → gmail_label todo with detail", () => {
    const items = byKey(allDone({ latestGmailCronDetail: { fetch_status: "ok", label_missing: true } }))
    expect(items.gmail_label.status).toBe("todo")
    expect(items.gmail_label.detail).toMatch(/label/i)
  })
  it("cron never ran → gmail_label is attention (cannot verify), not done", () => {
    expect(byKey(allDone({ latestGmailCronDetail: null })).gmail_label.status).toBe("attention")
  })
  it("empty/garbage forwarders → forwarders todo", () => {
    expect(byKey(allDone({ forwarders: [] })).forwarders.status).toBe("todo")
    expect(byKey(allDone({ forwarders: "junk" })).forwarders.status).toBe("todo")
  })
  it("income sync done requires BOTH income and payout flags; detail names the off one", () => {
    const items = byKey(allDone({ flags: { ...allDone().flags, payoutSync: false } }))
    expect(items.income_sync.status).toBe("todo")
    expect(items.income_sync.detail).toMatch(/payout/i)
  })
  it("null tax rate → tax_rate todo", () => {
    expect(byKey(allDone({ taxRatePercent: null })).tax_rate.status).toBe("todo")
  })
  it("blank accountant email → accountant_email todo AND quarterly pack stays independent", () => {
    const items = byKey(allDone({ accountantEmail: "" }))
    expect(items.accountant_email.status).toBe("todo")
    expect(items.quarterly_pack.status).toBe("done")
  })
  it("housekeeping requires retention AND watchdog", () => {
    expect(byKey(allDone({ flags: { ...allDone().flags, retention: false } })).housekeeping.status).toBe("todo")
  })
  it("no statement entries → first_statement todo", () => {
    expect(byKey(allDone({ statementEntryExists: false })).first_statement.status).toBe("todo")
  })
  it("manual categories_reviewed comes from the stored array and is marked manual", () => {
    const items = byKey(allDone({ manualChecks: [] }))
    expect(items.categories_reviewed.status).toBe("todo")
    expect(items.categories_reviewed.manual).toBe(true)
    expect(byKey(allDone({ manualChecks: "garbage" })).categories_reviewed.status).toBe("todo")
  })
})
