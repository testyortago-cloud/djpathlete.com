// lib/content-studio/detail-nav.ts
// Where a detail page's "← Back" link points, derived from the shell tab the
// user came from (?tab=). Mirrors the old drawer's closeHref behaviour.
export function detailBackInfo(tab: string | undefined): { href: string; label: string } {
  switch (tab) {
    case "videos":
      return { href: "/admin/content?tab=videos", label: "Videos" }
    case "posts":
      return { href: "/admin/content?tab=posts", label: "Posts" }
    case "calendar":
      return { href: "/admin/content?tab=calendar", label: "Calendar" }
    default:
      return { href: "/admin/content", label: "Pipeline" }
  }
}
