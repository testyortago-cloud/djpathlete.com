import { describe, it, expect } from "vitest"
import {
  buildShareLink,
  htmlToText,
  DEFAULT_SHARE_IMAGE_PATH,
  NEWSLETTER_CARD_DESCRIPTION,
  type ShareTopic,
} from "../social-share-link.js"

const SITE = "https://www.darrenjpaul.com"
const blog = (o: Partial<ShareTopic> = {}): ShareTopic => ({
  kind: "blog",
  id: "b1",
  title: "ACL return",
  slug: "acl-return",
  excerpt: "What the research says.",
  content: "<p>x</p>",
  cover_image_url: "https://cdn.example.com/c.jpg",
  ...o,
})

describe("buildShareLink", () => {
  it("points a blog card at the article, with its title, excerpt and cover", () => {
    expect(buildShareLink(blog(), SITE)).toEqual({
      source_blog_post_id: "b1",
      source_newsletter_id: null,
      link_url: `${SITE}/blog/acl-return`,
      link_title: "ACL return",
      link_description: "What the research says.",
      link_image_url: "https://cdn.example.com/c.jpg",
    })
  })

  it("falls back to the site share image when the cover is missing or not https", () => {
    expect(buildShareLink(blog({ cover_image_url: null }), SITE).link_image_url).toBe(
      `${SITE}${DEFAULT_SHARE_IMAGE_PATH}`,
    )
    expect(buildShareLink(blog({ cover_image_url: "http://insecure/c.jpg" }), SITE).link_image_url).toBe(
      `${SITE}${DEFAULT_SHARE_IMAGE_PATH}`,
    )
  })

  it("cuts a long excerpt to 200 characters with an ellipsis, and keeps a null one null", () => {
    const d = buildShareLink(blog({ excerpt: "a".repeat(250) }), SITE).link_description!
    expect(d.length).toBe(200)
    expect(d.endsWith("…")).toBe(true)
    expect(buildShareLink(blog({ excerpt: null }), SITE).link_description).toBeNull()
  })

  it("points a newsletter card at the sign-up section with the default image", () => {
    expect(
      buildShareLink(
        { ...blog(), kind: "newsletter", id: "n1", title: "Issue 12", slug: "", cover_image_url: null },
        SITE,
      ),
    ).toEqual({
      source_blog_post_id: null,
      source_newsletter_id: "n1",
      link_url: `${SITE}/#newsletter`,
      link_title: "Issue 12",
      link_description: NEWSLETTER_CARD_DESCRIPTION,
      link_image_url: `${SITE}${DEFAULT_SHARE_IMAGE_PATH}`,
    })
  })

  it("still records the source but no card for a job from older code (no siteUrl)", () => {
    expect(buildShareLink(blog(), undefined)).toEqual({
      source_blog_post_id: "b1",
      source_newsletter_id: null,
      link_url: null,
      link_title: null,
      link_description: null,
      link_image_url: null,
    })
  })

  it("strips a trailing slash from siteUrl", () => {
    expect(buildShareLink(blog(), `${SITE}/`).link_url).toBe(`${SITE}/blog/acl-return`)
  })
})

describe("htmlToText", () => {
  it("drops tags and decodes the entities a newsletter body carries", () => {
    expect(htmlToText("<h2>Deload&nbsp;weeks</h2><p>Rest &amp; recover. It&#39;s &quot;normal&quot;.</p>")).toBe(
      'Deload weeks\nRest & recover. It\'s "normal".',
    )
  })
  it("removes style and script blocks entirely", () => {
    expect(htmlToText("<style>p{color:red}</style><p>Hi</p><script>x()</script>")).toBe("Hi")
  })
})
