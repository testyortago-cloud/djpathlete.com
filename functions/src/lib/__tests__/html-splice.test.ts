import { describe, it, expect } from "vitest"
import { spliceInlineImages, findQualifyingSections, MIN_SECTION_WORDS } from "../html-splice.js"

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
