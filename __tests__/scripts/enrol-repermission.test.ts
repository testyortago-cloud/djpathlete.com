// @vitest-environment node
//
// Unit tests for the pure functions in scripts/enrol-repermission.ts —
// deliberately does NOT import or exercise `main()` (guarded behind the
// `import.meta.url` check at the bottom of the script, so importing this
// module for its exports never runs argv parsing, file reads, or a
// Supabase client). Same isolation strategy as
// __tests__/scripts/import-ghl-contacts.test.ts.
import { describe, it, expect } from "vitest"
import { selectRepermissionCandidates, maskEmail, type CandidateContactRow } from "../../scripts/enrol-repermission"

function contact(overrides: Partial<CandidateContactRow> & { id: string }): CandidateContactRow {
  return { email: null, name: null, ...overrides }
}

describe("selectRepermissionCandidates", () => {
  it("includes a contact with an email, no sms consent row, and no suppression", () => {
    const result = selectRepermissionCandidates({
      contacts: [contact({ id: "c1", email: "lead@example.com", name: "Lead One" })],
      contactIdsWithSmsConsent: new Set(),
      suppressedEmails: new Set(),
    })
    expect(result).toEqual([{ contactId: "c1", email: "lead@example.com", name: "Lead One" }])
  })

  it("excludes a contact with no email — this ask has no channel to reach them on", () => {
    const result = selectRepermissionCandidates({
      contacts: [contact({ id: "c1", email: null })],
      contactIdsWithSmsConsent: new Set(),
      suppressedEmails: new Set(),
    })
    expect(result).toEqual([])
  })

  it("excludes a contact whose email is blank/whitespace-only", () => {
    const result = selectRepermissionCandidates({
      contacts: [contact({ id: "c1", email: "   " })],
      contactIdsWithSmsConsent: new Set(),
      suppressedEmails: new Set(),
    })
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
    const result = selectRepermissionCandidates({
      contacts: [contact({ id: "c1", email: "lead@example.com" })],
      contactIdsWithSmsConsent: new Set(["c1"]),
      suppressedEmails: new Set(),
    })
    expect(result).toEqual([])
  })

  it("excludes a contact whose email is suppressed, case-insensitively", () => {
    const result = selectRepermissionCandidates({
      contacts: [contact({ id: "c1", email: "Lead@Example.com" })],
      contactIdsWithSmsConsent: new Set(),
      suppressedEmails: new Set(["lead@example.com"]),
    })
    expect(result).toEqual([])
  })

  it("does NOT exclude on a phone-side concern — this function only ever sees email", () => {
    // Sanity check on the type contract: CandidateContactRow carries no
    // phone field at all, so a phone suppression can never leak into this
    // filter by accident.
    const result = selectRepermissionCandidates({
      contacts: [contact({ id: "c1", email: "lead@example.com" })],
      contactIdsWithSmsConsent: new Set(),
      suppressedEmails: new Set(),
    })
    expect(result).toHaveLength(1)
  })

  it("filters a mixed batch down to only the eligible contacts, preserving order", () => {
    const contacts: CandidateContactRow[] = [
      contact({ id: "c1", email: "a@example.com" }), // eligible
      contact({ id: "c2", email: null }), // no email
      contact({ id: "c3", email: "c3@example.com" }), // has sms consent
      contact({ id: "c4", email: "c4@example.com" }), // suppressed
      contact({ id: "c5", email: "e@example.com" }), // eligible
    ]
    const result = selectRepermissionCandidates({
      contacts,
      contactIdsWithSmsConsent: new Set(["c3"]),
      suppressedEmails: new Set(["c4@example.com"]),
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
