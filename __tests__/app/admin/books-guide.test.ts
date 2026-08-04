import { describe, it, expect } from "vitest"
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

// The guide is prose + screenshots, so the failure mode is silent rot: an image
// renamed or deleted leaves a broken <Image> that only shows up by eye. These
// assertions tie the page and public/guide/books/ together.
const ROOT = process.cwd()
const PAGE = join(ROOT, "app/(admin)/admin/books/guide/page.tsx")
const SHOT_DIR = join(ROOT, "public/guide/books")

const source = readFileSync(PAGE, "utf8")

/** Every `<Shot name="x" />` in the page. */
function referencedShots(): string[] {
  return [...source.matchAll(/<Shot\s+name="([^"]+)"/g)].map((m) => m[1])
}

/** Every key of the SHOTS dimension map. */
function declaredShots(): string[] {
  const block = source.slice(source.indexOf("const SHOTS = {"), source.indexOf("} as const"))
  return [...block.matchAll(/^\s*"?([a-z-]+)"?:\s*\{/gm)].map((m) => m[1])
}

/** name -> declared {w,h} from the SHOTS map. */
function declaredDimensions(): Record<string, { w: number; h: number }> {
  const block = source.slice(source.indexOf("const SHOTS = {"), source.indexOf("} as const"))
  const out: Record<string, { w: number; h: number }> = {}
  for (const m of block.matchAll(/^\s*"?([a-z-]+)"?:\s*\{\s*w:\s*(\d+),\s*h:\s*(\d+)/gm)) {
    out[m[1]] = { w: Number(m[2]), h: Number(m[3]) }
  }
  return out
}

/** PNG IHDR: width at byte 16, height at byte 20, both big-endian uint32. */
function pngSize(file: string): { w: number; h: number } {
  const buf = readFileSync(file)
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

describe("Accounting how-to guide", () => {
  it("every screenshot it renders exists on disk", () => {
    const missing = referencedShots().filter((n) => !existsSync(join(SHOT_DIR, `${n}.png`)))
    expect(missing).toEqual([])
  })

  it("every screenshot it renders has declared dimensions", () => {
    const declared = new Set(declaredShots())
    const undeclared = referencedShots().filter((n) => !declared.has(n))
    // Missing dimensions means next/image cannot reserve space — the page
    // jumps as each screenshot loads.
    expect(undeclared).toEqual([])
  })

  it("declared dimensions match the actual PNGs", () => {
    // next/image reserves space from these numbers. Re-capturing a screenshot
    // at a different size without updating the map makes the page jump and
    // the image render stretched — invisible until someone looks.
    const wrong = Object.entries(declaredDimensions())
      .map(([name, d]) => ({ name, declared: d, actual: pngSize(join(SHOT_DIR, `${name}.png`)) }))
      .filter((x) => x.declared.w !== x.actual.w || x.declared.h !== x.actual.h)
    expect(wrong).toEqual([])
  })

  it("ships no orphan screenshots", () => {
    const used = new Set(referencedShots())
    const onDisk = readdirSync(SHOT_DIR).filter((f) => f.endsWith(".png")).map((f) => f.replace(/\.png$/, ""))
    expect(onDisk.filter((f) => !used.has(f))).toEqual([])
  })

  it("covers every area of Accounting the owner asked for", () => {
    // Named explicitly so deleting a section fails here rather than being
    // noticed months later by someone looking for the missing instructions.
    const required = [
      "books", // the three books, incl. Spouse
      "tax",
      "setup",
      "add-entry",
      "import-platform",
      "import-statement",
      "cash-receipt",
      "upload-receipt",
      "import-amazon",
      "email-receipts",
      "duplicates",
      "ledger",
      "close",
      "reports",
      "insights",
      "assets",
      "categories",
    ]
    const sectionIds = [...source.matchAll(/<Section\s+id="([^"]+)"/g)].map((m) => m[1])
    expect(required.filter((id) => !sectionIds.includes(id))).toEqual([])
  })

  it("lists every section in the on-this-page nav", () => {
    const sectionIds = [...source.matchAll(/<Section\s+id="([^"]+)"/g)].map((m) => m[1])
    const navBlock = source.slice(source.indexOf("const SECTIONS"), source.indexOf("function Shot"))
    const navIds = [...navBlock.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1])
    expect(sectionIds.filter((id) => !navIds.includes(id))).toEqual([])
  })

  it("has an FAQ with real answers and a sticky contents list", () => {
    const faqBlock = source.slice(source.indexOf("const FAQ"), source.indexOf("function Shot"))
    const questions = [...faqBlock.matchAll(/^\s*q:\s*["“]/gm)].length
    expect(questions).toBeGreaterThanOrEqual(8)
    expect(source).toContain('<Section id="faq"')
    // lg:sticky is what stops the reader scrolling back to the top to navigate.
    expect(source).toMatch(/lg:sticky/)
  })

  it("is admin-gated", () => {
    expect(source).toMatch(/session\?\.user\?\.role\s*!==\s*"admin"/)
    expect(source).toContain("redirect(")
  })
})
