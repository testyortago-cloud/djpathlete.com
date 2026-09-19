// @vitest-environment node
//
// __tests__/app/funnel-internal-links.test.ts
//
// The quiz was an ORPHAN: in the sitemap, allowed by robots.txt, and with not
// one link to it from anywhere on the marketing site. A sitemap entry makes a
// page discoverable; a link is what passes it any authority.
//
// This is a SOURCE-TEXT test and that is a weak instrument — it proves the
// href is written, not that it renders. It is here because the alternative is
// nothing: both pages are heavy server components whose imports reach the
// database, and a render test for them would be testing the page, not the
// link. The links were also verified in a browser against the built site; this
// exists to stop a future edit quietly removing the only two.
//
// Text assertions must exclude prose — grepping a file for a path also matches
// the comment explaining it — so each check strips comments first.

import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/** Source with // and block comments removed, so a mention in prose cannot pass. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
}

const PAGES = [
  { name: "/assessment", path: "app/(marketing)/assessment/page.tsx" },
  { name: "/athletes", path: "app/(marketing)/athletes/page.tsx" },
]

describe("the quiz is linked from the marketing site", () => {
  for (const page of PAGES) {
    it(`${page.name} links to /go/athlete-quiz`, () => {
      expect(code(page.path)).toContain('href="/go/athlete-quiz"')
    })

    it(`${page.name} uses descriptive anchor text, not "click here"`, () => {
      // The anchor is the strongest on-page signal about the destination.
      // "Athlete Performance Index" is what the page is called; "here" is not.
      const source = code(page.path)
      expect(source).toContain("Athlete Performance Index")
      expect(source).not.toMatch(/>\s*(click here|here|read more)\s*</i)
    })
  }

  it("the comment-stripper actually strips — the control", () => {
    // Without this, every assertion above would also pass on a file that only
    // MENTIONS /go/athlete-quiz in a comment. Proves the instrument works
    // before trusting what it reports.
    const sample = `// href="/go/athlete-quiz"\n/* href="/go/athlete-quiz" */\nconst x = 1`
    const stripped = sample.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    expect(stripped).not.toContain("/go/athlete-quiz")
  })
})
