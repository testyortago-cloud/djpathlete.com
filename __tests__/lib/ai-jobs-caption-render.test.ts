// __tests__/lib/ai-jobs-caption-render.test.ts
import { describe, it, expect } from "vitest"
import type { AiJobType } from "@/lib/ai-jobs"

describe("AiJobType includes video_caption_render", () => {
  it("accepts the literal", () => {
    const t: AiJobType = "video_caption_render"
    expect(t).toBe("video_caption_render")
  })
})
