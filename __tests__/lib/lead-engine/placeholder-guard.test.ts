// @vitest-environment node
//
// The four quiz_* sequences were seeded with bodies opening "PLACEHOLDER COPY
// — not reviewed. Do not activate this sequence until this line is gone."
// That instruction is addressed to a human, and a human is exactly who will
// be in a hurry. Activating a sequence is one UPDATE.
//
// The person on the other end has just been told something personal about
// their own body by a quiz. Placeholder text is a bad thing to send them.
import { describe, it, expect } from "vitest"
import { findLivePlaceholders, PLACEHOLDER_MARKER } from "@/lib/lead-engine/placeholder-guard"

const PLACEHOLDER_BODY = `${PLACEHOLDER_MARKER} — not reviewed. Do not activate this sequence until this line is gone.\n\nHi {{name}}`

describe("findLivePlaceholders", () => {
  it("names an active sequence still carrying the marker", () => {
    expect(findLivePlaceholders([{ key: "quiz_rebuilder", status: "active", body: PLACEHOLDER_BODY }])).toEqual([
      "quiz_rebuilder",
    ])
  })

  it("leaves a draft sequence alone — that is where placeholder copy belongs", () => {
    expect(findLivePlaceholders([{ key: "quiz_rebuilder", status: "draft", body: PLACEHOLDER_BODY }])).toEqual([])
  })

  // The presence control. Without it a green result proves nothing about
  // whether the function looked at anything at all.
  it("passes real copy that happens to be active", () => {
    expect(findLivePlaceholders([{ key: "new_lead_nurture", status: "active", body: "Hi {{name}}, welcome." }])).toEqual(
      [],
    )
  })

  it("names every offender, not just the first", () => {
    expect(
      findLivePlaceholders([
        { key: "quiz_rebuilder", status: "active", body: PLACEHOLDER_BODY },
        { key: "quiz_parent_coach", status: "active", body: PLACEHOLDER_BODY },
      ]),
    ).toEqual(["quiz_rebuilder", "quiz_parent_coach"])
  })

  it("does not trip over a null body", () => {
    // A wait step has no body at all.
    expect(findLivePlaceholders([{ key: "wait_only", status: "active", body: null }])).toEqual([])
  })

  it("catches the marker wherever it sits, not only at the start", () => {
    expect(
      findLivePlaceholders([{ key: "quiz_aspiring_pro", status: "active", body: `Hi there.\n\n${PLACEHOLDER_MARKER}` }]),
    ).toEqual(["quiz_aspiring_pro"])
  })
})
