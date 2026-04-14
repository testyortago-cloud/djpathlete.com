import type { MetadataRoute } from "next"
import { getPublishedBlogPosts } from "@/lib/db/blog-posts"
import { getPublishedEvents } from "@/lib/db/events"

const BASE_URL = "https://djpathlete.com"

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${BASE_URL}/about`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/services`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/clinics`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/camps`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/contact`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/testimonials`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/blog`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/login`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/register`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
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

  return [...staticPages, ...blogPages, ...eventPages]
}
