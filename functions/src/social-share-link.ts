// functions/src/social-share-link.ts
// Pure helpers for Share to LinkedIn: what a draft's link card points at, and
// newsletter HTML → text for the copywriter. functions/ cannot import lib/, and
// nothing in lib/ needs these, so there is no twin.

// These two are the platform tenant's (DJP's) own copy and image, not platform
// text: they sit inside the platform seam the social agent already runs in
// (lib/tenancy/platform.ts), because social_posts has no business_id yet. They
// are tenant-owned, and move to per-tenant settings when social becomes
// per-tenant; do not treat them as defaults every coach should inherit.
export const DEFAULT_SHARE_IMAGE_PATH = "/images/gym-training-01.jpg"
export const NEWSLETTER_CARD_DESCRIPTION = "Free newsletter from Darren Paul. Sign up to get the next issue."
const MAX_DESCRIPTION = 200

export interface ShareTopic {
  kind: "blog" | "newsletter"
  id: string
  title: string
  slug: string
  excerpt: string | null
  content: string | null
  cover_image_url: string | null
}

export interface ShareLinkFields {
  source_blog_post_id: string | null
  source_newsletter_id: string | null
  link_url: string | null
  link_title: string | null
  link_description: string | null
  link_image_url: string | null
}

function clip(text: string | null): string | null {
  if (!text) return null
  const t = text.trim()
  return t.length <= MAX_DESCRIPTION ? t : `${t.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…`
}

export function buildShareLink(topic: ShareTopic, siteUrl: string | undefined): ShareLinkFields {
  const source = {
    source_blog_post_id: topic.kind === "blog" ? topic.id : null,
    source_newsletter_id: topic.kind === "newsletter" ? topic.id : null,
  }
  // A job enqueued by code older than this feature carries no siteUrl: record
  // where the draft came from, but write no card rather than guess an origin.
  if (!siteUrl) {
    return { ...source, link_url: null, link_title: null, link_description: null, link_image_url: null }
  }
  const base = siteUrl.replace(/\/+$/, "")
  const fallbackImage = `${base}${DEFAULT_SHARE_IMAGE_PATH}`
  if (topic.kind === "newsletter") {
    return {
      ...source,
      link_url: `${base}/#newsletter`,
      link_title: topic.title,
      link_description: NEWSLETTER_CARD_DESCRIPTION,
      link_image_url: fallbackImage,
    }
  }
  return {
    ...source,
    link_url: `${base}/blog/${topic.slug}`,
    link_title: topic.title,
    link_description: clip(topic.excerpt),
    link_image_url: topic.cover_image_url?.startsWith("https://") ? topic.cover_image_url : fallbackImage,
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " }

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|h[1-6]|li|div|tr)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#39|[a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
}
