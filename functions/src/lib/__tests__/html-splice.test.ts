import { describe, it, expect } from "vitest"
import { spliceInlineImages, findQualifyingSections, MIN_SECTION_WORDS, injectAnchorIds, extractH2Toc, spliceInternalLinks } from "../html-splice.js"

describe("findQualifyingSections", () => {
  it("returns h2 sections whose following text is at least 150 words", () => {
    const longPara = `<p>${"word ".repeat(160)}</p>`
    const shortPara = `<p>${"word ".repeat(50)}</p>`
    const html = [
      "<p>intro paragraph</p>",
      "<h2>Section A</h2>",
      longPara,
      "<h2>Section B</h2>",
      shortPara,
      "<h2>Section C</h2>",
      longPara,
    ].join("")

    const sections = findQualifyingSections(html)
    expect(sections).toHaveLength(2)
    expect(sections[0].h2Text).toBe("Section A")
    expect(sections[1].h2Text).toBe("Section C")
    expect(MIN_SECTION_WORDS).toBe(150)
  })

  it("returns empty array when no h2s qualify", () => {
    const html = "<p>short</p><h2>tiny</h2><p>only ten words here in this short test paragraph</p>"
    expect(findQualifyingSections(html)).toEqual([])
  })

  it("caps results at 3 sections", () => {
    const longPara = `<p>${"word ".repeat(160)}</p>`
    const html = ["A", "B", "C", "D", "E"].map((s) => `<h2>${s}</h2>${longPara}`).join("")
    const sections = findQualifyingSections(html)
    expect(sections).toHaveLength(3)
    expect(sections.map((s) => s.h2Text)).toEqual(["A", "B", "C"])
  })
})

describe("spliceInlineImages", () => {
  it("inserts <img> immediately after the qualifying h2", () => {
    const longPara = `<p>${"word ".repeat(160)}</p>`
    const html = `<p>intro</p><h2>Section A</h2>${longPara}`
    const out = spliceInlineImages(html, [
      {
        h2Text: "Section A",
        url: "https://supa.example/a.webp",
        alt: "Athlete training",
        width: 1024,
        height: 576,
      },
    ])
    expect(out).toContain('<h2>Section A</h2><img src="https://supa.example/a.webp" alt="Athlete training" loading="lazy" width="1024" height="576">')
  })

  it("is idempotent: running splice twice with same image does not double-insert", () => {
    const longPara = `<p>${"word ".repeat(160)}</p>`
    const html = `<h2>Section A</h2>${longPara}`
    const image = {
      h2Text: "Section A",
      url: "https://supa.example/a.webp",
      alt: "x",
      width: 1024,
      height: 576,
    }
    const once = spliceInlineImages(html, [image])
    const twice = spliceInlineImages(once, [image])
    const matches = twice.match(/https:\/\/supa\.example\/a\.webp/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it("ignores images whose h2Text doesn't appear", () => {
    const longPara = `<p>${"word ".repeat(160)}</p>`
    const html = `<h2>Section A</h2>${longPara}`
    const out = spliceInlineImages(html, [
      { h2Text: "Section Z", url: "x", alt: "x", width: 1024, height: 576 },
    ])
    expect(out).toBe(html)
  })

  it("html-encodes alt text to prevent XSS", () => {
    const longPara = `<p>${"word ".repeat(160)}</p>`
    const html = `<h2>Section A</h2>${longPara}`
    const out = spliceInlineImages(html, [
      {
        h2Text: "Section A",
        url: "https://x.example/a.webp",
        alt: 'evil"<script>',
        width: 1024,
        height: 576,
      },
    ])
    expect(out).toContain('alt="evil&quot;&lt;script&gt;"')
    expect(out).not.toContain('alt="evil"<script>"')
  })
})

describe("injectAnchorIds", () => {
  it("adds id attributes to h2s based on slugified text", () => {
    const html = "<h2>Why Sleep Matters</h2><p>x</p><h2>How to Improve It</h2>"
    const out = injectAnchorIds(html)
    expect(out).toContain('<h2 id="why-sleep-matters">Why Sleep Matters</h2>')
    expect(out).toContain('<h2 id="how-to-improve-it">How to Improve It</h2>')
  })

  it("preserves existing attributes on h2", () => {
    const html = '<h2 class="foo">Section</h2>'
    const out = injectAnchorIds(html)
    expect(out).toContain('id="section"')
    expect(out).toContain('class="foo"')
  })

  it("does not duplicate id when one already exists", () => {
    const html = '<h2 id="custom-id">Section</h2>'
    const out = injectAnchorIds(html)
    expect(out).toBe(html)
  })

  it("strips inline tags from heading text when slugifying", () => {
    const html = "<h2>The <em>real</em> answer</h2>"
    const out = injectAnchorIds(html)
    expect(out).toContain('id="the-real-answer"')
  })

  it("dedupes ids across multiple h2s with the same heading", () => {
    const html = "<h2>FAQ</h2><p>x</p><h2>FAQ</h2>"
    const out = injectAnchorIds(html)
    expect(out).toContain('id="faq"')
    expect(out).toContain('id="faq-2"')
  })

  it("leaves h3 and other tags untouched", () => {
    const html = "<h2>A</h2><h3>B</h3>"
    const out = injectAnchorIds(html)
    expect(out).toContain('<h2 id="a">A</h2>')
    expect(out).toContain("<h3>B</h3>")
  })
})

describe("extractH2Toc", () => {
  it("returns id+text pairs in document order", () => {
    const html = '<h2 id="one">First</h2><p>x</p><h2 id="two">Second</h2>'
    expect(extractH2Toc(html)).toEqual([
      { id: "one", text: "First" },
      { id: "two", text: "Second" },
    ])
  })

  it("skips h2s without ids", () => {
    const html = '<h2 id="one">First</h2><h2>NoId</h2>'
    expect(extractH2Toc(html)).toEqual([{ id: "one", text: "First" }])
  })

  it("strips inline tags from text", () => {
    const html = '<h2 id="x">Why <strong>this</strong> works</h2>'
    expect(extractH2Toc(html)).toEqual([{ id: "x", text: "Why this works" }])
  })

  it("returns empty array when no h2s exist", () => {
    expect(extractH2Toc("<p>just paragraphs</p>")).toEqual([])
  })
})

describe("spliceInternalLinks", () => {
  it("wraps the first occurrence of anchor_text inside the named section in an <a>", () => {
    const html = '<h2 id="recovery">Recovery basics</h2><p>You need rest days for recovery.</p><h2 id="loading">Progressive loading</h2><p>Add weight gradually.</p>'
    const out = spliceInternalLinks(html, [
      { slug: "comeback-code", anchor_text: "rest days", section_h2: "Recovery basics" },
    ])
    expect(out).toContain('<a href="/blog/comeback-code">rest days</a>')
    expect(out).toContain('<h2 id="recovery">Recovery basics</h2>')
  })

  it("only wraps the FIRST occurrence in the section", () => {
    const html = '<h2>Recovery</h2><p>rest days are good. Take more rest days.</p>'
    const out = spliceInternalLinks(html, [
      { slug: "x", anchor_text: "rest days", section_h2: "Recovery" },
    ])
    const matches = out.match(/<a href="\/blog\/x">/g)
    expect(matches?.length).toBe(1)
  })

  it("matches case-insensitively but preserves original casing in the link text", () => {
    const html = "<h2>Section</h2><p>Use Progressive Overload daily.</p>"
    const out = spliceInternalLinks(html, [
      { slug: "x", anchor_text: "progressive overload", section_h2: "Section" },
    ])
    expect(out).toContain('<a href="/blog/x">Progressive Overload</a>')
  })

  it("skips silently when anchor_text is not found in the section", () => {
    const html = "<h2>Section</h2><p>nothing matches.</p>"
    const out = spliceInternalLinks(html, [
      { slug: "x", anchor_text: "missing phrase", section_h2: "Section" },
    ])
    expect(out).toBe(html)
  })

  it("skips silently when section_h2 is not found", () => {
    const html = "<h2>Other</h2><p>rest days here.</p>"
    const out = spliceInternalLinks(html, [
      { slug: "x", anchor_text: "rest days", section_h2: "Recovery basics" },
    ])
    expect(out).toBe(html)
  })

  it("does not nest links — skips when anchor_text is already inside an <a>", () => {
    const html = '<h2>Section</h2><p>Read about <a href="/external">rest days</a>.</p>'
    const out = spliceInternalLinks(html, [
      { slug: "x", anchor_text: "rest days", section_h2: "Section" },
    ])
    expect(out).toBe(html)
  })

  it("respects word boundaries — does not match inside larger words", () => {
    const html = "<h2>Section</h2><p>Trains hard but rest days work.</p>"
    const out = spliceInternalLinks(html, [
      { slug: "x", anchor_text: "rest", section_h2: "Section" },
    ])
    expect(out).toContain('<a href="/blog/x">rest</a>')
    expect(out).not.toContain('<a href="/blog/x">est</a>')
  })

  it("caps at 3 inserts even when more are provided", () => {
    const html = `<h2>A</h2><p>alpha here</p><h2>B</h2><p>beta here</p><h2>C</h2><p>gamma here</p><h2>D</h2><p>delta here</p>`
    const out = spliceInternalLinks(html, [
      { slug: "a", anchor_text: "alpha", section_h2: "A" },
      { slug: "b", anchor_text: "beta", section_h2: "B" },
      { slug: "c", anchor_text: "gamma", section_h2: "C" },
      { slug: "d", anchor_text: "delta", section_h2: "D" },
    ])
    const matches = out.match(/<a href="\/blog\//g)
    expect(matches?.length).toBe(3)
    expect(out).not.toContain('href="/blog/d"')
  })

  it("handles empty inserts list", () => {
    const html = "<h2>Section</h2><p>x</p>"
    expect(spliceInternalLinks(html, [])).toBe(html)
  })

  it("handles section text with inline tags by stripping them for matching", () => {
    const html = '<h2 id="x">Recovery <em>basics</em></h2><p>Get rest days.</p>'
    const out = spliceInternalLinks(html, [
      { slug: "y", anchor_text: "rest days", section_h2: "Recovery basics" },
    ])
    expect(out).toContain('<a href="/blog/y">rest days</a>')
  })
})
