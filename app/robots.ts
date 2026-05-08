import type { MetadataRoute } from "next"
import { SITE_URL } from "@/lib/constants"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Default rule for all crawlers — public pages allowed, admin/client/api blocked.
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin/", "/client/", "/editor/", "/api/"],
      },
      // Explicitly allow modern AI crawlers — citation by ChatGPT, Perplexity,
      // Claude, Gemini, Google AI Overviews, and Apple Intelligence is welcomed.
      // (Per ai-seo skill 2026 reference: bot names below are the canonical
      // user-agent strings each provider uses for live search and indexing.)
      {
        userAgent: [
          // OpenAI
          "GPTBot",
          "ChatGPT-User",
          "OAI-SearchBot",
          // Google (Gemini + AI Overviews)
          "Google-Extended",
          // Anthropic (Claude — both historical and current bot identifiers)
          "ClaudeBot",
          "Claude-Web",
          "anthropic-ai",
          // Perplexity
          "PerplexityBot",
          // Apple Intelligence
          "Applebot-Extended",
          // Meta AI
          "FacebookBot",
          "Meta-ExternalAgent",
          // You.com
          "YouBot",
          // Cohere
          "cohere-ai",
        ],
        allow: ["/", "/blog/", "/faq", "/llms.txt", "/ai.txt"],
        disallow: ["/admin/", "/client/", "/editor/", "/api/"],
      },
      // Block training-only crawlers that don't drive citation traffic.
      // (Common Crawl feeds training data but does not cite sources back.)
      {
        userAgent: ["CCBot"],
        disallow: "/",
      },
    ],
    host: SITE_URL,
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
