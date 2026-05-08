# Slug & Metadata Convention — DJP Athlete

*Last updated: 2026-05-08*

The uniform standard every page on darrenjpaul.com follows. Apply this convention to any new page or migration.

## Why uniformity matters

Per 2026 SEO best practices ([source](https://seeklab.io/blog/on-page-seo-titles-metas-structure/), [source](https://www.straightnorth.com/blog/title-tags-and-meta-descriptions-how-to-write-and-optimize-them-in-2026/)):
- Search engines now rewrite **62%+ of meta descriptions** based on the query — well-crafted descriptions still influence the rewrite logic and CTR
- Duplicate titles confuse the entity graph and dilute SEO
- Pages without locality on local-intent queries miss AI Overview eligibility (40%+ of local queries trigger an AI Overview)
- AI engines extract the first 50–60 chars of titles as canonical references

## URL & slug convention

### Format rules

- **All lowercase.** No mixed case (`/Sign-Up` ❌ → `/sign-up` ✅).
- **Kebab-case** (hyphens, not underscores). `/return-to-performance` ✅, `/return_to_performance` ❌.
- **No trailing slashes.** `/about` not `/about/`.
- **Singular vs plural** matches the actual purpose: `/blog` (hub) → `/blog/[slug]` (post).
- **No file extensions** in user-facing URLs.
- **No query strings for canonical content.** Use clean paths.

### Page hierarchy

| Tier | Pattern | Examples |
|---|---|---|
| **Top-level money pages** | `/[service]` | `/in-person`, `/online`, `/assessment` |
| **Top-level evergreen** | `/[topic]` | `/about`, `/contact`, `/faq`, `/glossary`, `/philosophy`, `/testimonials` |
| **Hub indexes (with sub-routes)** | `/[hub]` | `/blog`, `/clinics`, `/camps`, `/shop`, `/services` |
| **Detail pages under a hub** | `/[hub]/[slug]` | `/blog/[slug]`, `/clinics/[slug]`, `/camps/[slug]`, `/shop/[slug]` |
| **Comparison pages** | `/services/[a]-vs-[b]` | `/services/online-vs-in-person`, `/services/coaching-vs-training-app` |
| **Future location pages** | `/locations/[city]` | `/locations/tampa-bay` (parked) |
| **Legal** | `/[legal-doc]` | `/privacy-policy`, `/terms-of-service` |
| **Auth** | `/[action]` | `/login`, `/register`, `/forgot-password`, `/verify-email` |

### Why services are top-level (not under `/services/`)

`/online`, `/in-person`, `/assessment` were top-level from the start and accumulated inbound links + JSON-LD references. Migrating them under `/services/` would break canonical signals for marginal gain. **Comparison pages live under `/services/` because they are net-new and reinforce the hub.** Future service-related pages (e.g., `/services/youth-program`) should follow the comparison-page pattern.

### Slug copy rules

- **Match search intent verbatim** when possible. Comparison pages: `[a]-vs-[b]`. Methodology terms: use the canonical phrase. Question-form pages: short slug, full question in H1 (e.g., slug `/blog/return-to-performance` not `/blog/what-is-return-to-performance-explained`).
- **Drop redundant brand suffixes.** `/grey-zone` not `/djp-grey-zone-explained`.
- **Keep slugs ≤ 5 words** where possible. Max 8.

## Metadata convention

### Title format (the page-level `metadata.title`)

Layout template ([app/layout.tsx](app/layout.tsx)): `template: "%s | DJP Athlete"` — automatically appends the brand for every page.

**Therefore the page-level `title` MUST NOT contain "DJP Athlete"** — otherwise the rendered HTML title duplicates the brand (e.g., "Sports Performance Glossary — DJP Athlete | DJP Athlete").

| Element | Rule |
|---|---|
| **Page `title`** | Just the page-specific keyword phrase. **No "\| DJP Athlete" suffix.** Length: aim for 35–47 chars (template adds ~13 chars; total stays ≤ 60 visible). |
| **Separator inside title** | Em dash (`—`) for compound or hierarchical (e.g., "Return-to-Sport Assessment — Tampa Bay"). Keep pipe (`|`) reserved for the layout brand suffix. |
| **Primary keyword** | Lead with it. Match how users search ("Return-to-Sport Assessment", not "Athletic Diagnostic Service"). |
| **Locality** | Include "Tampa Bay" or "Zephyrhills, FL" on every locally-relevant page (in-person, clinics, camps, contact, shop). |

### Description format

| Element | Rule |
|---|---|
| **Length** | 150–160 chars. Mobile truncates around 120 chars, so front-load. |
| **Primary keyword** | First 50 chars. |
| **Locality** | Where relevant. |
| **Differentiator** | "Coach-led", "criterion-based", "application-only", "PhD/CSCS", "diagnostic-driven" — pick what's true for that page. |
| **Action / value prop** | End with a clear value statement (not necessarily a CTA verb). |
| **Brand mention** | Optional; only if it strengthens the description (e.g., "Darren J Paul, PhD" as expert attribution). |

### OpenGraph + Twitter title format

| Element | Rule |
|---|---|
| **Title** | Same as page title BUT with explicit `" | DJP Athlete"` suffix because OG/Twitter don't go through the template. |
| **Description** | Can be slightly shorter than meta description (150 chars). Often a tighter version. |
| **Type** | `"website"` for marketing pages, `"article"` for blog posts. |
| **Card** (Twitter) | `"summary_large_image"` for hero-image pages. |

### Canonical URL

| Element | Rule |
|---|---|
| **Format** | Path-only: `"/about"` not `"https://www.darrenjpaul.com/about"` (Next.js + `metadataBase` handles the absolute URL). Exception: blog posts use absolute URL. |
| **Match** | Must exactly match the route the page is served from. |
| **Always self-referencing** for primary content. |
| **Trailing slash** | Never. |
| **Case** | Lowercase. |

### Robots & indexability

| Page type | `robots` setting |
|---|---|
| All marketing pages | Default (indexable, follow) |
| Privacy / Terms | `{ index: false, follow: true }` |
| Cart / Checkout / Order pages | `{ index: false, follow: true }` |
| Booking confirmation pages | `{ index: false, follow: false }` |
| Coming-soon placeholder | Default (or noindex if not yet launched) |

## Reference templates

### Standard marketing page

```ts
export const metadata: Metadata = {
  title: "[Primary Keyword Phrase] in [Location, if relevant]",  // 35-47 chars; NO brand
  description:
    "[150–160 char description leading with primary keyword, naming locality where relevant, surfacing the brand differentiator, ending with the value statement].",
  alternates: { canonical: "/page-slug" },
  openGraph: {
    title: "[Primary Keyword Phrase] in [Location] | DJP Athlete",
    description:
      "[Slightly tighter, ~140 chars version].",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "[Same as OG title]",
    description: "[Even tighter, ~120 chars].",
  },
}
```

### Blog post (dynamic)

```ts
export async function generateMetadata({ params }): Promise<Metadata> {
  const post = await getPost(params.slug)
  return {
    title: post.title,  // No suffix — template adds " | DJP Athlete"
    description: post.meta_description ?? post.excerpt,
    alternates: { canonical: `https://www.darrenjpaul.com/blog/${post.slug}` },
    openGraph: {
      title: `${post.title} | DJP Athlete`,
      description: post.meta_description ?? post.excerpt,
      type: "article",
      // ...
    },
  }
}
```

## Audited page-by-page state (as of 2026-05-08)

| URL | Title (page-level) | Length | Status |
|---|---|---|---|
| `/` | "Sports Performance Coaching for Elite Athletes \| DJP Athlete" (absolute) | 60 | ✅ |
| `/about` | "Darren J Paul — Athletic Performance Coach" | 44 | ✅ |
| `/services` | "Sports Performance Coaching Services" | 37 | ✅ |
| `/in-person` | "In-Person Sports Performance Training in Tampa Bay, FL" | 55 | ✅ Updated 2026-05-08 |
| `/online` | "Online Sports Performance Training" | 35 | ✅ |
| `/assessment` | "Return-to-Sport Assessment & Performance Testing" | 49 | ✅ Updated 2026-05-08 |
| `/philosophy` | "The Grey Zone — Coaching Philosophy" | 36 | ✅ |
| `/testimonials` | "Athlete Testimonials & Reviews" | 31 | ✅ |
| `/contact` | "Contact Darren J Paul — Book a Consultation" | 44 | ✅ |
| `/faq` | "FAQ — Sports Performance Coaching Questions" | 44 | ✅ |
| `/glossary` | "Sports Performance Glossary" | 27 | ✅ Fixed brand-duplicate bug 2026-05-08 |
| `/blog` | "The Performance Journal — Coaching, Training & Recovery" | 53 | ✅ |
| `/clinics` | "Speed & Agility Training Clinics in Tampa Bay, FL" | 49 | ✅ Updated 2026-05-08 |
| `/camps` | "High-Performance Soccer Camps in Tampa Bay, FL" | 47 | ✅ Updated 2026-05-08 |
| `/services/online-vs-in-person` | "Online vs In-Person Sports Performance Coaching" | 47 | ✅ |
| `/services/coaching-vs-training-app` | "Sports Performance Coaching vs Training Apps" | 44 | ✅ |
| `/education` | "Sports Performance Education for Coaches & Athletes" | 51 | ✅ Updated 2026-05-08 |
| `/resources` | "Sports Performance Resources for Athletes & Coaches" | 51 | ✅ Updated 2026-05-08 |
| `/shop` | "Athletic Performance Apparel & Training Gear" | 44 | ✅ Updated 2026-05-08 |
| `/privacy-policy` | "Privacy Policy" | 14 | ✅ Acceptable for legal (noindex) |
| `/terms-of-service` | "Terms of Service" | 16 | ✅ Acceptable for legal |
| `/coming-soon` | "Coming Soon" | 11 | ✅ Acceptable (placeholder) |
| `/shop/cart`, `/shop/checkout` | "Cart" / "Checkout" | <10 | ✅ Acceptable (noindex utility) |

## Checklist for any new page

Before merging a new page, verify:

- [ ] Slug is lowercase, kebab-case, no trailing slash
- [ ] Lives at the right hierarchy level (top-level vs nested)
- [ ] `metadata.title` is page-specific only (no "| DJP Athlete" — template adds it)
- [ ] Title is 35–47 chars (final rendered title ≤ 60 with template suffix)
- [ ] Title leads with primary keyword
- [ ] Locality named if locally relevant ("Tampa Bay, FL" or "Zephyrhills, FL")
- [ ] Description is 150–160 chars
- [ ] Description front-loads the primary keyword in first 50 chars
- [ ] OG/Twitter titles include explicit `" | DJP Athlete"` suffix
- [ ] Canonical is path-only, matches the actual URL exactly
- [ ] If utility/legal: `robots: { index: false, follow: true }` is set
- [ ] Page is added to `app/sitemap.ts` (or excluded if utility)
- [ ] Page renders 200 in dev
- [ ] No duplicate brand in any rendered title

## Sources

- [How to Optimize Title Tags & Meta Descriptions in 2026 — Straight North](https://www.straightnorth.com/blog/title-tags-and-meta-descriptions-how-to-write-and-optimize-them-in-2026/)
- [SEO Title Tags & Meta Descriptions Best Practices 2026 — SeekLab](https://seeklab.io/blog/on-page-seo-titles-metas-structure/)
- [Meta Titles & Descriptions for Local SEO 2026 — Sink or Swim Marketing](https://sink-or-swim-marketing.com/blog/how-to-optimize-your-meta-titles-descriptions-for-top-local-rankings-in-2026/)
- [Meta Title Length Best Practices 2026 — Scalenut](https://www.scalenut.com/blogs/meta-title-length-best-practices-2026)
