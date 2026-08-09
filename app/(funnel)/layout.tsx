// Funnel pages get their own route group so they do NOT inherit the marketing
// chrome.
//
// app/(marketing)/layout.tsx renders SiteNavbar + Footer + StickyApplyCTA around
// everything in that group. A landing page's entire job is to remove exits, so
// shipping one with full site navigation, a footer full of links, and a floating
// "Apply for coaching" button competing with the page's own call to action
// defeats the point of building it.
//
// A nested layout cannot remove a parent layout, so escaping it means living in
// a different route group. The root app/layout.tsx still applies — that is where
// <html>, <body> and the fonts come from.

export default function FunnelLayout({ children }: { children: React.ReactNode }) {
  return children
}
