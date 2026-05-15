import { describe, it, expect } from "vitest"
import { scoreBlogVsBrief } from "../strategy/brief-blog-scorer.js"

describe("scoreBlogVsBrief", () => {
  it("scores higher when title/content matches themes + keywords", () => {
    const brief = {
      themes: [
        { tag: "rotational-power", weight: 1 },
        { tag: "shoulder-mobility", weight: 0.5 },
      ],
      keywords_to_chase: ["rotational power", "drive distance"],
      hooks_to_test: [],
      ctas: [],
      dont_do: [],
    } as never
    const a = scoreBlogVsBrief(
      { title: "Rotational power drives long drives", content: "drive distance rotational power" },
      brief,
    )
    const b = scoreBlogVsBrief(
      { title: "Stretching basics", content: "general flexibility content" },
      brief,
    )
    expect(a).toBeGreaterThan(b)
  })

  it("returns 0 when brief has no signal terms", () => {
    expect(
      scoreBlogVsBrief(
        { title: "x", content: "y" },
        { themes: [], keywords_to_chase: [], hooks_to_test: [], ctas: [], dont_do: [] } as never,
      ),
    ).toBe(0)
  })
})

describe("scoreBlogVsBrief — dont_do rejection", () => {
  const brief = {
    themes: [{ tag: "rotational-power", weight: 1 }],
    keywords_to_chase: ["rotational athletes"],
    hooks_to_test: [],
    dont_do: ["knee surgery recovery"],
  }

  it("returns -1 when a dont_do phrase appears in the title", () => {
    const blog = {
      title: "Comeback from knee surgery recovery",
      content: "anything",
    }
    expect(scoreBlogVsBrief(blog, brief)).toBe(-1)
  })

  it("returns -1 when a dont_do phrase appears in the content (word-boundary)", () => {
    const blog = {
      title: "Rotational power for athletes",
      content: "We discuss knee surgery recovery briefly here.",
    }
    expect(scoreBlogVsBrief(blog, brief)).toBe(-1)
  })

  it("rejects 'pain' as a word even when used in a phrase", () => {
    const brief2 = { ...brief, dont_do: ["pain"] }
    const blog = {
      title: "Pain-free rotation",
      content: "Pain free does not equal pain.",
    }
    // "pain" matches at word boundary in "Pain-free" (because hyphen is a boundary) and "pain."
    expect(scoreBlogVsBrief(blog, brief2)).toBe(-1)
  })

  it("does NOT reject 'painted' when dont_do is 'pain' (word-boundary)", () => {
    const brief3 = { ...brief, dont_do: ["pain"] }
    const blog = {
      title: "A painted wall",
      content: "The wall was painted.",
    }
    expect(scoreBlogVsBrief(blog, brief3)).not.toBe(-1)
  })

  it("returns positive score when dont_do is absent and themes/keywords match", () => {
    const blog = {
      title: "Rotational power for elite athletes",
      content: "Rotational athletes need...",
    }
    expect(scoreBlogVsBrief(blog, brief)).toBeGreaterThan(0)
  })
})
