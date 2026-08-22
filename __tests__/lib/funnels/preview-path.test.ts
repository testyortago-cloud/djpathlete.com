// __tests__/lib/funnels/preview-path.test.ts
//
// The preview walks the funnel by REWRITING the base path, so these two
// functions are the whole of "step to step works". Each test names the mutant
// it kills.

import { describe, expect, it } from "vitest"
import { LIVE_BASE, PREVIEW_BASE, livePathToPreview, previewBasePath } from "@/lib/funnels/preview-path"

describe("previewBasePath", () => {
  it("builds the base a step CTA is appended to", () => {
    // MUTANT KILLED: returning `/go/${slug}` — the preview would link to the
    // live route and 404 on every unpublished next step.
    expect(previewBasePath("summer-camp")).toBe("/preview/summer-camp")
  })

  it("encodes a slug so it cannot break out of its segment", () => {
    // MUTANT KILLED: raw interpolation. A slug is owner input; `a/b` would
    // otherwise silently become a two-segment path.
    expect(previewBasePath("a/b")).toBe("/preview/a%2Fb")
  })
})

describe("livePathToPreview", () => {
  it("rewrites an internal funnel URL onto the preview base", () => {
    // MUTANT KILLED: returning the input unchanged — the form would redirect
    // out of the preview onto a 404.
    expect(livePathToPreview("/go/summer-camp/thanks")).toBe("/preview/summer-camp/thanks")
  })

  it("rewrites an entry-page URL with no step segment", () => {
    expect(livePathToPreview("/go/summer-camp")).toBe("/preview/summer-camp")
  })

  it("rewrites across funnels, because /preview resolves any slug", () => {
    expect(livePathToPreview("/go/other-funnel/x")).toBe("/preview/other-funnel/x")
  })

  it("returns null for an external URL", () => {
    // MUTANT KILLED: prefixing anything. An https target must be REPORTED, not
    // navigated, so the caller needs to tell the two apart.
    expect(livePathToPreview("https://example.com/thanks")).toBeNull()
  })

  it("returns null for an internal URL that is not a funnel page", () => {
    expect(livePathToPreview("/admin/funnels")).toBeNull()
  })

  it("returns null for a protocol-relative URL that only looks internal", () => {
    // MUTANT KILLED: a `startsWith("/")` check. `//evil.com/go/x` starts with
    // a slash and is an absolute cross-origin navigation.
    expect(livePathToPreview("//evil.com/go/x")).toBeNull()
  })

  it("does not rewrite a path that merely starts with the letters go", () => {
    // MUTANT KILLED: `startsWith("/go")` without the boundary.
    expect(livePathToPreview("/golf/summer-camp")).toBeNull()
  })

  it("exports the two bases it is built from", () => {
    expect(PREVIEW_BASE).toBe("/preview")
    expect(LIVE_BASE).toBe("/go")
  })
})
