// @vitest-environment node
import { describe, it, expect } from "vitest"
import { classifyRisk, classifyTurn } from "@/lib/lead-engine/chat/risk"

describe("injury questions never reach the model", () => {
  it.each([
    "my shoulder hurts when I throw, what should I do?",
    "I tore my ACL last year, can I still train?",
    "is it ok to run on a sprained ankle?",
    "how do I rehab tennis elbow",
    "my son has a concussion, when can he play again?",
    "when can I return to sport after surgery",
  ])("classifies %j as injury or medical", (m) => {
    expect(classifyRisk(m)).not.toBe("none")
  })
})

describe("ordinary questions are not swept up", () => {
  it.each([
    "how much does coaching cost?",
    "do you have any camps coming up?",
    "what is the difference between online and in person?",
    "my son is 14, is he old enough?",
    "I want to get faster for soccer",
  ])("classifies %j as none", (m) => {
    expect(classifyRisk(m)).toBe("none")
  })
})

// A term matched as a substring rather than a whole word is the failure mode
// that turns this classifier from a safety control into a nuisance: every one
// of these is an ordinary sales question that hides a risk term inside a
// longer word.
describe("terms match whole words, never fragments of longer ones", () => {
  it.each([
    ["is there a camp in September?", "pt"],
    ["do your coaches work with high school kids?", "aches"],
    ["do you help athletes reach a championship?", "hip"],
    ["how many training sessions per week?", "strain"],
  ])("classifies %j as none, though it contains %j", (m) => {
    expect(classifyRisk(m)).toBe("none")
  })
})

// Nobody types "I have a lower-back strain, please advise". They type the
// sentence below. Every one of these was returning "none" — which is to say
// the control was letting the model answer a medical question — and the
// misses were all one of three things: a body part the list never named, a
// symptom written in a tense the visitor did not use, or a question about a
// child rather than about the person typing.
describe("the indirect phrasings a parent actually types", () => {
  it.each([
    // A symptom word the list had never heard of.
    "my kid's elbow has been clicking, is that something you work on?",
    "my knee has been popping",
    "my shoulder feels unstable when I throw overhead",
    "she has a niggle in her hamstring, should she train?",
    "my ankle rolled last week and is still puffy",
    // "back" — the commonest complaint in sport, and not a condition term at all
    // while only "lower back" and "upper back" were listed.
    "is it safe to train with a bad back?",
    "my back is killing me after practice, can I still come?",
    // Written about a child, in the third person, which is how this audience
    // writes every question.
    "should he be taking creatine at 13?",
    "he took a knock to the head at the weekend, can he train?",
    "my son had an operation in March, when can he lift again?",
    "my kid gets headaches after heading the ball",
    "coming back from a long layoff after my op — where should I start?",
  ])("classifies %j as injury or medical", (m) => {
    expect(classifyRisk(m)).not.toBe("none")
  })
})

// The mirror of the block above, and it matters exactly as much. A classifier
// that answers "injury" to everything passes every true-positive test in this
// file and makes the assistant useless. Each of these contains a word the
// widened vocabulary now knows, in its ordinary, harmless sense.
describe("the widened vocabulary does not sweep up ordinary questions", () => {
  it.each([
    // Deliberately designed out of the condition list, both of them.
    "how do I build muscle?",
    "how do I improve joint mobility?",
    // "back", in the four ways it is not a body part.
    "when can he come back to training?",
    "my son is back at school in September, can he still come?",
    "my back squat has stalled, what should I do?",
    "I'll get back to you once I've spoken to my daughter",
    // "bother", "roll" and "take" in their innocent senses.
    "sorry to bother you, do you work on hip mobility?",
    "should my son foam roll his hamstring before a session?",
    "do you take walk-ins?",
    // "hip", one more time, in a phrase that is not a body part at all.
    "my daughter does hip hop, can she train with you?",
    // A hyphen is a word boundary, so "op" — a parent's word for surgery —
    // found one in the middle of this.
    "how does the co-op program with the school work?",
  ])("classifies %j as none", (m) => {
    expect(classifyRisk(m)).toBe("none")
  })
})

// A question asked over two turns is one question. `classifyRisk` sees only the
// message in front of it, so on its own it can be walked around by splitting
// the condition off from the symptom — which is why the route classifies the
// pair.
describe("a question split across two turns", () => {
  it("is caught, though neither half is an injury question alone", () => {
    expect(classifyRisk("I have a question about my knee.")).toBe("none")
    expect(classifyRisk("It hurts when I squat.")).toBe("none")

    expect(classifyTurn("It hurts when I squat.", "I have a question about my knee.")).toBe("injury")
  })

  it("still answers on the message alone when there is no turn before it", () => {
    expect(classifyTurn("my shoulder hurts when I throw", null)).toBe("injury")
    expect(classifyTurn("how much does coaching cost?", null)).toBe("none")
    expect(classifyTurn("how much does coaching cost?", "do you run camps in July?")).toBe("none")
  })
})
