// THE SEED SCRIPT MUST NOT CARRY ITS OWN IDEA OF WHAT A QUIZ PAGE IS.
//
// `lib/funnels/quiz-funnel-doc.ts` is the one definition, and it exists because
// the page it replaced failed the only job it has: a hero with a "Start the
// quiz" button that scrolled 138px and started nothing, because starting is a
// state inside the island that no anchor can reach. That was measured on the
// real page and fixed in 1d2cd052.
//
// This script kept a SECOND, hand-written copy of the document -- the one with
// the hero still in it. Anyone who ran it would republish the broken page over
// the fixed one, and `quiz-funnel-doc.test.ts` (which asserts the canonical
// document contains no CTA at all) would stay green throughout.
//
// The assertions below are on the SOURCE because what is being pinned is which
// definition the script reaches for, and they match CODE shapes rather than
// words: the comments in that file necessarily talk about the hero and about
// "Start the quiz", so a bare word search would be satisfied by the prose
// explaining the fix.
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

const SOURCE = readFileSync("scripts/seed-athlete-quiz-funnel.ts", "utf8")

describe("scripts/seed-athlete-quiz-funnel.ts", () => {
  it("builds its page from the one canonical definition", () => {
    expect(SOURCE).toContain('from "@/lib/funnels/quiz-funnel-doc"')
    expect(SOURCE).toContain("buildQuizFunnelDoc(")
  })

  it("hand-writes no hero section of its own", () => {
    expect(SOURCE).not.toContain('kind: "hero"')
  })

  it("hand-writes no CTA — the decoy start button is impossible by construction", () => {
    expect(SOURCE).not.toContain("primaryCta")
  })

  it("hand-writes no quiz section either, so the two cannot drift apart", () => {
    // `quizId` still appears: the script READS the quiz row and hands the id to
    // the builder. What must not appear is a section literal declaring one.
    expect(SOURCE).not.toContain('kind: "quiz"')
  })
})
