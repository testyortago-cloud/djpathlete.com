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

// ---------------------------------------------------------------------------
// Review findings 1, 2, 5 and 6. Every case below was run against the real
// function before being written down — none of them is a hypothesis.
// ---------------------------------------------------------------------------

describe("a price is a price whatever unit it wears", () => {
  it.each([
    ["a word amount in a per-period frame", "It's ninety-nine a month.", "99"],
    ["a word amount with no unit at all", "It's about two hundred a month.", "200"],
    ["thousands spelled as grand", "It runs two grand for the season.", "2000"],
    ["thousands spelled as k", "It runs 1.2k for the season.", "1200"],
    ["a pound sign", "It's £5 a session.", "5"],
    // Without the per-period frame, ONLY the symbol rule can catch this — the
    // pair is what pins the pound sign rather than the frame beside it.
    ["a bare pound sign", "It's £5.", "5"],
    ["a euro sign", "It's €5.", "5"],
    ["slang for pounds", "It's 5 quid.", "5"],
  ])("blocks %s", (_label, text, found) => {
    expect(validateReply(text, GROUNDED)).toContainEqual({ rule: "ungrounded_price", found })
  })

  it("still passes the grounded price written as a word in a per-period frame", () => {
    // The widened units must not turn into a blanket block: 79 IS the price.
    expect(validateReply("It's seventy-nine a month.", GROUNDED)).toEqual([])
  })

  it("scales the unit before comparing, so a grounded thousand passes as grand", () => {
    expect(validateReply("It runs two grand for the season.", [...GROUNDED, "2000"])).toEqual([])
  })
})

describe("a percentage is a percentage however it is spelled", () => {
  it.each([
    ["the word", "Athletes get 5 percent faster.", "5"],
    ["the word, split", "Athletes get 5 per cent faster.", "5"],
    ["the word, with a word number", "Athletes get five percent faster.", "5"],
  ])("blocks %s", (_label, text, found) => {
    expect(validateReply(text, GROUNDED)).toContainEqual({ rule: "ungrounded_number", found })
  })

  it("still allows a spelled-out percentage the database returned", () => {
    expect(validateReply("It covers 6 percent of the season.", GROUNDED)).toEqual([])
  })
})

describe("an outcome claim is an outcome claim in the third person too", () => {
  it.each([
    "Our athletes typically add 4 inches to their vertical in 8 weeks.",
    "Athletes who finish have added 3 mph to their throw.",
    "Most athletes see big gains within a couple of months.",
    // "gains" doubles as a verb, so the line above is caught by the plain-verb
    // pattern whether the gains-noun pattern exists or not. "results" is a
    // noun and nothing else, which is what makes this case load-bearing.
    "Most athletes see real results within a couple of months.",
    // Second person, same shape. "get" is not a plain outcome verb — the
    // OBJECT is what makes this a promise.
    "You will get results.",
    "We're cheaper than every other academy in the state.",
    "We're the best performance gym in the region.",
  ])("blocks %j", (text) => {
    expect(validateReply(text, GROUNDED).some((v) => v.rule === "promised_outcome")).toBe(true)
  })

  it.each([
    // The property the second-person verb list was chosen to preserve. "get",
    // "see" and "make" stay out of the plain verb lists precisely so ordinary
    // operational sentences survive; broadening to third person must not
    // quietly spend that.
    "You will get an email confirmation.",
    "Athletes often enjoy the programme.",
    "You will see the schedule in your welcome email.",
    "Athletes can bring a parent to the first session.",
    // The third-person mirror of "you will get an email confirmation". If
    // get/see/make were ever promoted into the plain outcome-verb list, this
    // ordinary sentence would start costing the visitor a whole turn.
    "Athletes get an email confirmation before the first session.",
    "Athletes see the schedule in their welcome email.",
    "This is the best time of year to start.",
  ])("does not block %j", (text) => {
    expect(validateReply(text, GROUNDED).some((v) => v.rule === "promised_outcome")).toBe(false)
  })
})

describe("an honest turn is not discarded as a date", () => {
  it.each([
    ["opening hours as an idiom", "We're open 24/7."],
    ["a ratio of days", "Sessions run 6/7 days a week."],
    ["a plain ratio", "Ratios are 1/8."],
    ["the modal verb, not the month", "You may 3 or 4 sessions."],
    ["a work-to-rest ratio of days after a date preposition", "Sessions start 5/7 days a week."],
  ])("passes %s", (_label, text) => {
    expect(validateReply(text, GROUNDED)).toEqual([])
  })

  it("does not read a work-to-rest interval as a date", () => {
    // 90 is not a day of any month. Widening the day back to `\d{1,2}` turns
    // "from 10/90" into a date claim; the ungrounded_number that 90 earns on
    // its own is a separate and correct verdict, so this asserts the RULE
    // rather than an empty list.
    const v = validateReply("Intervals run from 10/90 down to 10/30.", GROUNDED)
    expect(v.some((x) => x.rule === "ungrounded_date")).toBe(false)
  })

  it("still blocks a real invented numeric date", () => {
    const v = validateReply("The camp starts 12/25/2026.", GROUNDED)
    expect(v).toContainEqual({ rule: "ungrounded_date", found: "12/25/2026" })
  })

  it("still blocks a real invented date after a date preposition", () => {
    const v = validateReply("The camp starts on 12/25.", GROUNDED)
    expect(v).toContainEqual({ rule: "ungrounded_date", found: "12/25" })
  })

  it("still blocks an invented May date, which the modal-verb fix must not have unhooked", () => {
    expect(validateReply("The camp starts May 3rd.", GROUNDED).some((v) => v.rule === "ungrounded_date")).toBe(true)
    expect(validateReply("The camp starts on May 3.", GROUNDED).some((v) => v.rule === "ungrounded_date")).toBe(true)
  })

  it("blocks an invented May date carrying its own proof, with no date word in front of it", () => {
    // "starts" vouches for both sentences above, so they pass whether the
    // ordinal is read as proof or not. Here the ordinal is the ONLY signal.
    const v = validateReply("We have a camp May 3rd.", GROUNDED)
    expect(v.some((x) => x.rule === "ungrounded_date")).toBe(true)
  })
})

describe("a number the visitor supplied is not a fabrication", () => {
  // Review finding 8, captured from a real blocked turn: the visitor said
  // "my son is 14", asked what ages are coached, and the assistant's honest
  // reply — "…what's available for 14-year-olds" — was discarded whole with
  // ungrounded_number 14. Echoing back what the visitor just said is the most
  // ordinary thing a conversation does.
  it("passes a numeral the visitor stated earlier in the conversation", () => {
    const v = validateReply("Someone can tell you exactly what's available for 14-year-olds.", GROUNDED, ["14"])
    expect(v).toEqual([])
  })

  it("blocks that same numeral when the visitor never said it", () => {
    // The other half: without the visitor's own message, 14 is still invented.
    const v = validateReply("Someone can tell you exactly what's available for 14-year-olds.", GROUNDED)
    expect(v).toContainEqual({ rule: "ungrounded_number", found: "14" })
  })

  it.each([
    ["a price", "It's $500 a month.", "ungrounded_price"],
    ["a price in words", "It's five hundred dollars a month.", "ungrounded_price"],
    ["a percentage", "You save 500%.", "ungrounded_number"],
  ])("does not let the visitor supply %s", (_label, text, rule) => {
    // A VISITOR CANNOT SUPPLY YOUR PRICES. "I heard it's $500" followed by
    // "so how much is it?" must not make $500 a grounded answer, so visitor
    // numerals reach the bare-numeral rule and nothing else.
    const v = validateReply(text, GROUNDED, ["500"])
    expect(v.some((x) => x.rule === rule && x.found === "500")).toBe(true)
  })

  it("does not let the visitor supply a date", () => {
    const v = validateReply("The camp starts December 14.", GROUNDED, ["14", "december 14"])
    expect(v.some((x) => x.rule === "ungrounded_date")).toBe(true)
  })
})

describe("a promise the assistant REFUSES to make is not a promise", () => {
  /**
   * Caught in a real blocked turn, not theorised. The assistant wrote
   * "I also can't promise or guarantee results like making a team — every
   * athlete is different", and it was blocked as `promised_outcome —
   * guarantee`: the pattern matched the bare word and nothing looked left of it.
   *
   * That is the worst shape a validator can take. It punishes the single most
   * correct sentence the assistant can produce, replaces it with a refusal the
   * visitor did not need, and inflates the blocked-turn count.
   */
  it.each([
    "I also can't promise or guarantee results like making a team.",
    "I cannot guarantee you'll make the team.",
    "We don't guarantee results.",
    "There's no guarantee that happens.",
    "I won't promise you anything I can't back up.",
    "Nothing here is guaranteed.",
  ])("allows %j", (text) => {
    expect(validateReply(text, GROUNDED)).toEqual([])
  })

  it.each(["We guarantee you will make the team.", "Results are guaranteed.", "I promise you results."])(
    "still blocks the real thing: %j",
    (text) => {
      expect(validateReply(text, GROUNDED).some((v) => v.rule === "promised_outcome")).toBe(true)
    },
  )

  it("does not let a negation earlier in the sentence license a later promise", () => {
    // The window is short on purpose: a negation twenty words back governs a
    // different clause.
    const v = validateReply(
      "We don't offer refunds on the programme, and you will gain real speed from the very first block of work.",
      GROUNDED,
    )
    expect(v.some((x) => x.rule === "promised_outcome")).toBe(true)
  })
})

// ─── Clock times (Full Engine phase 2) ───────────────────────────────────────
//
// Added with the booking slots. Before this rule a time reached the bare-
// numeral step as two small digit runs and was waived, so "how about 9:00 AM?"
// passed with 10:00 and 11:30 as the only free times. Found by review.
import { clockTokens, emptyFactSet, mergeFacts, normaliseClock as factsNormaliseClock, slotForms } from "@/lib/lead-engine/chat/facts"
import { normaliseClock as validateNormaliseClock } from "@/lib/lead-engine/chat/validate"

describe("clock times", () => {
  const slotGrounded = [
    ...slotForms("2026-09-08T14:00:00.000000Z", "America/New_York"), // 10:00 AM Eastern
    ...slotForms("2026-09-08T15:30:00.000000Z", "America/New_York"), // 11:30 AM Eastern
    "september 8",
    "tuesday",
  ]

  it("blocks a time no lookup returned, even when every digit in it is small", () => {
    expect(validateReply("Tuesday, September 8 at 9:00 AM works.", slotGrounded)).toEqual([{ rule: "ungrounded_time", found: "9:00am" }])
    expect(validateReply("I can offer 4 PM on Tuesday, September 8.", slotGrounded)).toEqual([{ rule: "ungrounded_time", found: "4pm" }])
    expect(validateReply("There is a 08:00 slot.", slotGrounded)).toEqual([{ rule: "ungrounded_time", found: "8:00" }])
  })

  it("accepts a time the lookup returned, in every spelling a model writes", () => {
    for (const text of ["10:00 AM on Tuesday", "at 10 am", "10am works", "10:00 a.m.", "at 11:30 AM", "11:30am", "11:30"]) {
      expect(validateReply(text, slotGrounded)).toEqual([])
    }
  })

  it("does not let the visitor's own numerals ground a time — a visitor cannot supply availability", () => {
    expect(validateReply("Yes, 4 PM is free.", slotGrounded, ["4", "4pm"])).toEqual([{ rule: "ungrounded_time", found: "4pm" }])
  })

  it("grounds a time that appears in the source prose itself (an FAQ answer)", () => {
    const grounded = clockTokens("Sessions run 4:00 PM to 6:00 PM on weekdays, 9 am on Saturdays.")
    expect(grounded).toEqual(["4:00pm", "6:00pm", "9am"])
    expect(validateReply("Weekday sessions run 4:00 PM to 6:00 PM.", grounded)).toEqual([])
    expect(validateReply("Weekday sessions run 4:00 PM to 7:00 PM.", grounded)).toEqual([{ rule: "ungrounded_time", found: "7:00pm" }])
  })

  // MUTANT KILLED: dropping clockTokens from valuesForFact's faq case. The test
  // above calls clockTokens directly and cannot see the wiring; this one goes
  // through the fact set the way the route does.
  it("an FAQ fact grounds its own times through the fact set, so quoting the source is not blocked", () => {
    const faq = {
      kind: "faq" as const,
      question: "When are sessions?",
      answer: "Weekday sessions run 4:00 PM to 6:00 PM.",
      pageKey: "services",
    }
    const { groundedValues } = mergeFacts(emptyFactSet(), [faq])
    expect(validateReply("Weekday sessions run 4:00 PM to 6:00 PM.", groundedValues)).toEqual([])
    expect(validateReply("Weekday sessions run 4:00 PM to 7:00 PM.", groundedValues)).toEqual([{ rule: "ungrounded_time", found: "7:00pm" }])
  })

  it("an event fact grounds its wall-clock start time", () => {
    const event = {
      kind: "event" as const,
      title: "Speed Camp",
      type: "camp",
      startDate: "2026-07-20T09:00:00.000Z",
      endDate: "2026-07-24T12:00:00.000Z",
      locationName: "Main field",
      priceCents: 25000,
      capacity: 20,
      spotsLeft: 5,
      soldOut: false,
    }
    const { groundedValues } = mergeFacts(emptyFactSet(), [event])
    expect(validateReply("The camp runs 9:00 AM to 12:00 PM each day.", groundedValues)).toEqual([])
    expect(validateReply("The camp runs 8:00 AM to 12:00 PM each day.", groundedValues)).toEqual([{ rule: "ungrounded_time", found: "8:00am" }])
  })

  it("leaves ratios and single numbers alone — 1:1 coaching is not a time", () => {
    expect(validateReply("We offer 1:1 coaching and 2 group options.", [])).toEqual([])
  })

  it("the facts and validator twins of normaliseClock agree", () => {
    for (const raw of ["9:00 AM", "4 P.M.", "19:30", "09:00", "10am", "11:30 pm", " 7:05 Am "]) {
      expect(validateNormaliseClock(raw)).toBe(factsNormaliseClock(raw))
    }
    expect(validateNormaliseClock("09:00")).toBe("9:00")
    expect(validateNormaliseClock("4 P.M.")).toBe("4pm")
  })
})
