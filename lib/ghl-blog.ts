/**
 * GoHighLevel Blog API Client
 *
 * Fetches blog posts from GHL's Blog API v2. Falls back to static
 * blog-data.ts when GHL is not configured or the request fails.
 */

import { posts as staticPosts, type Post, type Category } from "@/lib/blog-data"

const GHL_BASE_URL = "https://services.leadconnectorhq.com"
const GHL_API_KEY = process.env.GHL_API_KEY ?? ""
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID ?? ""
const GHL_BLOG_ID = process.env.GHL_BLOG_ID ?? ""

// ---------------------------------------------------------------------------
// GHL response types (based on GHL Blog API v2)
// ---------------------------------------------------------------------------

interface GHLBlogPost {
  _id: string
  title: string
  slug: string
  description?: string
  body?: string
  rawHTML?: string
  imageUrl?: string
  imageAltText?: string
  author?: {
    name?: string
    url?: string
  }
  categories?: string[]
  tags?: string[]
  status?: "draft" | "published" | "archived"
  publishedAt?: string
  createdAt?: string
  updatedAt?: string
  blogId?: string
  locationId?: string
  [key: string]: unknown
}

interface GHLBlogResponse {
  posts?: GHLBlogPost[]
  blogs?: GHLBlogPost[]
  data?: GHLBlogPost[]
  total?: number
  count?: number
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Configuration check
// ---------------------------------------------------------------------------

function isGHLBlogConfigured(): boolean {
  return GHL_API_KEY.length > 0 && GHL_LOCATION_ID.length > 0 && GHL_BLOG_ID.length > 0
}

// ---------------------------------------------------------------------------
// Category mapping
// ---------------------------------------------------------------------------

const VALID_CATEGORIES: Category[] = ["Performance", "Recovery", "Coaching", "Youth Development"]

function mapCategory(categories?: string[]): Category {
  if (!categories || categories.length === 0) return "Performance"

  for (const cat of categories) {
    const match = VALID_CATEGORIES.find((c) => c.toLowerCase() === cat.toLowerCase())
    if (match) return match
  }

  return "Performance"
}

// ---------------------------------------------------------------------------
// HTML to plain-text sections parser
// ---------------------------------------------------------------------------

/**
 * Converts GHL blog HTML/body content into structured sections
 * matching our Post body format ({ subheading, text }[]).
 *
 * Splits on h2/h3 tags. Falls back to a single section if
 * no headings are found.
 */
function parseBodySections(html: string | undefined): { subheading: string; text: string }[] {
  if (!html) return []

  // Strip HTML tags for a plain-text version
  const stripTags = (s: string): string =>
    s
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim()

  // Split on h2 or h3 tags
  const parts = html.split(/<h[23][^>]*>/i)

  const sections: { subheading: string; text: string }[] = []

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part.trim()) continue

    // First part before any heading
    if (i === 0) {
      const text = stripTags(part)
      if (text) {
        sections.push({ subheading: "Introduction", text })
      }
      continue
    }

    // Split heading from body at closing tag
    const closingMatch = part.match(/<\/h[23]>/i)
    if (closingMatch && closingMatch.index !== undefined) {
      const subheading = stripTags(part.slice(0, closingMatch.index))
      const text = stripTags(part.slice(closingMatch.index + closingMatch[0].length))
      if (subheading && text) {
        sections.push({ subheading, text })
      }
    } else {
      const text = stripTags(part)
      if (text) {
        sections.push({ subheading: "Section", text })
      }
    }
  }

  return sections
}

// ---------------------------------------------------------------------------
// Transform GHL post → internal Post format
// ---------------------------------------------------------------------------

function transformPost(ghlPost: GHLBlogPost, index: number): Post {
  const date =
    ghlPost.publishedAt?.slice(0, 10) ?? ghlPost.createdAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)

  const bodyContent = ghlPost.rawHTML ?? ghlPost.body ?? ""
  const bodySections = parseBodySections(bodyContent)

  return {
    id: ghlPost._id ?? String(index + 1),
    title: ghlPost.title ?? "Untitled",
    excerpt: ghlPost.description ?? "",
    category: mapCategory(ghlPost.categories),
    date,
    slug: ghlPost.slug ?? ghlPost._id ?? `post-${index + 1}`,
    body: bodySections.length > 0 ? bodySections : [{ subheading: "Content", text: ghlPost.description ?? "" }],
    htmlContent: bodyContent || undefined,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetches published blog posts from GHL. Falls back to static data
 * if GHL is not configured or the request fails.
 *
 * Results are cached via Next.js fetch cache with ISR revalidation.
 */
export async function getBlogPosts(): Promise<Post[]> {
  if (!isGHLBlogConfigured()) {
    return []
  }

  try {
    const url = new URL(`${GHL_BASE_URL}/blogs/posts/all`)
    url.searchParams.set("blogId", GHL_BLOG_ID)
    url.searchParams.set("locationId", GHL_LOCATION_ID)
    url.searchParams.set("status", "published")
    url.searchParams.set("limit", "10")
    url.searchParams.set("offset", "0")

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${GHL_API_KEY}`,
        "Content-Type": "application/json",
        Version: "2021-07-28",
      },
      next: { revalidate: 300 }, // ISR: revalidate every 5 minutes
    })

    if (!response.ok) {
      console.error(`[GHL Blog] API error ${response.status}:`, await response.text().catch(() => "unknown"))
      return []
    }

    const json = (await response.json()) as GHLBlogResponse
    const ghlPosts = json.posts ?? json.blogs ?? json.data ?? []

    if (ghlPosts.length === 0) {
      return []
    }

    const transformed = ghlPosts
      .filter((p) => p.status === "published" || !p.status)
      .map(transformPost)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    return transformed
  } catch (error) {
    console.error("[GHL Blog] Failed to fetch posts:", error)
    return []
  }
}

/**
 * Fetches a single blog post by slug. Falls back to static data.
 */
export async function getBlogPostBySlug(slug: string): Promise<Post | null> {
  const posts = await getBlogPosts()
  return posts.find((p) => p.slug === slug) ?? null
}
