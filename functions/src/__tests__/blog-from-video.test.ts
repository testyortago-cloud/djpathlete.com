import { describe, it, expect } from "vitest"
import { deriveResearchTopic, buildBlogUserMessage } from "../blog-from-video.js"

describe("blog-from-video helpers", () => {
  it("deriveResearchTopic prefers video title + uses transcript excerpt when short", () => {
    const topic = deriveResearchTopic({
      videoTitle: "Shoulder Rehab for Overhead Athletes",
      transcript: "Today we're working on rotator cuff mobility.",
    })
    expect(topic).toContain("Shoulder Rehab")
    expect(topic.length).toBeLessThanOrEqual(400)
  })

  it("deriveResearchTopic falls back to transcript when title is blank", () => {
    const topic = deriveResearchTopic({
      videoTitle: "",
      transcript: "Today we're working on scapular stabilization drills for throwing athletes.",
    })
    expect(topic.toLowerCase()).toContain("scapular")
  })

  it("buildBlogUserMessage embeds transcript + brief summary + tone + length under clear headings", () => {
    const msg = buildBlogUserMessage({
      transcript: "Scapular stabilization matters for overhead athletes.",
      brief: {
        topic: "shoulder rehab",
        summary: "Evidence supports progressive loading",
        results: [],
        extracted: [],
        generated_at: "2026-04-20T10:00:00.000Z",
      },
      tone: "professional",
      length: "medium",
      videoTitle: "Shoulder Rehab",
    })
    expect(msg).toContain("VIDEO TRANSCRIPT")
    expect(msg).toContain("Scapular stabilization")
    expect(msg).toContain("RESEARCH")
    expect(msg).toContain("Evidence supports progressive loading")
    expect(msg).toMatch(/tone.*professional/i)
    expect(msg).toMatch(/length.*medium/i)
  })
})
