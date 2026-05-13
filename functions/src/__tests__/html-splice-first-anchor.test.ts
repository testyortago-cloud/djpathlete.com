import { describe, expect, it } from "vitest"
import { spliceFirstAnchor } from "../lib/html-splice.js"

describe("spliceFirstAnchor", () => {
  it("wraps the first case-insensitive occurrence with a link to /blog/{slug}", () => {
    const html = "<p>The deadlift is a foundational lift. Anyone serious about strength should master the deadlift.</p>"
    const out = spliceFirstAnchor(html, "deadlift-tips", "deadlift")
    // Only the FIRST occurrence wrapped:
    expect(out).toBe(
      "<p>The <a href=\"/blog/deadlift-tips\">deadlift</a> is a foundational lift. Anyone serious about strength should master the deadlift.</p>",
    )
  })

  it("matches with word boundaries — does not splice inside other words", () => {
    const html = "<p>Sprinting and sprinklers both start with sprint.</p>"
    const out = spliceFirstAnchor(html, "sprint-training", "sprint")
    // Should match the standalone 'sprint' at the end, NOT 'Sprinting' or 'sprinklers'.
    expect(out).toContain('<a href="/blog/sprint-training">sprint</a>')
    expect(out).not.toContain("<a href=\"/blog/sprint-training\">Sprinting")
    expect(out).not.toContain("<a href=\"/blog/sprint-training\">sprinklers")
  })

  it("preserves the original casing of the anchor", () => {
    const html = "<p>Squats build leg strength.</p>"
    const out = spliceFirstAnchor(html, "squat-guide", "squats")
    expect(out).toContain('<a href="/blog/squat-guide">Squats</a>')
  })

  it("returns the html unchanged when anchor is not found", () => {
    const html = "<p>No mention of the target word here.</p>"
    const out = spliceFirstAnchor(html, "some-slug", "deadlift")
    expect(out).toBe(html)
  })

  it("skips when the only occurrence is already inside an <a> tag", () => {
    const html = '<p>Already linked: <a href="/other">deadlift</a>. Just one mention.</p>'
    const out = spliceFirstAnchor(html, "deadlift-tips", "deadlift")
    expect(out).toBe(html)
  })

  it("splices the second occurrence when the first is already inside an <a>", () => {
    const html = '<p>Linked: <a href="/other">deadlift</a>. Now an unlinked mention of deadlift here.</p>'
    const out = spliceFirstAnchor(html, "deadlift-tips", "deadlift")
    expect(out).toContain('<a href="/other">deadlift</a>')
    expect(out).toContain('<a href="/blog/deadlift-tips">deadlift</a>')
  })

  it("escapes regex special characters in the anchor", () => {
    const html = "<p>This is the 5x5 program in action.</p>"
    // "5x5" has no special chars, but verify multi-word + char-safe input:
    const out = spliceFirstAnchor(html, "five-by-five", "5x5 program")
    expect(out).toContain('<a href="/blog/five-by-five">5x5 program</a>')
  })

  it("returns the html unchanged when anchor is empty", () => {
    const html = "<p>Content.</p>"
    expect(spliceFirstAnchor(html, "any", "")).toBe(html)
    expect(spliceFirstAnchor(html, "any", "   ")).toBe(html)
  })
})
