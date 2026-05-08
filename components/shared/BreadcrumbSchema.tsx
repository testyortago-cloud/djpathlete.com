import { JsonLd } from "@/components/shared/JsonLd"
import { SITE_URL } from "@/lib/constants"

export interface Crumb {
  /** Visible label, e.g. "Online Coaching" */
  name: string
  /** URL path or absolute URL. Path is normalized to absolute. */
  url: string
}

interface BreadcrumbSchemaProps {
  /**
   * Ordered list of breadcrumbs from root → current page.
   * Always include "Home" as the first entry.
   * The last entry should be the current page.
   */
  items: Crumb[]
}

const toAbsoluteUrl = (urlOrPath: string): string => {
  if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) return urlOrPath
  const path = urlOrPath.startsWith("/") ? urlOrPath : `/${urlOrPath}`
  return `${SITE_URL}${path}`
}

/**
 * Renders BreadcrumbList JSON-LD only (no visible UI).
 * Per 2026 schema best practices, BreadcrumbList helps Google build
 * sitelink hierarchies and improves CTR via SERP breadcrumb display.
 *
 * Usage:
 *   <BreadcrumbSchema items={[
 *     { name: "Home", url: "/" },
 *     { name: "Services", url: "/services" },
 *     { name: "Online Coaching", url: "/online" },
 *   ]} />
 */
export function BreadcrumbSchema({ items }: BreadcrumbSchemaProps) {
  if (!items || items.length === 0) return null

  const data = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: toAbsoluteUrl(c.url),
    })),
  }

  return <JsonLd data={data} />
}
