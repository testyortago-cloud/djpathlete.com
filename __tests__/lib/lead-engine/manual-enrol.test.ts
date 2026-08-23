// __tests__/lib/lead-engine/manual-enrol.test.ts
//
// The two pure halves of the manual-enrol surface: what the API route accepts,
// and what the screen says afterwards.
//
// They live in lib/ rather than in the route handler and the React component so
// both can be tested without a request or a render — and, more importantly, so
// the BATCH CAP has exactly one definition. A cap the route enforces and the
// UI guesses at is a cap the UI will eventually disagree with, and the way an
// operator discovers that is a rejected request after selecting a page of
// people.
//
// `describeEnrolResult` is the test that matters most here.
// `cold_lead_re_engagement` — the sequence this whole surface exists to make
// reachable — ships `draft` (migration 00218), so "the sequence is not active"
// is not an edge case: it is THE FIRST THING a real user hits. A generic
// "something went wrong" there would send someone hunting a bug that isn't
// there, when the true answer is one sentence long.

import { describe, expect, it } from "vitest"

import {
  MAX_ENROL_BATCH,
  describeEnrolResult,
  emptyTally,
  parseEnrolRequest,
  type EnrolTally,
} from "@/lib/lead-engine/manual-enrol"

const tally = (over: Partial<EnrolTally> = {}): EnrolTally => ({ ...emptyTally(), ...over })

describe("parseEnrolRequest", () => {
  it("accepts a well-formed body", () => {
    expect(parseEnrolRequest({ contactIds: ["c1", "c2"], sequenceKey: "cold_lead_re_engagement" })).toEqual({
      ok: true,
      contactIds: ["c1", "c2"],
      sequenceKey: "cold_lead_re_engagement",
      onePerContact: false,
    })
  })

  it("defaults onePerContact to false, matching enrolContactManually's own default", () => {
    // MUTANT: defaulting to true. A re-engagement sequence is SUPPOSED to be
    // re-runnable against someone whose earlier run finished — see the
    // `onePerContact` doc comment in lib/lead-engine/enroll.ts — so a hidden
    // true would silently skip exactly the people this sequence is for.
    const parsed = parseEnrolRequest({ contactIds: ["c1"], sequenceKey: "k" })
    expect(parsed).toMatchObject({ ok: true, onePerContact: false })
  })

  it("passes onePerContact through when it is explicitly true", () => {
    expect(parseEnrolRequest({ contactIds: ["c1"], sequenceKey: "k", onePerContact: true })).toMatchObject({
      ok: true,
      onePerContact: true,
    })
  })

  it("rejects a non-boolean onePerContact rather than coercing it", () => {
    // MUTANT: `Boolean(raw.onePerContact)`. The string "false" is truthy, so a
    // form that posted its checkbox as text would turn the guard ON while the
    // box was unticked.
    expect(parseEnrolRequest({ contactIds: ["c1"], sequenceKey: "k", onePerContact: "false" })).toMatchObject({
      ok: false,
    })
  })

  it("rejects a missing or empty contact list", () => {
    expect(parseEnrolRequest({ sequenceKey: "k" })).toMatchObject({ ok: false })
    expect(parseEnrolRequest({ contactIds: [], sequenceKey: "k" })).toMatchObject({ ok: false })
    expect(parseEnrolRequest({ contactIds: "c1", sequenceKey: "k" })).toMatchObject({ ok: false })
  })

  it("rejects a list containing anything that is not a non-empty string", () => {
    // MUTANT: `.filter(isString)` instead of rejecting. Silently dropping the
    // bad entries enrols FEWER people than the operator selected and reports
    // success, which is the one failure they cannot see.
    expect(parseEnrolRequest({ contactIds: ["c1", ""], sequenceKey: "k" })).toMatchObject({ ok: false })
    expect(parseEnrolRequest({ contactIds: ["c1", 7], sequenceKey: "k" })).toMatchObject({ ok: false })
    expect(parseEnrolRequest({ contactIds: ["c1", null], sequenceKey: "k" })).toMatchObject({ ok: false })
  })

  it("rejects a missing or blank sequence key", () => {
    expect(parseEnrolRequest({ contactIds: ["c1"] })).toMatchObject({ ok: false })
    expect(parseEnrolRequest({ contactIds: ["c1"], sequenceKey: "" })).toMatchObject({ ok: false })
    expect(parseEnrolRequest({ contactIds: ["c1"], sequenceKey: 7 })).toMatchObject({ ok: false })
  })

  it("rejects a body that is not an object at all", () => {
    expect(parseEnrolRequest(null)).toMatchObject({ ok: false })
    expect(parseEnrolRequest("nope")).toMatchObject({ ok: false })
    expect(parseEnrolRequest([])).toMatchObject({ ok: false })
  })

  it("ENFORCES the batch cap, and names the number in the error", () => {
    // MUTANT: no cap. Each enrolment is its own round trip to Postgres, so an
    // uncapped list is a request that runs until the platform kills it — and a
    // killed request leaves an unknowable number of people half-enrolled, with
    // no tally ever reaching the screen.
    const ok = parseEnrolRequest({
      contactIds: Array.from({ length: MAX_ENROL_BATCH }, (_, i) => `c${i}`),
      sequenceKey: "k",
    })
    expect(ok).toMatchObject({ ok: true })

    const tooMany = parseEnrolRequest({
      contactIds: Array.from({ length: MAX_ENROL_BATCH + 1 }, (_, i) => `c${i}`),
      sequenceKey: "k",
    })
    expect(tooMany).toMatchObject({ ok: false })
    expect((tooMany as { error: string }).error).toContain(String(MAX_ENROL_BATCH))
  })

  it("de-duplicates ids so one contact selected twice is one enrolment attempt", () => {
    expect(parseEnrolRequest({ contactIds: ["c1", "c1", "c2"], sequenceKey: "k" })).toMatchObject({
      ok: true,
      contactIds: ["c1", "c2"],
    })
  })
})

describe("describeEnrolResult says what actually happened", () => {
  it("a draft sequence is reported as a draft, not as a failure", () => {
    // MUTANT: a generic "Could not enrol those contacts." This is THE first
    // thing a real user hits, because cold_lead_re_engagement ships draft, and
    // the generic wording sends them looking for a bug that does not exist.
    const result = describeEnrolResult({
      tally: tally({ sequence_not_active: 4 }),
      sequenceName: "Cold Lead Re-Engagement",
      sequenceStatus: "draft",
    })
    expect(result.tone).toBe("error")
    expect(result.headline).toContain("Cold Lead Re-Engagement")
    expect(result.headline.toLowerCase()).toContain("draft")
    expect(result.headline.toLowerCase()).toContain("nobody was enrolled")
    // And it must say what to do about it, not just what went wrong.
    expect(`${result.headline} ${result.detail ?? ""}`.toLowerCase()).toContain("switch")
  })

  it("names the real status when it is paused rather than draft", () => {
    const result = describeEnrolResult({
      tally: tally({ sequence_not_active: 2 }),
      sequenceName: "New Lead Nurture",
      sequenceStatus: "paused",
    })
    expect(result.headline.toLowerCase()).toContain("paused")
    expect(result.headline.toLowerCase()).not.toContain("draft")
  })

  it("reports a plain success with the count", () => {
    const result = describeEnrolResult({
      tally: tally({ enrolled: 3 }),
      sequenceName: "Cold Lead Re-Engagement",
      sequenceStatus: null,
    })
    expect(result.tone).toBe("success")
    expect(result.headline).toContain("3 contacts")
    expect(result.headline).toContain("Cold Lead Re-Engagement")
  })

  it("says one contact, not 1 contacts", () => {
    const result = describeEnrolResult({ tally: tally({ enrolled: 1 }), sequenceName: "X", sequenceStatus: null })
    expect(result.headline).toContain("1 contact ")
    expect(result.headline).not.toContain("1 contacts")
  })

  it("distinguishes 'already in it' from 'has been in it before'", () => {
    const already = describeEnrolResult({
      tally: tally({ enrolled: 1, already_enrolled: 2 }),
      sequenceName: "X",
      sequenceStatus: null,
    })
    expect(already.detail).toContain("2")
    expect(already.detail?.toLowerCase()).toContain("already")

    const once = describeEnrolResult({
      tally: tally({ enrolled: 1, already_enrolled_once: 2 }),
      sequenceName: "X",
      sequenceStatus: null,
    })
    expect(once.detail?.toLowerCase()).toContain("before")
  })

  it("nobody new, everyone already in it — a warning, not a success", () => {
    // MUTANT: reporting success. "Enrolled 0 contacts" beside a green tick is
    // the kind of result an operator reads as done and never revisits.
    const result = describeEnrolResult({
      tally: tally({ already_enrolled: 5 }),
      sequenceName: "X",
      sequenceStatus: null,
    })
    expect(result.tone).toBe("warning")
    expect(result.headline.toLowerCase()).toContain("nobody new")
  })

  it("surfaces failures alongside the enrolments that DID happen", () => {
    // The partial-failure case. The route never lets one bad contact abort the
    // rest, so the screen must not report the batch as either wholly fine or
    // wholly broken.
    const result = describeEnrolResult({
      tally: tally({ enrolled: 4, failed: 1 }),
      sequenceName: "X",
      sequenceStatus: null,
    })
    expect(result.tone).toBe("warning")
    expect(result.headline).toContain("4 contacts")
    expect(result.detail).toContain("1")
    expect(result.detail?.toLowerCase()).toContain("could not")
  })

  it("a sequence that no longer exists says so", () => {
    const result = describeEnrolResult({
      tally: tally({ sequence_not_found: 3 }),
      sequenceName: "Ghost",
      sequenceStatus: null,
    })
    expect(result.tone).toBe("error")
    expect(result.headline.toLowerCase()).toContain("no longer")
  })

  it("everything failed — an error, and it does not claim anyone was enrolled", () => {
    const result = describeEnrolResult({ tally: tally({ failed: 3 }), sequenceName: "X", sequenceStatus: null })
    expect(result.tone).toBe("error")
    expect(result.headline).not.toContain("Enrolled")
  })
})
