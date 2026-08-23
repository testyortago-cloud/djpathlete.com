// @vitest-environment node
import { describe, it, expect } from "vitest"
import { validateReply } from "@/lib/lead-engine/chat/validate"

// Mirrors what facts.ts groundedValuesFor() actually emits for a $79.00,
// 6-week, 3-sessions-a-week programme and a 1 September camp. The raw
// cents form ("7900") is deliberately NOT here, because facts.ts no
// longer emits it — see moneyForms().
const GROUNDED = ["79", "79.00", "$79", "6", "3", "september 1", "2026-09-01"]

describe("prices must come from the database", () => {
  it("passes a price that is in the fact set", () => {
    expect(validateReply("The programme is $79.", GROUNDED)).toEqual([])
  })

  it("blocks a price that is not", () => {
    const v = validateReply("The programme is $120.", GROUNDED)
    expect(v).toContainEqual({ rule: "ungrounded_price", found: "120" })
    // Reported ONCE. The currency span is removed from the text before bare
    // numerals are extracted, so $120 is not also an ungrounded_number. The
    // exact-equality assertion is the only thing that can catch that
    // regression - toContainEqual is satisfied by a duplicate.
    expect(v).toEqual([{ rule: "ungrounded_price", found: "120" }])
  })

  it("blocks a price written in words", () => {
    const v = validateReply("It runs about two hundred dollars.", GROUNDED)
    expect(v.some((x) => x.rule === "ungrounded_price")).toBe(true)
  })

  it("blocks a small ungrounded price — the numeral allowlist must not waive currency", () => {
    const v = validateReply("It is only $5.", GROUNDED)
    expect(v).toContainEqual({ rule: "ungrounded_price", found: "5" })
  })
})

describe("dates must come from the database", () => {
  it("passes a date in the fact set", () => {
    expect(validateReply("The camp starts September 1.", GROUNDED)).toEqual([])
  })

  it("blocks an invented date", () => {
    const v = validateReply("The camp starts December 14.", GROUNDED)
    expect(v.some((x) => x.rule === "ungrounded_date")).toBe(true)
  })
})

describe("other numerals", () => {
  it("allows small counts that ordinary prose needs", () => {
    expect(validateReply("There are 2 things worth knowing.", GROUNDED)).toEqual([])
  })

  it("blocks a large ungrounded number", () => {
    const v = validateReply("We run 40 different programmes.", GROUNDED)
    expect(v).toContainEqual({ rule: "ungrounded_number", found: "40" })
  })

  it("blocks an ungrounded percentage — a promised outcome wearing a number", () => {
    const v = validateReply("Athletes get 30% faster.", GROUNDED)
    expect(v.some((x) => x.rule === "ungrounded_number")).toBe(true)
  })
})

describe("promised outcomes", () => {
  it.each([
    "We guarantee you will make the team.",
    "You will gain 5 mph on your throw.",
    "I promise you results.",
    "Results are guaranteed.",
  ])("blocks %j", (text) => {
    expect(validateReply(text, GROUNDED).some((v) => v.rule === "promised_outcome")).toBe(true)
  })

  it("does not block ordinary encouraging prose", () => {
    expect(validateReply("Athletes often enjoy the programme.", GROUNDED)).toEqual([])
  })
})

describe("injury advice, as defence in depth behind the input classifier", () => {
  it("blocks rehab instruction", () => {
    const v = validateReply("For that shoulder strain you should ice it and rest for a week.", GROUNDED)
    expect(v.some((x) => x.rule === "injury_advice")).toBe(true)
  })
})

describe("a percentage is a claim, never a prose count", () => {
  it("blocks a small ungrounded percentage that the numeral ceiling would waive", () => {
    // 5 <= SMALL_NUMBER_CEILING, and "get" is deliberately not a promised-outcome
    // verb, so without the percent rule this sentence passes every other check.
    const v = validateReply("Athletes get 5% faster.", GROUNDED)
    expect(v).toContainEqual({ rule: "ungrounded_number", found: "5" })
  })

  it("still allows a percentage the database returned", () => {
    expect(validateReply("It covers 6% of the season.", [...GROUNDED, "6"])).toEqual([])
  })
})

describe("a price in cents cannot masquerade as a price in dollars", () => {
  it("blocks $7900 for a $79.00 programme", () => {
    const v = validateReply("The programme is $7900.", GROUNDED)
    expect(v).toContainEqual({ rule: "ungrounded_price", found: "7900" })
  })
})
