// Regression cover for the first add_negative_keyword apply ever attempted —
// which failed on TWO bugs at once (rec 1e5623ea, 2026-07-14).
//
// Every previously-applied rec was `new_campaign`, which needs no scope and
// carries its own payload shape, so this path had never actually run. The
// strategist's propose_negative_keywords produced a rec that hit:
//   1. payload shape — agent writes bulk { args: { negative_keywords[],
//      match_types[] } }; the applier demanded a single { text, match_type }.
//   2. scope_id — agent scopes by our internal campaign UUID; the applier
//      treats scope_id as the EXTERNAL Google campaign id.
import { describe, it, expect } from "vitest"
import { normalizeNegativeKeywordPayload } from "@/lib/validators/ads"

// Verbatim from the failed prod row.
const AGENT_BULK_PAYLOAD = {
  args: {
    campaign_id: "b5d033e6-9ece-4d26-92b9-40a1ce8119b6",
    campaign_name: "Search · Local · Tampa Bay",
    match_types: ["EXACT", "PHRASE"],
    negative_keywords: [
      "sports physical therapy",
      "physical therapy",
      "pilates",
      "athletic clearance",
    ],
  },
  rank: 3,
  tool: "propose_negative_keywords",
  confidence: "high",
}

// What the nightly generator emits.
const NIGHTLY_SINGLE_PAYLOAD = { text: "free workout", match_type: "PHRASE" }

describe("normalizeNegativeKeywordPayload", () => {
  it("accepts the nightly generator's single { text, match_type }", () => {
    const result = normalizeNegativeKeywordPayload(NIGHTLY_SINGLE_PAYLOAD)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.keywords).toEqual([{ text: "free workout", match_type: "PHRASE" }])
  })

  it("accepts the agent's bulk shape as a keyword × match_type cross-product", () => {
    const result = normalizeNegativeKeywordPayload(AGENT_BULK_PAYLOAD)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 4 keywords × 2 match types — one approval click, eight negatives.
    expect(result.keywords).toHaveLength(8)
    expect(result.keywords).toContainEqual({
      text: "sports physical therapy",
      match_type: "EXACT",
    })
    expect(result.keywords).toContainEqual({
      text: "sports physical therapy",
      match_type: "PHRASE",
    })
  })

  it("dedupes repeated keyword/match_type pairs", () => {
    const result = normalizeNegativeKeywordPayload({
      args: {
        negative_keywords: ["pilates", "Pilates", "pilates"],
        match_types: ["EXACT", "EXACT"],
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Case-insensitive on text, so "pilates"/"Pilates" collapse.
    expect(result.keywords).toHaveLength(1)
  })

  it("rejects a payload carrying neither shape", () => {
    const result = normalizeNegativeKeywordPayload({ nonsense: true })
    expect(result.ok).toBe(false)
  })

  it("rejects a bulk payload with an invalid match type", () => {
    const result = normalizeNegativeKeywordPayload({
      args: { negative_keywords: ["x"], match_types: ["FUZZY"] },
    })
    expect(result.ok).toBe(false)
  })

  it("rejects an empty bulk keyword list rather than emitting zero ops", () => {
    const result = normalizeNegativeKeywordPayload({
      args: { negative_keywords: [], match_types: ["EXACT"] },
    })
    expect(result.ok).toBe(false)
  })
})
