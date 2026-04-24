// @vitest-environment node
// The renderer calls into @vercel/og (Node entry), which picks up the
// transitively-installed `sharp` for SVG->PNG conversion. Sharp's typed-array
// detection uses `val.constructor === Uint8Array`, which fails under jsdom
// (cross-realm Uint8Array) — use the Node environment so TextEncoder returns
// a native Uint8Array that sharp accepts.
import { describe, it, expect } from "vitest"
import { renderQuoteCard } from "@/lib/content-studio/quote-card-renderer"

describe("renderQuoteCard", () => {
  it("returns a non-empty Buffer with PNG magic bytes", async () => {
    const buffer = await renderQuoteCard("Strength is a habit, not a mood.")
    expect(buffer).toBeInstanceOf(Buffer)
    expect(buffer.length).toBeGreaterThan(1000) // sanity: any real PNG is larger than this
    // PNG magic: 0x89 0x50 0x4E 0x47
    expect(buffer[0]).toBe(0x89)
    expect(buffer[1]).toBe(0x50)
    expect(buffer[2]).toBe(0x4e)
    expect(buffer[3]).toBe(0x47)
  })

  it("handles short text without throwing", async () => {
    const buffer = await renderQuoteCard("Train.")
    expect(buffer.length).toBeGreaterThan(1000)
  })

  it("handles long text near the 140-char limit without throwing", async () => {
    const text = "a".repeat(140)
    const buffer = await renderQuoteCard(text)
    expect(buffer.length).toBeGreaterThan(1000)
  })
})
