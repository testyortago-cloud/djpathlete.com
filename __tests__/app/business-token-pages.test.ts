// @vitest-environment node
// G49: the two pages a coach's contact reaches from a link in that coach's
// email — unsubscribe, and "can we text you?" — must not be the platform's
// site. They lived under app/(marketing), whose layout is the platform's
// navbar, footer and "Apply" bar. They now live in their own route group.
// The URLs do not change: a route group is not a path segment.
import { describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"

const PAGES = ["app/(business)/unsubscribe/[token]/page.tsx", "app/(business)/sms-consent/[token]/page.tsx"]

describe("the business's own token pages", () => {
  it("live in the (business) route group, and no longer under (marketing)", () => {
    for (const page of PAGES) expect(existsSync(page), page).toBe(true)
    expect(existsSync("app/(marketing)/unsubscribe/[token]")).toBe(false)
    expect(existsSync("app/(marketing)/sms-consent")).toBe(false)
  })

  it("leave the newsletter's own no-token /unsubscribe page where it is (one platform list, G38)", () => {
    expect(existsSync("app/(marketing)/unsubscribe/page.tsx")).toBe(true)
  })

  it("have a layout that brings in none of the platform's site chrome", () => {
    const layout = readFileSync("app/(business)/layout.tsx", "utf8")
    for (const chrome of ["SiteNavbar", "Footer", "StickyApplyCTA"]) expect(layout).not.toContain(chrome)
  })

  it("frame each page with the token's business", () => {
    for (const page of PAGES) {
      const source = readFileSync(page, "utf8")
      expect(source, page).toContain("<BusinessFrame")
      expect(source, page).toContain("loadBusinessPageIdentity(")
    }
  })

  it("drop the platform's title suffix and share tags, and keep the pages out of search", async () => {
    const { metadata } = await import("@/app/(business)/layout")
    // `absolute`, not `default`: a layout's own title still goes through its
    // parent's template, which would append the platform's name (seen live).
    expect(metadata.title).toEqual({ absolute: "Message settings", template: "%s" })
    expect(metadata.description).toBeNull()
    expect(metadata.openGraph).toBeNull()
    expect(metadata.twitter).toBeNull()
    expect(metadata.manifest).toBeNull()
    expect(metadata.icons).toBeNull()
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })

  it("answer a bad link inside the group, with no way back to the platform's site", async () => {
    // Both pages call notFound() for a bad token. Without a not-found here, that
    // fell through to app/not-found.tsx and its "Back to home".
    const source = readFileSync("app/(business)/not-found.tsx", "utf8")
    expect(source).not.toMatch(/href=|homeHref|<Link|SiteNavbar|Footer/)
    const { renderToStaticMarkup } = await import("react-dom/server")
    const { default: NotFound } = await import("@/app/(business)/not-found")
    const html = renderToStaticMarkup(NotFound())
    expect(html).toContain("This link does not work")
    expect(html).not.toContain("<a ")
  })
})
