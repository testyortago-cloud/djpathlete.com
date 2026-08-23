// @vitest-environment node
import { describe, it, expect } from "vitest"
import { classifyRisk } from "@/lib/lead-engine/chat/risk"

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
