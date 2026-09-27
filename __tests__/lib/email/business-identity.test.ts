// @vitest-environment node
// `alertAddressing` (migration 00282, "Alert email") is the ONE place that
// decides where a coach alert goes. Every sender in lib/email/lead-alerts.ts
// and the sequence engine's "alert" step reads it rather than `reply_to`
// directly, so a bug here is a bug everywhere at once -- which is exactly why
// it gets its own focused suite instead of living only inside each sender's
// test file.
import { describe, it, expect } from "vitest"
import type { BusinessSettings } from "@/lib/db/businesses"
import { alertAddressing } from "@/lib/email/business-identity"

const BASE: BusinessSettings = {
  business_id: "b0000000-0000-0000-0000-00000000000a",
  display_name: "Northfield Strength",
  sender_name: "Coach Priya",
  sender_email: "hello@northfieldstrength.test",
  reply_to: "priya@northfieldstrength.test",
  logo_url: null,
  timezone: "Europe/London",
  quiet_hours_start: 21,
  quiet_hours_end: 8,
  daily_message_cap: 50,
  postal_address: "4 Mill Lane, Northfield, NF1 2AB",
  sms_help_text: "",
  sms_messaging_service_sid: "",
  sms_sender_phone: "",
  brand_color: null,
  accent_color: null,
}

describe("alertAddressing", () => {
  it("alert_email set, reply_to set and different -- to: alert_email, cc: reply_to", () => {
    // MUTANT: swapping to/cc, or dropping cc outright, sends every alert to
    // the wrong mailbox with nobody copied.
    const settings = { ...BASE, alert_email: "sales@example.test" }
    expect(alertAddressing(settings)).toEqual({ to: "sales@example.test", cc: "priya@northfieldstrength.test" })
  })

  it("alert_email set, reply_to BLANK -- to: alert_email, no cc", () => {
    // MUTANT: cc-ing an empty string reaches the provider as a second,
    // invalid recipient.
    const settings = { ...BASE, alert_email: "sales@example.test", reply_to: "" }
    expect(alertAddressing(settings)).toEqual({ to: "sales@example.test" })
    expect(alertAddressing(settings)).not.toHaveProperty("cc")
  })

  it("alert_email set, reply_to whitespace-only -- treated as blank, no cc", () => {
    const settings = { ...BASE, alert_email: "sales@example.test", reply_to: "   " }
    expect(alertAddressing(settings)).toEqual({ to: "sales@example.test" })
  })

  it("alert_email and reply_to are the SAME address, different case -- no cc", () => {
    // MUTANT: an exact-match-only comparison. Resend does not care about
    // case, so CC-ing a mailbox on itself is a no-op that just makes a reply-
    // all confusing.
    const settings = { ...BASE, alert_email: "PRIYA@northfieldstrength.test" }
    expect(alertAddressing(settings)).toEqual({ to: "PRIYA@northfieldstrength.test" })
  })

  it("alert_email BLANK, reply_to set -- to: reply_to (today's behaviour), no cc", () => {
    const settings = { ...BASE, alert_email: "" }
    expect(alertAddressing(settings)).toEqual({ to: "priya@northfieldstrength.test" })
  })

  it("alert_email NULL, reply_to set -- to: reply_to", () => {
    const settings = { ...BASE, alert_email: null }
    expect(alertAddressing(settings)).toEqual({ to: "priya@northfieldstrength.test" })
  })

  it("alert_email UNDEFINED (column not read back yet, or a fixture that predates it) -- to: reply_to", () => {
    // Proves NULL/absent are handled the same way: a business_settings row
    // read before migration 00282 ran comes back with the key simply absent,
    // never `null` -- PostgREST only returns columns that exist. BASE itself
    // has no `alert_email` key at all, so this is that exact shape.
    expect(alertAddressing(BASE)).toEqual({ to: "priya@northfieldstrength.test" })
  })

  it("both blank -- null, meaning 'nobody to tell'", () => {
    // MUTANT: returning `{ to: "" }` instead of null. An empty string
    // satisfies `to: string` and reaches the provider as a rejection, which
    // misfiles "nobody configured an address" as "delivery failed".
    const settings = { ...BASE, alert_email: "", reply_to: "" }
    expect(alertAddressing(settings)).toBeNull()
  })

  it("both null/undefined -- null", () => {
    const settings = { ...BASE, alert_email: null, reply_to: "" }
    expect(alertAddressing(settings)).toBeNull()
  })

  it("trims whitespace off both addresses before using them", () => {
    const settings = { ...BASE, alert_email: "  sales@example.test  ", reply_to: "  priya@northfieldstrength.test  " }
    expect(alertAddressing(settings)).toEqual({ to: "sales@example.test", cc: "priya@northfieldstrength.test" })
  })
})
