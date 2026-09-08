import { describe, it, expect } from "vitest"
import {
  routeToPipeline,
  CAMPS_CLINICS_KEY,
  ASSESSMENT_KEY,
  DEFAULT_PIPELINE_KEY,
  type RoutingSubject,
} from "@/lib/lead-engine/pipeline-route"

/** Asserts a routed result and WHICH key it carries — never merely that some string came back. */
function expectRouted(subject: RoutingSubject, pipelineKey: string) {
  expect(routeToPipeline(subject)).toEqual({ kind: "routed", pipelineKey })
}

/** Asserts a refused result — never a guessed board. */
function expectRefused(subject: RoutingSubject) {
  const result = routeToPipeline(subject)
  expect(result.kind).toBe("refuse")
}

describe("routeToPipeline — the routing table (spec §3.2)", () => {
  it("routes a booking (consult) to coaching", () => {
    expectRouted({ event: "booking" }, DEFAULT_PIPELINE_KEY)
  })

  it("routes a payment whose checkout was an event signup to camps_clinics — the camps row", () => {
    expectRouted({ event: "payment", checkoutType: "event_signup" }, CAMPS_CLINICS_KEY)
  })

  it("routes a payment with any other checkoutType to coaching", () => {
    expectRouted({ event: "payment", checkoutType: "shop_order" }, DEFAULT_PIPELINE_KEY)
  })

  it("routes a payment with an absent checkoutType to coaching", () => {
    expectRouted({ event: "payment" }, DEFAULT_PIPELINE_KEY)
  })

  it("routes a quiz result to coaching — the quiz row", () => {
    expectRouted({ event: "quiz_result" }, DEFAULT_PIPELINE_KEY)
  })

  it("routes an assessment service type to the assessment board — the assessment row", () => {
    expectRouted({ event: "booking", serviceType: "assessment" }, ASSESSMENT_KEY)
  })

  it("routes an assessment service type to the assessment board however the event arrives (payment)", () => {
    expectRouted({ event: "payment", serviceType: "assessment" }, ASSESSMENT_KEY)
  })

  it("routes an assessment service type to the assessment board however the event arrives (quiz_result)", () => {
    expectRouted({ event: "quiz_result", serviceType: "assessment" }, ASSESSMENT_KEY)
  })

  it("assessment overrides what a bare event_signup payment would otherwise get", () => {
    expectRouted({ event: "payment", checkoutType: "event_signup", serviceType: "assessment" }, ASSESSMENT_KEY)
  })

  it("checkoutType: 'event_signup' only means camps_clinics on a payment — not on a booking", () => {
    // Pins the `event === "payment"` half of the compound condition
    // separately from the `checkoutType === "event_signup"` half: dropping
    // just this conjunct would route a booking that happens to carry the
    // same string to camps_clinics too.
    expectRouted({ event: "booking", checkoutType: "event_signup" }, DEFAULT_PIPELINE_KEY)
  })
})

describe("routeToPipeline — fallback behaviour", () => {
  it("falls back to coaching for an unknown checkoutType", () => {
    expectRouted({ event: "payment", checkoutType: "some_future_checkout_type_nobody_named_yet" }, DEFAULT_PIPELINE_KEY)
  })

  it("falls back to coaching for an unknown event kind", () => {
    // Cast past the union deliberately: a caller passing a kind this table
    // has never heard of (a future PipelineEvent variant) must still land
    // somewhere real rather than throwing.
    expectRouted({ event: "some_future_event_kind" as unknown as RoutingSubject["event"] }, DEFAULT_PIPELINE_KEY)
  })

  it("never throws for any subject shape this table does not recognise", () => {
    expect(() =>
      routeToPipeline({ event: "some_future_event_kind" as unknown as RoutingSubject["event"], checkoutType: "anything" }),
    ).not.toThrow()
  })
})

describe("routeToPipeline — checkoutType null/undefined/empty are the same answer", () => {
  // Deliberately NOT parseStageConfig's asymmetry (lib/lead-engine/step-config.ts),
  // where an absent `pipeline` means "use the default" but an empty one is a
  // reportable mistake. Routing has nowhere to report a mistake to, so all
  // three are treated as one "no signal" answer — see the module header and
  // the RoutingSubject.checkoutType doc comment.
  it("checkoutType: undefined falls back to coaching", () => {
    expectRouted({ event: "payment", checkoutType: undefined }, DEFAULT_PIPELINE_KEY)
  })

  it("checkoutType: null falls back to coaching, identically to undefined", () => {
    expectRouted({ event: "payment", checkoutType: null }, DEFAULT_PIPELINE_KEY)
  })

  it("checkoutType: '' falls back to coaching, identically to null and undefined", () => {
    expectRouted({ event: "payment", checkoutType: "" }, DEFAULT_PIPELINE_KEY)
  })

  it("serviceType: null/undefined/'' are equally inert", () => {
    expectRouted({ event: "booking", serviceType: null }, DEFAULT_PIPELINE_KEY)
    expectRouted({ event: "booking", serviceType: undefined }, DEFAULT_PIPELINE_KEY)
    expectRouted({ event: "booking", serviceType: "" }, DEFAULT_PIPELINE_KEY)
  })
})

describe("routeToPipeline — the refund decision (spec §3.1)", () => {
  // THE REAL CONTENT OF THIS MODULE. Chosen option (a): routeToPipeline
  // refuses to answer for a refund rather than guessing a board from
  // checkoutType/serviceType. See the module header for the full reasoning.

  it("refuses a bare refund — no board can be named from amount/currency/time alone", () => {
    expectRefused({ event: "refund" })
  })

  it("refuses a refund even when it carries a WON board's own routing signal", () => {
    // THE HAZARD TEST. checkoutType: "event_signup" is exactly the fact that
    // would route a *payment* to camps_clinics — a NON-DEFAULT board. If this
    // function guessed a board for a refund the way it does for a payment,
    // this would come back `{ kind: "routed", pipelineKey: "camps_clinics" }`
    // — plausible-looking, and silently wrong the moment the actual Won card
    // lives somewhere else (spec §3.1: the table can drift from the sale, or
    // a human can move the card). Asserting the exact result, not merely
    // `.kind !== "routed"`, so a mutation that reintroduces guessing here is
    // caught regardless of which wrong board it guesses.
    const result = routeToPipeline({ event: "refund", checkoutType: "event_signup" })
    expect(result).toEqual({ kind: "refuse", reason: "refund_board_must_come_from_the_opportunity_being_amended" })
  })

  it("refuses a refund even when it carries an assessment service type", () => {
    // serviceType overrides the payment/booking rules above, but must not
    // override the refund refusal — a refund is refused unconditionally,
    // checked before serviceType is even read.
    expectRefused({ event: "refund", serviceType: "assessment" })
  })

  it("a refuse result never carries a pipelineKey", () => {
    const result = routeToPipeline({ event: "refund", checkoutType: "event_signup" })
    expect("pipelineKey" in result).toBe(false)
  })
})
