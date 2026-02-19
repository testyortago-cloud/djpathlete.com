import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin/", "/client/", "/api/"],
      },
    ],
    sitemap: "https://djpathlete.com/sitemap.xml",
  }
}
