import type { MetadataRoute } from "next"
import { getPublishedBlogPosts } from "@/lib/db/blog-posts"
import { getPublishedEvents } from "@/lib/db/events"
import { listActiveProducts } from "@/lib/db/shop-products"
import { SITE_URL } from "@/lib/constants"

const BASE_URL = SITE_URL

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  const staticPages: MetadataRoute.Sitemap = [
    // Home
    { url: BASE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },

    // Money pages — primary conversion targets
    { url: `${BASE_URL}/in-person`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE_URL}/online`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE_URL}/assessment`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },

    // Primary marketing pages
    { url: `${BASE_URL}/services`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE_URL}/services/online-vs-in-person`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE_URL}/services/coaching-vs-training-app`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE_URL}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE_URL}/philosophy`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE_URL}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE_URL}/clinics`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE_URL}/camps`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },

    // Secondary marketing pages
    { url: `${BASE_URL}/testimonials`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE_URL}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE_URL}/faq`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE_URL}/shop`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },

    // Content hubs
    { url: `${BASE_URL}/glossary`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE_URL}/education`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE_URL}/resources`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },

    // Auth (low priority but discoverable)
    { url: `${BASE_URL}/login`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE_URL}/register`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },

    // Legal
    { url: `${BASE_URL}/privacy-policy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE_URL}/terms-of-service`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ]

  // Dynamic blog posts
  let blogPages: MetadataRoute.Sitemap = []
  try {
    const posts = await getPublishedBlogPosts()
    blogPages = posts.map((post) => ({
      url: `${BASE_URL}/blog/${post.slug}`,
      lastModified: new Date(post.updated_at),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    }))
  } catch {
    // If DB is unavailable, return static pages only
  }

  // Dynamic event pages (clinics and camps)
  let eventPages: MetadataRoute.Sitemap = []
  try {
    const [clinics, camps] = await Promise.all([
      getPublishedEvents({ type: "clinic" }),
      getPublishedEvents({ type: "camp" }),
    ])
    eventPages = [
      ...clinics.map((e) => ({
        url: `${BASE_URL}/clinics/${e.slug}`,
        lastModified: new Date(e.updated_at),
        changeFrequency: "daily" as const,
        priority: 0.7,
      })),
      ...camps.map((e) => ({
        url: `${BASE_URL}/camps/${e.slug}`,
        lastModified: new Date(e.updated_at),
        changeFrequency: "daily" as const,
        priority: 0.7,
      })),
    ]
  } catch {
    // If DB is unavailable, return without event pages
  }

  // Dynamic shop product pages
  let shopPages: MetadataRoute.Sitemap = []
  try {
    const products = await listActiveProducts()
    shopPages = products.map((product) => ({
      url: `${BASE_URL}/shop/${product.slug}`,
      lastModified: new Date(product.updated_at ?? product.created_at ?? now),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }))
  } catch {
    // If DB is unavailable, return without shop pages
  }

  return [...staticPages, ...blogPages, ...eventPages, ...shopPages]
}
