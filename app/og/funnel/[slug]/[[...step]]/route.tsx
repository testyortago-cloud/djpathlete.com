// The share card for a published funnel or landing page, drawn per request.
//
// ---------------------------------------------------------------------------
// WHY THIS IS GENERATED RATHER THAN A FILE SOMEBODY UPLOADS
// ---------------------------------------------------------------------------
// The goal was "every published step has a share image". A static PNG closes
// that once: somebody makes, uploads and wires one per funnel, and the nine
// drafts in the database get nothing on the day they go live. This closes it
// permanently — every funnel and landing page, including ones that do not
// exist yet, gets a card carrying ITS OWN title, free, with no upload.
//
// It also keeps the picture honest. A generated photograph of an athlete on
// the share card of a coaching business whose proof is REAL athletes (WTA
// players, named testimonials) is a claim the brand does not need to make. A
// typographic card says the true thing. fal is wired in this repo and could
// draw one — that is a separate, deliberate decision about photography, not
// the default for a title card.
//
// ---------------------------------------------------------------------------
// WHY A ROUTE HANDLER AND NOT `opengraph-image.tsx`
// ---------------------------------------------------------------------------
// The file convention is the house pattern (see
// `app/athlete/[token]/opengraph-image.tsx`) and it CANNOT BE USED HERE. The
// public funnel page lives under an optional catch-all, and Turbopack refuses
// the build outright:
//
//   Invalid segment Static("opengraph-image"), catch all segment must be the
//   last segment modifying the path
//
// `[[...step]]` has to be the last segment that modifies the path, and
// `opengraph-image` would come after it. Found by running it, not by reading
// about it.
//
// A route handler also removes a subtlety the file convention brings with it:
// a file-based card supplies `og:image`, but an explicit `openGraph.images` in
// `generateMetadata` OVERRIDES it — so the owner's own image and the generated
// one would be competing through a precedence rule invisible at both call
// sites. Here `generateMetadata` always names an image explicitly, and
// `resolveFunnelStepSeo` decides which. One rule, one place.
//
// NOT UNDER `/api/`: `app/robots.ts` disallows that prefix for every crawler,
// and an image a scraper is told not to fetch is not a share card.
//
// ---------------------------------------------------------------------------
// SATORI, NOT A BROWSER
// ---------------------------------------------------------------------------
//   - every element with children needs an explicit `display: flex`
//   - there is no `text-overflow`; long text WRAPS off the bottom of the frame
//     rather than clipping, and the PNG renders "fine" with the rest missing.
//     `ogClamp` cuts it beforehand.
//   - no CSS variables and no Tailwind, hence the literal hex from `lib/og`.
// No remote font is fetched, deliberately: `next/font` faces are not available
// to Satori, and a font fetch that stalls is a share card that never renders
// in a messaging app. Default sans, same choice the athlete report card made.

import { ImageResponse } from "next/og"
import { getPublishedStep } from "@/lib/db/funnels"
import { resolveFunnelStepSeo } from "@/lib/funnels/seo"
import { OG_ACCENT, OG_ARENA, OG_ICE, OG_SIZE, ogClamp } from "@/lib/og/brand"

export const dynamic = "force-dynamic"

export async function GET(_request: Request, ctx: { params: Promise<{ slug: string; step?: string[] }> }) {
  const { slug, step } = await ctx.params

  // NEVER THROWS, AND NEVER 404s. A scraper that gets an error here shows no
  // card at all, which is the state this whole change exists to fix — so an
  // unreadable or unpublished row degrades to the brand card rather than to
  // nothing. The page itself still 404s; only the picture is forgiving.
  const published = await getPublishedStep(slug, step?.[0]).catch(() => null)
  const seo = published ? resolveFunnelStepSeo(published.funnel, published.step) : null

  const title = ogClamp(seo?.title ?? "DJP Athlete", 68)
  const description = seo?.description ? ogClamp(seo.description, 118) : null

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        backgroundColor: OG_ARENA,
        backgroundImage: `radial-gradient(ellipse 55% 45% at 88% 0%, ${OG_ACCENT}52, transparent 60%), radial-gradient(ellipse 45% 35% at 0% 100%, ${OG_ICE}24, transparent 60%)`,
        color: "#f2f6f7",
        fontFamily: "sans-serif",
      }}
    >
      {/* Inset hairline frame — the athlete report card's signature, so the
            two cards read as the same brand when both appear in one thread. */}
      <div
        style={{
          display: "flex",
          position: "absolute",
          top: 28,
          left: 28,
          right: 28,
          bottom: 28,
          border: `1px solid ${OG_ACCENT}55`,
          borderRadius: 18,
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ display: "flex", width: 44, height: 2, backgroundColor: OG_ACCENT }} />
        <div style={{ display: "flex", fontSize: 26, letterSpacing: 6, color: OG_ACCENT }}>DJP ATHLETE</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* The title is the card. It is the one thing someone scrolling a
              feed actually takes in, so it gets the space. */}
        <div
          style={{
            display: "flex",
            fontSize: 72,
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: -2,
          }}
        >
          {title}
        </div>
        {description ? (
          <div style={{ display: "flex", fontSize: 30, lineHeight: 1.35, color: "#ffffffbb" }}>{description}</div>
        ) : null}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div style={{ display: "flex", fontSize: 24, letterSpacing: 3, color: OG_ICE }}>
          ELITE SPORTS PERFORMANCE COACHING
        </div>
        <div style={{ display: "flex", fontSize: 24, color: "#ffffff99" }}>darrenjpaul.com</div>
      </div>
    </div>,
    OG_SIZE,
  )
}
