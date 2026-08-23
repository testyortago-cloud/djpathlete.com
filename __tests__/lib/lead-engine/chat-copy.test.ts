// @vitest-environment node
import { describe, it, expect } from "vitest"
import { REFUSAL_BLOCKED, REFUSAL_INJURY, NO_EVENTS_SCHEDULED } from "@/lib/lead-engine/chat/constants"

/**
 * WHY THIS FILE EXISTS.
 *
 * Every other test that touches these sentences imports the constant and
 * compares it to itself — `expect(reply).toBe(REFUSAL_BLOCKED)`. That is an
 * identity check, and it is satisfied by the empty string. Setting all three to
 * `""` left the entire refusal suite green: categories 1-7 still "passed" while
 * a blocked or short-circuited visitor was shown a blank reply, and
 * "answers the empty camp list with designed copy rather than an empty array"
 * passed with the designed copy being exactly the empty result it exists to
 * prevent.
 *
 * These assertions pin SUBSTANCE. They are the only place in the suite that
 * would notice the copy going missing.
 */
describe("the fixed sentences say something", () => {
  it.each([
    ["REFUSAL_BLOCKED", REFUSAL_BLOCKED],
    ["REFUSAL_INJURY", REFUSAL_INJURY],
    ["NO_EVENTS_SCHEDULED", NO_EVENTS_SCHEDULED],
  ])("%s is a real sentence, not an empty string", (_name, copy) => {
    expect(copy.trim().length).toBeGreaterThan(40)
    expect(copy).toMatch(/[.!?]$/)
  })

  it("the blocked refusal admits it cannot answer and offers a person", () => {
    expect(REFUSAL_BLOCKED).toMatch(/can't answer|cannot answer/i)
    expect(REFUSAL_BLOCKED).toMatch(/person|someone/i)
    // It must never guess in the same breath as refusing.
    expect(REFUSAL_BLOCKED).not.toMatch(/\$\d/)
  })

  it("the injury refusal declines advice and says why", () => {
    expect(REFUSAL_INJURY).toMatch(/not able to give advice|can't give advice|cannot give advice/i)
    expect(REFUSAL_INJURY).toMatch(/injury|medical/i)
    expect(REFUSAL_INJURY).toMatch(/qualified|assess|person|team/i)
  })

  it("the empty-camps line says there are none AND offers a next step", () => {
    // 0 events are published today, so this is the COMMON path. A bare "none"
    // ends the conversation; the offer is what keeps the lead.
    expect(NO_EVENTS_SCHEDULED).toMatch(/no camps|no clinics|nothing scheduled/i)
    expect(NO_EVENTS_SCHEDULED).toMatch(/details|let you know|next one/i)
  })

  it("none of them names a business — this directory is brand-free by construction", () => {
    for (const copy of [REFUSAL_BLOCKED, REFUSAL_INJURY, NO_EVENTS_SCHEDULED]) {
      expect(copy).not.toMatch(/DJP|Darren|darrenjpaul/i)
    }
  })
})
