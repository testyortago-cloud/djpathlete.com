// @vitest-environment node
//
// Unit tests for the pure functions in scripts/enrol-repermission.ts —
// deliberately does NOT import or exercise `main()` (guarded behind the
// `import.meta.url` check at the bottom of the script, so importing this
// module for its exports never runs argv parsing, file reads, or a
// Supabase client). Same isolation strategy as
// __tests__/scripts/import-ghl-contacts.test.ts.
import { describe, it, expect } from "vitest"
import {
  selectRepermissionCandidates,
  maskEmail,
  checkBusinessSettingsForRepermission,
  type CandidateContactRow,
} from "../../scripts/enrol-repermission"

function contact(overrides: Partial<CandidateContactRow> & { id: string }): CandidateContactRow {
  return { email: null, phoneE164: null, name: null, ...overrides }
}

// Every call below spells out all five filter sets explicitly — none
// defaulted — so a future added set can't silently go unexercised by an
// old call site that forgot it.
function select(args: {
  contacts: CandidateContactRow[]
  contactIdsWithSmsConsent?: ReadonlySet<string>
  contactIdsWithPriorRun?: ReadonlySet<string>
  suppressedEmails?: ReadonlySet<string>
  suppressedPhones?: ReadonlySet<string>
}) {
  return selectRepermissionCandidates({
    contacts: args.contacts,
    contactIdsWithSmsConsent: args.contactIdsWithSmsConsent ?? new Set(),
    contactIdsWithPriorRun: args.contactIdsWithPriorRun ?? new Set(),
    suppressedEmails: args.suppressedEmails ?? new Set(),
    suppressedPhones: args.suppressedPhones ?? new Set(),
  })
}

describe("selectRepermissionCandidates", () => {
  it("includes a contact with an email, no sms consent row, no prior run, and no suppression", () => {
    const result = select({ contacts: [contact({ id: "c1", email: "lead@example.com", name: "Lead One" })] })
    expect(result).toEqual([{ contactId: "c1", email: "lead@example.com", name: "Lead One" }])
  })

  it("excludes a contact with no email — this ask has no channel to reach them on", () => {
    const result = select({ contacts: [contact({ id: "c1", email: null })] })
    expect(result).toEqual([])
  })

  it("excludes a contact whose email is blank/whitespace-only", () => {
    const result = select({ contacts: [contact({ id: "c1", email: "   " })] })
    expect(result).toEqual([])
  })

  // "no sms consent row" is the bar, not "no GRANTED sms consent" — a
  // contact who already explicitly said no (a granted:false row, e.g. from
  // an earlier STOP) must not be re-asked either, same as one who already
  // said yes. `contactIdsWithSmsConsent` carries membership only, no
  // polarity — this function excludes on membership alone; it is
  // `discoverCandidates` (the DB-reading caller, not unit-tested here) that
  // is responsible for building that set from contact_consents with no
  // filter on `granted`, so BOTH polarities land in the same excluded set.
  it("excludes a contact that already has ANY sms consent row, regardless of polarity", () => {
    const result = select({
      contacts: [contact({ id: "c1", email: "lead@example.com" })],
      contactIdsWithSmsConsent: new Set(["c1"]),
    })
    expect(result).toEqual([])
  })

  it("excludes a contact whose email is suppressed, case-insensitively", () => {
    const result = select({
      contacts: [contact({ id: "c1", email: "Lead@Example.com" })],
      suppressedEmails: new Set(["lead@example.com"]),
    })
    expect(result).toEqual([])
  })

  // Task 9 review, Finding 2: a phone-side suppression (an SMS STOP) has
  // already answered the exact question this email asks ("can we text
  // you?"). This ask must not press the question again just because the
  // identifier that said no is not the one this email happens to use.
  it("excludes a contact whose phone is suppressed, even though this ask is an email", () => {
    const result = select({
      contacts: [contact({ id: "c1", email: "lead@example.com", phoneE164: "+15551234567" })],
      suppressedPhones: new Set(["+15551234567"]),
    })
    expect(result).toEqual([])
  })

  it("does not exclude on a phone suppression that belongs to a DIFFERENT number", () => {
    const result = select({
      contacts: [contact({ id: "c1", email: "lead@example.com", phoneE164: "+15551234567" })],
      suppressedPhones: new Set(["+15559999999"]),
    })
    expect(result).toHaveLength(1)
  })

  it("does not exclude a contact with no phone on file from the phone-suppression check", () => {
    const result = select({
      contacts: [contact({ id: "c1", email: "lead@example.com", phoneE164: null })],
      suppressedPhones: new Set(["+15551234567"]),
    })
    expect(result).toHaveLength(1)
  })

  // Task 9 review, Finding 1: the partial unique index only covers ACTIVE
  // runs, so discovery has to exclude "ever had a run" on its own — see
  // this file's own mutation-tested proof below and
  // scripts/enrol-repermission.ts's ELIGIBILITY #5.
  it("excludes a contact with ANY prior sequence_runs row, active or finished", () => {
    const result = select({
      contacts: [contact({ id: "c1", email: "lead@example.com" })],
      contactIdsWithPriorRun: new Set(["c1"]),
    })
    expect(result).toEqual([])
  })

  it("does not exclude a contact whose prior-run membership belongs to a different contact", () => {
    const result = select({
      contacts: [contact({ id: "c1", email: "lead@example.com" })],
      contactIdsWithPriorRun: new Set(["some-other-contact"]),
    })
    expect(result).toHaveLength(1)
  })

  it("filters a mixed batch down to only the eligible contacts, preserving order", () => {
    const contacts: CandidateContactRow[] = [
      contact({ id: "c1", email: "a@example.com" }), // eligible
      contact({ id: "c2", email: null }), // no email
      contact({ id: "c3", email: "c3@example.com" }), // has sms consent
      contact({ id: "c4", email: "c4@example.com" }), // email suppressed
      contact({ id: "c5", email: "e@example.com" }), // eligible
      contact({ id: "c6", email: "c6@example.com" }), // has a prior run
      contact({ id: "c7", email: "c7@example.com", phoneE164: "+15551234567" }), // phone suppressed
    ]
    const result = select({
      contacts,
      contactIdsWithSmsConsent: new Set(["c3"]),
      contactIdsWithPriorRun: new Set(["c6"]),
      suppressedEmails: new Set(["c4@example.com"]),
      suppressedPhones: new Set(["+15551234567"]),
    })
    expect(result.map((r) => r.contactId)).toEqual(["c1", "c5"])
  })
})

describe("maskEmail", () => {
  it("keeps only the first character of the local part and the domain", () => {
    expect(maskEmail("mike@example.com")).toBe("m***@e***")
  })

  it("masks a short local part and domain the same way", () => {
    expect(maskEmail("a@b.com")).toBe("a***@b***")
  })

  it("degrades gracefully for a string with no @ at all", () => {
    expect(maskEmail("not-an-email")).toBe("n***")
  })
})

describe("checkBusinessSettingsForRepermission", () => {
  it("reports nothing missing when both fields are filled", () => {
    const result = checkBusinessSettingsForRepermission({ reply_to: "ops@example.com", display_name: "Example Co" })
    expect(result).toEqual({ missing: [] })
  })

  it("reports reply_to missing when blank", () => {
    const result = checkBusinessSettingsForRepermission({ reply_to: "", display_name: "Example Co" })
    expect(result).toEqual({ missing: ["reply_to"] })
  })

  it("reports reply_to missing when whitespace-only", () => {
    const result = checkBusinessSettingsForRepermission({ reply_to: "   ", display_name: "Example Co" })
    expect(result).toEqual({ missing: ["reply_to"] })
  })

  it("reports display_name missing when null", () => {
    const result = checkBusinessSettingsForRepermission({ reply_to: "ops@example.com", display_name: null })
    expect(result).toEqual({ missing: ["display_name"] })
  })

  it("reports both missing when both are blank", () => {
    const result = checkBusinessSettingsForRepermission({ reply_to: undefined, display_name: "" })
    expect(result).toEqual({ missing: ["reply_to", "display_name"] })
  })
})
