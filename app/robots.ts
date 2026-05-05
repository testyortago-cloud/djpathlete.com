import type { MetadataRoute } from "next"
import { SITE_URL } from "@/lib/constants"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin/", "/client/", "/api/"],
      },
      // Explicitly allow AI crawlers
      {
        userAgent: ["GPTBot", "ChatGPT-User", "Google-Extended", "Claude-Web", "PerplexityBot", "Applebot-Extended"],
        allow: ["/", "/blog/"],
        disallow: ["/admin/", "/client/", "/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
