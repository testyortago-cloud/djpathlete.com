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
