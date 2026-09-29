import { describe, it, expect } from "vitest"
import { escapeLittleText } from "@/lib/social/linkedin-little-text"

describe("escapeLittleText", () => {
  it("escapes every reserved character LinkedIn would otherwise parse", () => {
    expect(escapeLittleText("ACL (anterior cruciate) [1] {x} <y> a_b *c* ~d~ e|f @g \\h")).toBe(
      "ACL \\(anterior cruciate\\) \\[1\\] \\{x\\} \\<y\\> a\\_b \\*c\\* \\~d\\~ e\\|f \\@g \\\\h",
    )
  })

  it("leaves a hashtag a hashtag", () => {
    expect(escapeLittleText("Train smart #strengthtraining #ACL2026")).toBe(
      "Train smart #strengthtraining #ACL2026",
    )
  })

  it("escapes a # that does not start a hashtag", () => {
    expect(escapeLittleText("Rule # one, and # ")).toBe("Rule \\# one, and \\# ")
  })

  it("leaves plain text, emoji and line breaks alone", () => {
    const plain = "Three cues for a better squat.\n\nKnees out. 💪"
    expect(escapeLittleText(plain)).toBe(plain)
  })
})
