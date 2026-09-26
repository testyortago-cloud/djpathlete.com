// @vitest-environment node
//
// The `{{tokens}}` a sequence step may use. Its own file rather than part of
// lib/lead-engine/email.ts because the STEP EDITOR needs the same list, and
// email.ts builds a `Resend` client at module scope — importing it from a
// client component would ship the provider SDK to every visitor.
//
// `unknownMergeFields` is the editor's half and is tested here rather than
// through the component, for the same reason `parseContactFilters` is: a pure
// rule is unit-testable without rendering anything, and there is then exactly
// one answer to "what does `{{sport}}` do".
import { describe, it, expect } from "vitest"

import {
  MERGE_FIELD_KEYS,
  firstNameOf,
  substituteMergeFields,
  unknownMergeFields,
} from "@/lib/lead-engine/merge-fields"
import { ENROLMENT_METADATA_KEYS } from "@/lib/lead-engine/enrolment-metadata"

describe("MERGE_FIELD_KEYS", () => {
  it("is the metadata allow-list plus the two name fields, never a second copy of it", () => {
    // A hand-written duplicate is how the two drift, and the drift shows up as
    // a merge field that renders blank forever because nothing writes the key.
    for (const key of ENROLMENT_METADATA_KEYS) {
      expect(MERGE_FIELD_KEYS, key).toContain(key)
    }
    expect(MERGE_FIELD_KEYS).toContain("name")
    expect(MERGE_FIELD_KEYS).toContain("first_name")
    expect(MERGE_FIELD_KEYS).toHaveLength(ENROLMENT_METADATA_KEYS.length + 2)
  })

  it("offers {{sport}} now that the application form writes it, and still not {{goals}}", () => {
    // G16 {{sport}} (2026-09-27): the inquiry route now passes the form's
    // "Sport / Activity" answer into the contact event's metadata, so `sport`
    // is a key a run remembers. `goals` is still free prose, which the
    // metadata column's own 120-character cap exists to keep out: it renders
    // blank, and the editor warns about it.
    expect(MERGE_FIELD_KEYS).toContain("sport")
    expect(MERGE_FIELD_KEYS).not.toContain("goals")
  })
})

describe("firstNameOf", () => {
  it("takes everything before the first space", () => {
    expect(firstNameOf("Sam Athlete")).toBe("Sam")
    expect(firstNameOf("Priya Raman Iyer")).toBe("Priya")
  })

  it("gives a one-word name back whole", () => {
    expect(firstNameOf("Priya")).toBe("Priya")
  })

  it("gives an empty string rather than guessing", () => {
    expect(firstNameOf(null)).toBe("")
    expect(firstNameOf("")).toBe("")
    expect(firstNameOf("   ")).toBe("")
  })
})

describe("substituteMergeFields", () => {
  const metadata = { service: "camp", camp_name: "Summer Camp 2026" }

  it("fills in the name fields and the run's own memory", () => {
    const out = substituteMergeFields("Hi {{first_name}}, about {{camp_name}} ({{service}}) — {{name}}", {
      contactName: "Sam Athlete",
      metadata,
    })

    expect(out).toBe("Hi Sam, about Summer Camp 2026 (camp) — Sam Athlete")
  })

  it("fills in {{sport}} from the run's memory (G16)", () => {
    expect(substituteMergeFields("Your {{sport}} plan", { contactName: "Sam", metadata: { sport: "Soccer" } })).toBe(
      "Your Soccer plan",
    )
  })

  it("BLANKS an unknown token rather than shipping braces to a real person", () => {
    expect(substituteMergeFields("Your {{goals}} plan", { contactName: "Sam" })).toBe("Your  plan")
    expect(substituteMergeFields("{{totally_made_up}}", { contactName: "Sam" })).toBe("")
  })

  it("blanks a KNOWN token the run has no value for, the same way", () => {
    // Indistinguishable on purpose: both mean "there is nothing to say here".
    expect(substituteMergeFields("About {{camp_name}}", { contactName: "Sam" })).toBe("About ")
  })

  it("LEAVES THE CONSENT LINK PLACEHOLDER ALONE", () => {
    // Substituted later, after HTML-escaping, so the anchor survives. Blanking
    // it here would leave the one step whose entire purpose is that link with
    // nothing in it.
    const body = "Say yes: {{sms_consent_url}}"
    expect(substituteMergeFields(body, { contactName: "Sam" })).toBe(body)
  })

  it("BLANKS {{unsubscribe_url}}, because nothing has ever substituted it", () => {
    // Migration 00271's comment claims the renderer knows this token. It does
    // not — there is no substitution for it anywhere in the repo. Treating that
    // claim as true would have shipped literal braces to a real person; the
    // unsubscribe link is rendered unconditionally in the FOOTER either way.
    expect(substituteMergeFields("Bye {{unsubscribe_url}}", { contactName: "Sam" })).toBe("Bye ")
  })

  it("collapses newlines in every spliced value, not only in the name", () => {
    // The values land in the SUBJECT, a mail header. A metadata value is
    // funnel-submitted text and just as attacker-controllable as the name.
    const out = substituteMergeFields("About {{camp_name}}", {
      contactName: null,
      metadata: { camp_name: "Summer\r\nBcc: someone@evil.test" },
    })

    expect(out).not.toMatch(/[\r\n]/)
    expect(out).toBe("About Summer Bcc: someone@evil.test")
  })

  it("tolerates spacing and casing inside the braces, which is what a person types", () => {
    expect(substituteMergeFields("Hi {{ First_Name }}", { contactName: "Sam Athlete" })).toBe("Hi Sam")
  })
})

describe("unknownMergeFields", () => {
  it("names the tokens nothing will fill in", () => {
    expect(unknownMergeFields("Your {{sport}} plan for {{goals}}")).toEqual(["goals"])
  })

  it("says nothing about the ones that DO work, including the consent link", () => {
    // The presence control. A rule that flagged everything would be noise a
    // coach learns to ignore.
    const text = `Hi {{first_name}} {{name}} {{service}} {{camp_name}} {{sms_consent_url}}`
    expect(unknownMergeFields(text)).toEqual([])
  })

  it("DOES flag {{unsubscribe_url}}, which nothing fills in", () => {
    // The editor has to say so precisely BECAUSE a migration comment says the
    // opposite — a coach who read that comment would believe the token works.
    expect(unknownMergeFields("Bye {{unsubscribe_url}}")).toEqual(["unsubscribe_url"])
  })

  it("names each one once, in the order they appear", () => {
    expect(unknownMergeFields("{{b}} {{a}} {{b}} {{a}}")).toEqual(["b", "a"])
  })

  it("says nothing for text with no tokens at all", () => {
    expect(unknownMergeFields("Plain copy with { braces } that are not tokens")).toEqual([])
    expect(unknownMergeFields("")).toEqual([])
    expect(unknownMergeFields(null)).toEqual([])
  })
})
