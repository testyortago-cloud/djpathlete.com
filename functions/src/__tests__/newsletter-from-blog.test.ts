import { describe, it, expect } from "vitest"
import { buildUserMessage } from "../newsletter-from-blog.js"

describe("newsletter-from-blog helpers", () => {
  it("buildUserMessage embeds post title + excerpt + content + tone + length under clear headings", () => {
    const msg = buildUserMessage({
      post: {
        title: "Shoulder Rehab for Overhead Athletes",
        excerpt: "A 6-12 week framework for returning to throwing.",
        content: "<p>Scapular stabilization is the foundation.</p>",
        category: "Recovery",
        tags: ["shoulder", "rehab"],
      },
      tone: "conversational",
      length: "medium",
    })
    expect(msg).toContain("BLOG POST TITLE")
    expect(msg).toContain("Shoulder Rehab for Overhead Athletes")
    expect(msg).toContain("BLOG POST EXCERPT")
    expect(msg).toContain("6-12 week framework")
    expect(msg).toContain("BLOG POST CONTENT")
    expect(msg).toContain("Scapular stabilization")
    expect(msg).toMatch(/tone.*conversational/i)
    expect(msg).toMatch(/length.*medium/i)
  })

  it("buildUserMessage handles empty tags + missing category gracefully", () => {
    const msg = buildUserMessage({
      post: {
        title: "t",
        excerpt: "e",
        content: "<p>c</p>",
        category: null,
        tags: [],
      },
      tone: "professional",
      length: "short",
    })
    expect(msg).toContain("BLOG POST TITLE")
    expect(msg).not.toMatch(/tags:\s*\n\s*-/i)
  })
})
