// @vitest-environment node
//
// __tests__/app/admin/blog-newsletter-editor-guard.test.tsx
//
// The four screens a teammate holding `blog` opens to WRITE something:
// blog/new, blog/[id]/edit, newsletter/new, newsletter/[id]/edit.
//
// Until 2026-09-25 all four called `requireAdmin()`. The proxy let a staff
// member holding `blog` through (`/admin/blog` and `/admin/newsletter` both map
// to it), the list pages rendered, and then clicking a post or a newsletter
// hit `requireAdmin()`, which redirects anyone who is not the owner to
// `homeForRole()` — for someone whose first permission is `blog`, that is
// `/admin/blog`. So the click landed them back on the list they had just left.
// The owner's social-media teammate reported it as "I get kicked out when I
// click a post to edit it".
//
// NO RENDER. Each page is an async server component; this calls it directly and
// inspects what the mocked guard was called with, the same shape as
// __tests__/app/admin/sms-list-page-tenancy.test.tsx. The forms are mocked to
// no-ops so a node-environment suite does not pull in TipTap.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/permissions/guard", () => ({ requirePermission: vi.fn() }))
vi.mock("@/lib/auth-helpers", () => ({ requireAdmin: vi.fn() }))
vi.mock("@/lib/db/blog-posts", () => ({ getBlogPostById: vi.fn() }))
vi.mock("@/lib/db/newsletters", () => ({ getNewsletterById: vi.fn() }))
vi.mock("@/components/admin/blog/BlogPostForm", () => ({ BlogPostForm: () => null }))
vi.mock("@/components/admin/blog/BlogPostImageWatcher", () => ({ BlogPostImageWatcher: () => null }))
vi.mock("@/components/admin/newsletter/NewsletterForm", () => ({ NewsletterForm: () => null }))

import { requirePermission } from "@/lib/permissions/guard"
import { requireAdmin } from "@/lib/auth-helpers"
import { getBlogPostById } from "@/lib/db/blog-posts"
import { getNewsletterById } from "@/lib/db/newsletters"
import NewBlogPostPage from "@/app/(admin)/admin/blog/new/page"
import EditBlogPostPage from "@/app/(admin)/admin/blog/[id]/edit/page"
import NewNewsletterPage from "@/app/(admin)/admin/newsletter/new/page"
import EditNewsletterPage from "@/app/(admin)/admin/newsletter/[id]/edit/page"

const STAFF_SESSION = { user: { id: "staff-1", role: "staff", permissions: { blog: true } } }

beforeEach(() => {
  vi.clearAllMocks()
  ;(requirePermission as ReturnType<typeof vi.fn>).mockResolvedValue(STAFF_SESSION)
  // If a page still calls requireAdmin, make it behave as it does for staff in
  // production: it never returns (redirect throws in Next).
  ;(requireAdmin as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("NEXT_REDIRECT /admin/blog"))
  ;(getBlogPostById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "post-1", cover_image_url: null })
  ;(getNewsletterById as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "nl-1",
    status: "draft",
    author_id: "owner-1",
  })
})

const PAGES = [
  ["blog/new", () => NewBlogPostPage({ searchParams: Promise.resolve({}) })],
  ["blog/[id]/edit", () => EditBlogPostPage({ params: Promise.resolve({ id: "post-1" }) })],
  ["newsletter/new", () => NewNewsletterPage()],
  ["newsletter/[id]/edit", () => EditNewsletterPage({ params: Promise.resolve({ id: "nl-1" }) })],
] as const

describe("blog and newsletter editors admit a teammate holding `blog`", () => {
  it.each(PAGES)("%s guards on `blog`", async (_name, render) => {
    // MUTANT: requirePermission("social") — the neighbouring marketing grant.
    // The newsletter lives under "Blog & Newsletter" on the invite screen.
    await render()
    expect(requirePermission).toHaveBeenCalledWith("blog")
  })

  it.each(PAGES)("%s renders for staff instead of bouncing them", async (_name, render) => {
    // MUTANT: keep `await requireAdmin()` — the page rejects with the redirect.
    await expect(render()).resolves.toBeTruthy()
    expect(requireAdmin).not.toHaveBeenCalled()
  })

  it("still refuses someone without `blog`: the guard's redirect propagates", async () => {
    // Control for the test above: a resolving page is only meaningful if a
    // refusing guard can still stop it.
    ;(requirePermission as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("NEXT_REDIRECT /admin/no-access"))
    for (const [, render] of PAGES) {
      await expect(render()).rejects.toThrow("NEXT_REDIRECT")
    }
  })
})
