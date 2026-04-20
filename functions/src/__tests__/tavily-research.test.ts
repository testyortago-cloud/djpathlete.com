import { describe, it, expect } from "vitest"
import { shouldPersist } from "../tavily-research.js"

describe("tavily-research helpers", () => {
  it("shouldPersist returns true only when blog_post_id is a non-empty string", () => {
    expect(shouldPersist({ topic: "x" })).toBe(false)
    expect(shouldPersist({ topic: "x", blog_post_id: "" })).toBe(false)
    expect(shouldPersist({ topic: "x", blog_post_id: "abc-123" })).toBe(true)
  })
})
