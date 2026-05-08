# PARKED: `/locations/tampa-bay` umbrella page

*Parked: 2026-05-07. Resume after the website redesign.*

## Why parked

Owner is redesigning the site. No point shipping a new page into the current design system when the visual language is changing. Resume after redesign so the location page is built once, in the new design.

## Strategy (already decided — don't relitigate)

**Phase 1: one rich umbrella page only.** Do NOT auto-generate 4 templated city pages — that's a doorway-page pattern that triggers Google's helpful-content suppression and would drag down sitewide quality signal. Build `/locations/tampa-bay` as a single high-quality page first. Decide on per-city pages only after the umbrella ranks.

**Phase 2 decision tree (90 days post-launch):**
- Top 10 for 3+ regional queries → build next single city page (Zephyrhills first, then Wesley Chapel, then Tampa)
- Top 10 for only 1–2 queries → improve umbrella with more athlete content + photos
- Not top 20 anywhere → rework umbrella; likely thin content or weak GBP

## Page blueprint (build-ready)

1. H1: "Sports Performance Coaching in Tampa Bay, Florida"
2. 134–167 word semantic answer block under H1 (the AEO extract anchor)
3. Embedded map + GBP "Get directions" CTA — anchored to Place ID `ChIJw5GXPKNN3YgRqvY7cRf1S8g`
4. "Why Tampa Bay" — local athletic culture context (USF / UT collegiate, Bucs/Lightning/Rowdies/Rays pro presence, growing pickleball + lacrosse, big tennis + golf)
5. **Service area & drive times** — explicit drive times *to* the Zephyrhills facility from: Tampa, St. Pete, Wesley Chapel, Lakeland, Brandon, Riverview, Land O' Lakes
6. Sport landscape we cover locally — only sports Darren actually has Tampa-area experience with
7. 2–3 Tampa-area athlete testimonials — verifiable, named, sport + level
8. Local-FAQ block with `FAQPage` schema — questions: "sports performance coach Tampa", "strength and conditioning Wesley Chapel", "return-to-sport assessment Tampa Bay", parking, gym layout, what equipment is on site
9. JSON-LD: `Place` + `LocalBusiness` + `FAQPage` + `BreadcrumbList`
10. NAP block + hours — exact match to GBP and footer
11. CTA pair: "Apply for in-person" + "Book free consultation"

## Blocked on owner data (gather these before resuming)

| Need | Why it matters |
|---|---|
| 5–10 photos of the actual facility | Schema needs real `image` arrays; thin-content filters look for visible photo evidence |
| 2–3 Tampa-area athlete testimonials with permission (name, sport, level, quote) | Local testimonials are the strongest local-SEO signal — generic ones get discounted |
| Specific Tampa-area schools/clubs/programs we've coached athletes from | Entity density for the local Knowledge Graph |
| Confirmed driving radius — yes/no on Wesley Chapel, Tampa, Lakeland as actual service areas (not aspirational) | Don't claim service in cities you won't actually drive to / accept clients from |
| Top 3 local sports Darren has the most Tampa-area experience coaching | Determines which local entities to weave into copy |

## When we resume

Estimated build: **4–6 hours** of focused work (page + schema + content) once the redesign is in place and owner data is in hand. Includes adding the page to:
- `app/sitemap.ts` (add `/locations/tampa-bay` at priority 0.8)
- Footer nav (under Services or new "Locations" group)
- Internal links from `/in-person` ("serving the Tampa Bay area")

## KPIs to watch post-launch

- GSC impressions for `/locations/tampa-bay` (target: 50+/day within 60 days)
- Avg. position for "sports performance coach tampa / wesley chapel / lakeland / tampa bay" (target: top 20 by 90 days, top 10 by 180 days)
- GBP directions + calls + website clicks step-change
- Map Pack appearances for `[city] sports performance coach` (manual incognito check, location set to each city)
- Direct traffic split between `/locations/tampa-bay` vs `/in-person` for local queries

## What's NOT parked

The local-SEO foundation that's already shipped continues to work:
- `BUSINESS_INFO` NAP centralized in `lib/business-info.ts`
- `SportsActivityLocation` JSON-LD on home page
- GBP integration scaffold + GoogleReviewsBadge live on home and /about
- `serviceAreas` array in business-info already lists Tampa Bay cities
- Footer NAP block

Those are doing their job in the background. The umbrella page is the next amplifier — it's just waiting for the redesign + owner data.

## Cross-references

- Master plan: `.agents/seo-aeo-geo-cro-master-plan.md` §4.3
- Query catalog: `.agents/ai-query-catalog.md` section G (status ⚠️ → resolve to ✅ once shipped)
