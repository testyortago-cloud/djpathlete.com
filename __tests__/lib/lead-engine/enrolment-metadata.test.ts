// @vitest-environment node
//
// G10. The allow-list that stands between a contact event's free-form
// metadata bag and `sequence_runs.enrolment_metadata`.
//
// THE POINT OF THIS FILE IS THE NEGATIVE HALF. The event metadata that
// reaches `enrollIfTriggered` is, for a funnel submission, the visitor's
// whole typed payload (lib/funnels/capture-contact.ts passes it straight
// through), and funnel field NAMES are chosen by the owner with the same
// character set an allow-listed key uses. So "we only copy seven keys" is
// the first guard and not the only one that has to hold.
import { describe, it, expect } from "vitest"
import {
  ENROLMENT_METADATA_KEYS,
  ENROLMENT_METADATA_MAX_VALUE_LENGTH,
  pickEnrolmentMetadata,
} from "@/lib/lead-engine/enrolment-metadata"

describe("pickEnrolmentMetadata", () => {
  it("keeps every allow-listed key", () => {
    // Driven off the exported list rather than a hand-written copy: a key
    // added to the allow-list and forgotten here would otherwise go untested.
    const input: Record<string, unknown> = {}
    for (const key of ENROLMENT_METADATA_KEYS) input[key] = `value-${key}`

    const picked = pickEnrolmentMetadata(input)

    expect(Object.keys(picked).sort()).toEqual([...ENROLMENT_METADATA_KEYS].sort())
    for (const key of ENROLMENT_METADATA_KEYS) {
      expect(picked[key]).toBe(`value-${key}`)
    }
  })

  it("drops every key that is not on the allow-list — and the control proves the kept ones are really kept", () => {
    const picked = pickEnrolmentMetadata({
      service: "camp",
      notes: "my knee hurts when I sprint",
      score: 42,
      profile: "explosive",
      attempt_id: "11111111-1111-4111-8111-111111111111",
      signup_type: "interest",
      gclid: "Cj0KCQjw",
      utm_source: "google",
    })

    // The control: without a kept key, an all-dropping implementation would
    // satisfy every "is not present" assertion below.
    expect(picked).toEqual({ service: "camp" })
  })

  it("NEVER stores an email address, whichever key carries it", () => {
    // The row's own acceptance criterion. An owner may name a funnel field
    // `service` or `camp_name`, and a visitor may type anything into it.
    for (const key of ENROLMENT_METADATA_KEYS) {
      const picked = pickEnrolmentMetadata({ [key]: "someone@example.com" })
      expect(picked, `${key} carried an email through`).toEqual({})
    }
  })

  it("NEVER stores a phone number, whichever key carries it, in any of the shapes a person types one", () => {
    const shapes = ["+61 412 345 678", "(202) 555-0123", "202-555-0123", "12025550123", "+1.202.555.0123"]
    for (const key of ENROLMENT_METADATA_KEYS) {
      for (const shape of shapes) {
        const picked = pickEnrolmentMetadata({ [key]: shape })
        expect(picked, `${key} carried ${shape} through`).toEqual({})
      }
    }
  })

  it("NEVER stores a phone number BURIED IN A LONGER ANSWER, on any key but the free-text title", () => {
    // The case an all-digits rule misses, and the exact one the module's own
    // header names as the reason the value guard exists: an owner names a
    // funnel field `service` (legal), and a visitor types a sentence into
    // it. "camp - best on 0412 345 678 after 6pm" is not all digits, so a
    // rule anchored to the whole value would store the phone verbatim in a
    // column with no redaction path.
    const buried = ["camp - best on 0412 345 678 after 6pm", "+61-412-345-678 (mobile)", "parent, call 2025550123"]
    for (const key of ENROLMENT_METADATA_KEYS.filter((k) => k !== "camp_name")) {
      for (const value of buried) {
        expect(pickEnrolmentMetadata({ [key]: value }), `${key} carried "${value}" through`).toEqual({})
      }
    }
  })

  it("keeps a camp TITLE that merely contains a year — the one key where a digit run is ordinary", () => {
    // `camp_name` is free text the owner wrote, and "Summer Camp 2026-2027"
    // reduces to an eight-digit run. It therefore keeps the loose rule
    // (refused only when it is nothing BUT a phone number), and it is the
    // only key that does — see `looksLikeAnIdentifier`.
    expect(pickEnrolmentMetadata({ camp_name: "Summer Camp 2026-2027" })).toEqual({
      camp_name: "Summer Camp 2026-2027",
    })
    // ...and the strict rule really is in force for a sibling key, which is
    // what makes the line above a deliberate exception rather than a hole.
    expect(pickEnrolmentMetadata({ service: "Summer Camp 2026-2027" })).toEqual({})
  })

  it("drops a value that is not a plain scalar", () => {
    // A nested object under an allow-listed key would smuggle the whole
    // payload past a key-only guard.
    expect(
      pickEnrolmentMetadata({
        service: { email: "someone@example.com", phone: "+61412345678" },
        role: ["parent"],
        branch: null,
        tier: undefined,
      }),
    ).toEqual({})
  })

  it("stores a number or a boolean as its string, so the branch comparison is one rule", () => {
    expect(pickEnrolmentMetadata({ tier: 3, role: true })).toEqual({ tier: "3", role: "true" })
  })

  it("drops a number that is not finite", () => {
    expect(pickEnrolmentMetadata({ tier: Number.NaN })).toEqual({})
    expect(pickEnrolmentMetadata({ tier: Number.POSITIVE_INFINITY })).toEqual({})
  })

  it("trims, and drops a value that is empty or only whitespace", () => {
    expect(pickEnrolmentMetadata({ service: "  camp  " })).toEqual({ service: "camp" })
    expect(pickEnrolmentMetadata({ service: "   ", role: "" })).toEqual({})
  })

  it("drops an over-long value rather than truncating it", () => {
    // Truncating would leave a value that silently matches nothing, which is
    // indistinguishable from a branch that is simply false — and half a long
    // answer can still carry whatever the first half of it was.
    const atLimit = "c".repeat(ENROLMENT_METADATA_MAX_VALUE_LENGTH)
    const overLimit = "c".repeat(ENROLMENT_METADATA_MAX_VALUE_LENGTH + 1)

    expect(pickEnrolmentMetadata({ camp_name: atLimit })).toEqual({ camp_name: atLimit })
    expect(pickEnrolmentMetadata({ camp_name: overLimit })).toEqual({})
  })

  it("reads only the bag's OWN keys, never one it merely inherits", () => {
    // The distinction between `hasOwnProperty` and `key in metadata`, and the
    // only case that tells them apart. An earlier version of this test used
    // `JSON.parse('{"__proto__": …}')`, which does NOT: JSON.parse writes
    // `__proto__` as an ordinary own property and leaves the prototype chain
    // alone, so `"service" in bag` was false either way and a mutation from
    // `hasOwnProperty` to `in` survived the whole suite.
    const inherited = Object.create({ service: "camp" }) as Record<string, unknown>
    expect("service" in inherited).toBe(true) // the control: `in` WOULD see it
    expect(pickEnrolmentMetadata(inherited)).toEqual({})

    // And its own key is still read, so this is not "reads nothing".
    inherited.role = "parent"
    expect(pickEnrolmentMetadata(inherited)).toEqual({ role: "parent" })
  })

  it("is not fooled by a JSON payload carrying __proto__, and pollutes nothing", () => {
    const hostile = JSON.parse('{"__proto__": {"service": "camp"}, "constructor": "x"}') as Record<string, unknown>
    expect(pickEnrolmentMetadata(hostile)).toEqual({})
    expect(({} as Record<string, unknown>).service).toBeUndefined()
  })

  it("emits keys in the allow-list's order, not the caller's", () => {
    // The docstring promises this, so that two identical enrolments
    // serialise identically. Every other assertion in this file compares
    // objects or sorts the keys, so switching the loop to
    // `Object.keys(metadata)` would keep them all green.
    const picked = pickEnrolmentMetadata({ camp_name: "Summer Camp", branch: "rebuilder", service: "camp" })
    expect(Object.keys(picked)).toEqual(["service", "branch", "camp_name"])
  })

  it("answers {} for nothing at all", () => {
    expect(pickEnrolmentMetadata(undefined)).toEqual({})
    expect(pickEnrolmentMetadata(null)).toEqual({})
    expect(pickEnrolmentMetadata({})).toEqual({})
  })
})
