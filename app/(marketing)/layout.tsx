import { SiteNavbar } from "@/components/SiteNavbar"
import { Footer } from "@/components/Footer"
import { StickyApplyCTA } from "@/components/public/StickyApplyCTA"

/**
 * THIS LAYOUT READS NOTHING, AND THAT IS DELIBERATE.
 *
 * It used to read `chat_assistant_enabled` and `business_settings.display_name`
 * here and thread both into `StickyApplyCTA` as props, because the launcher is
 * a client component and this is its nearest server parent. But this layout
 * wraps the ENTIRE public site, and those pages are statically generated: the
 * build's own prerender manifest reports `initialRevalidateSeconds: false` for
 * /faq, /testimonials, /philosophy, /services, /glossary, /education, /contact,
 * /athletes/*, /privacy-policy, /terms-of-service and /sports. Both values were
 * therefore frozen into each page at build time and never re-read — one build
 * even froze two different answers into two different pages.
 *
 * Three consequences, none of them acceptable for this feature:
 *
 *   * The flag stopped being a switch. ON did nothing on those routes until the
 *     next deploy, and OFF could not take the launcher down: the visitor still
 *     saw "Ask a question", opened it, typed, and got an error back from a route
 *     that had correctly gated itself. That flag is the emergency stop on a
 *     public box collecting free text from strangers.
 *   * Two uncached database reads on every marketing page render.
 *   * The consent sentence went stale. The details card renders the marketing
 *     wording from `display_name`, and `/api/ask/capture` re-renders it from a
 *     FRESH read before filing the row — so a renamed business meant the visitor
 *     read one name while `wording_shown` recorded another.
 *
 * The launcher asks `GET /api/ask/config` from the browser instead, lazily, once
 * the bar is actually on screen. Anything added here that needs a per-request
 * value belongs behind the same kind of route, or on a page that is not static.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNavbar />
      <main className="min-h-screen">{children}</main>
      <Footer />
      <StickyApplyCTA />
    </>
  )
}
