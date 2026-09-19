# SEO audit — the funnel & landing-page surface

*Run 2026-09-19 against production (`https://www.darrenjpaul.com`) and the prod
Supabase project `epzuvzkokzqtzomeyoha`. Scope: the builder-rendered pages under
`/go/`, measured against the hand-coded marketing routes in `app/(marketing)/`
as the control.*

Method note: every finding below was taken from the live HTML or from a
`funnel_steps` read, not from the source. Where a finding is an ABSENCE, it is
paired with a control page that HAS the thing — an absence assertion with no
presence control passes just as well when nothing rendered at all.

---

## Executive summary

The builder can produce a page, publish it, and put it in front of Google, but
it cannot describe it. Four SEO fields exist on `funnel_steps` and the public
route already reads all four — **and all four are NULL on all 10 rows, because
nothing in the product can write them.** There is no admin input for any of
them anywhere in the app.

So the one published funnel is serving the builder's own internal labels to
searchers, and it is serving them to nobody, because it is not in the sitemap
and nothing links to it.

**The five that matter, worst first:**

| # | Finding | Impact |
|---|---|---|
| 1 | The whole OpenGraph block is **deleted** on every funnel page — not just the image | High |
| 2 | Title falls back to the step's internal name (`Start`) | High |
| 3 | Meta description serves an internal builder note (`The RPI quiz funnel.`) | High |
| 4 | No canonical, and the entry step answers on **two** URLs with identical content | Medium-High |
| 5 | Published `/go/` URLs are absent from the sitemap, and the page is an orphan | Medium-High |

The root cause under all five is the same: **no admin UI**. That is finding 6,
and it is the one that decides whether this stays fixed.

---

## 1. The entire OpenGraph block is deleted on funnel pages

**Impact: High.** This is worse than the "missing OG image" it was reported as.

`app/(funnel)/go/[slug]/[[...step]]/page.tsx:44` reads:

```ts
openGraph: stepRow.og_image_url ? { images: [stepRow.og_image_url] } : undefined,
```

An explicit `undefined` from a child does not mean "inherit" — it overrides the
root layout's `openGraph` and removes it. `app/layout.tsx:37-49` defines a
perfectly good site-wide OG block with a title, description, `siteName`, locale
and image. **The funnel page throws all of it away** and emits none.

**Evidence, with a control:**

| URL | `og:` tags | `<link rel=canonical>` |
|---|---|---|
| `/online` (control — hand-coded marketing page) | 3 (`og:title`, `og:description`, `og:type`) | 1 |
| `/go/athlete-quiz/start` | **0** | **0** |

```
$ curl -s -L https://www.darrenjpaul.com/go/athlete-quiz/start | grep -c 'property="og:'
0
```

**What this costs, concretely:** every share of a funnel link on Facebook,
LinkedIn, WhatsApp, iMessage or Slack renders as a bare URL — no title card, no
image. For a page whose entire job is to be sent to an athlete, that is the
single most expensive defect on this list.

The `twitter:` tags *do* survive, because the child never names `twitter` — but
they carry the site-wide copy. An X share of the quiz currently advertises
"DJP Athlete — Elite Sports Performance Coaching", which contradicts the page's
own `<title>`.

**Fix:** always emit a real OG block. Never emit `openGraph: undefined`. Include
the image fallback explicitly rather than relying on inheritance — Next.js
replaces `openGraph` wholesale when a child defines it, so an omitted `images`
key is not an inherited one.

---

## 2. The title falls back to the step's internal name

**Impact: High.**

```
$ curl -s -L https://www.darrenjpaul.com/go/athlete-quiz/start | grep -oiE '<title>[^<]*</title>'
<title>Start | DJP Athlete</title>
```

"Start" is the builder's navigation label for the first card in the rail. It was
never written to be read by anyone outside the admin.

The fallback chain is `seo_title ?? stepRow.name ?? funnel.name`, and **the
middle term is the worst of the three.** Step names are not merely unhelpful,
they are near-totally duplicated. All 10 rows:

| Step name | Count |
|---|---|
| `Landing page` | 4 |
| `Quiz` | 2 |
| `Start` | 1 |
| `Signup` | 1 |
| `Thank you` | 1 |

As a corpus of page titles that is 10 pages sharing 5 names. Duplicate titles
dilute the entity graph; the convention doc in `.agents/slug-and-metadata-convention.md`
calls this out explicitly.

Meanwhile `funnel.name` — the term the chain reaches *last* — is owner-authored
and genuinely usable: "Athlete Performance Insight", "The Recruiting Ready
Athlete", "Rotational Reboot". **The chain has its two fallbacks in the wrong
order.**

---

## 3. The meta description serves an internal note

**Impact: High.**

```
<meta name="description" content="The RPI quiz funnel."/>
```

`funnel.description` is the builder's own note field — what the owner types to
remind himself what he is building. It is not marketing copy and nothing in the
admin tells him it will be published. Across the 10 rows it contains:

- a **Loom URL followed by a 400-character spec paragraph** (`the-performance-gap-map-quiz`)
- two internal notes (`The RPI quiz funnel.`, `A 5 self assessment exercises that provide a scoring/index that then leads into potentially selling of my...`)
- one `NULL`
- two that happen to read as decent marketing copy

A fallback that is right a third of the time and puts a **Loom URL in a live
meta description** the rest of the time is not a safe fallback. See the
decision in §"Fallback chain" below — the recommendation is to remove this
fallback rather than improve it.

---

## 4. No canonical, and the entry step answers on two URLs

**Impact: Medium-High.** Self-inflicted duplicate content.

The route is an optional catch-all (`[[...step]]`), so the entry step is
reachable both with and without its slug. Both return 200, and both serve
identical metadata:

| URL | Status | `<title>` |
|---|---|---|
| `/go/athlete-quiz` | 200 | `Start \| DJP Athlete` |
| `/go/athlete-quiz/start` | 200 | `Start \| DJP Athlete` |

Neither emits a canonical, so there is nothing telling Google which one is the
page. The convention doc requires a self-referencing canonical on every page and
the marketing routes all have one; the funnel route is the only public surface
that does not.

**Fix:** emit a path-only canonical. The entry step canonicalises to the bare
`/go/<slug>` — it is the shorter, shareable form and the one the admin screen
already shows as "Public URL".

---

## 5. Published funnel URLs are absent from the sitemap

**Impact: Medium-High.**

```
$ curl -s https://www.darrenjpaul.com/sitemap.xml | grep -c "/go/"
0
$ curl -s https://www.darrenjpaul.com/sitemap.xml | grep -c "<loc>"
34
```

`app/sitemap.ts` emits static marketing routes plus blog posts, events and shop
products. It has no concept of funnels.

`robots.txt` **does** allow `/go/` (it disallows only `/admin/`, `/client/`,
`/editor/`, `/api/`), so these pages are crawlable — they are just
undiscoverable. And there is no internal link to `/go/athlete-quiz` from
anywhere on the marketing site, which makes it a genuine orphan page: crawlable
in principle, unreachable in practice.

**Fix:** emit published funnel steps, honouring `noindex`. A noindexed step must
not be listed — advertising a URL in the sitemap and then telling the crawler
not to index it is a contradictory signal.

**Tenancy note, stated honestly:** `funnels` has **no `business_id` column**
(verified against `information_schema.columns` — the table has 18 columns and
none of them is a tenant key). So unlike the events block directly above it,
this reader cannot take a tenant predicate today; there is nothing to predicate
on. This is recorded as a comment at the call site rather than papered over with
a `platformBusinessId()` call that would imply a filter that does not exist.
When `funnels` becomes tenant-scoped, this reader needs a predicate — it is on
the list in `lib/tenancy/platform.ts`'s doc comment.

---

## 6. There is no admin UI for any of the four fields — the root cause

**Impact: High, and it is the one that decides whether findings 1-3 stay fixed.**

The entire write path already exists and works:

- `funnel_steps` has `seo_title`, `seo_description`, `og_image_url`, `noindex` (migration `00202_funnels.sql:50-52`)
- `updateStepSchema` accepts all four (`lib/validators/funnel.ts:341-344`)
- `updateStep` writes all four (`lib/db/funnels.ts:353-374`)
- `PATCH /api/admin/funnels/steps/[stepId]` wires them end to end

**Nothing renders an input for any of them.** `grep -rn "seo_title" components/`
returns nothing outside of test fixtures. The columns have been writable since
`00202` and are NULL on every row in production, which is the entirely
predictable outcome.

This is a *labelling gap with the reader already built* — the inverse of the
usual failure. Somebody built the reader and the write path and never built the
door.

**Where it has to go, and why not the obvious place:** the funnel settings
screen (`FunnelDetailScreen`) is the obvious home and it is the **wrong** one —
`app/(admin)/admin/pages/[id]/page.tsx` redirects a `kind='page'` row straight
back to `/admin/pages`, so that screen never renders for a landing page at all.
A panel added there would be invisible to every landing page in the product.

The SEO fields are per-STEP, and the one surface that is per-step and serves
both kinds is the builder's right-hand inspector rail
(`Section` / `Page design`), which is reached identically from `/admin/funnels`
and `/admin/pages`. That is where it goes.

---

## The fallback chain — decision

What `generateMetadata` should do when `seo_title` / `seo_description` are NULL.

### Title — reorder, and drop the step name for entry steps

```
seo_title
  ?? (entry step)  funnel.name
  ?? (other steps) `${funnel.name} — ${step.name}`
```

- **Entry step gets `funnel.name` alone.** It is owner-authored and describes
  the offer. This is the case that matters: the entry step is the URL that gets
  shared.
- **Non-entry steps keep the step name, but qualified.** Dropping it entirely
  would give every step of a funnel the same title. `The Performance Gap Map
  Quiz — Thank you` disambiguates and follows the convention doc's em-dash rule
  for compound titles.
- The layout template appends `| DJP Athlete`, so the value here must never
  contain the brand.

### Description — remove the fallback entirely

```
seo_description ?? (nothing)
```

Not `funnel.description`. Serving no description is **better** than serving an
internal note: with no description Google composes one from the page's actual
headline and subhead — real marketing copy the builder wrote — whereas today it
is handed "The RPI quiz funnel." and, on another funnel, would be handed a Loom
URL. The convention doc notes Google rewrites 62%+ of descriptions anyway, so
the downside of omitting one is small and the downside of a wrong one is not.

The gap is made **visible** rather than silently papered over: the admin panel
shows what will actually be served, and flags the step when the field is empty.

### OG image — fall back to a GENERATED card

`og_image_url ?? /og/funnel/<slug>[/<step>]`.

The first version of this decision was "fall back to the site default"
(`/images/gym-training-01.jpg`), which would have put one generic gym photo on
the share card of every funnel in the account. It is superseded: a route at
`app/og/funnel/[slug]/[[...step]]/route.tsx` draws a 1200x630 card carrying the
page's OWN title, so the fallback is now better than the thing it fell back
from, and a funnel that does not exist yet gets one the day it goes live.

Written out explicitly in `generateMetadata` rather than left to Next's
`opengraph-image.tsx` file convention, for two reasons. The convention is
IMPOSSIBLE here — Turbopack refuses an `opengraph-image` segment after an
optional catch-all (`[[...step]]` must be the last segment modifying the path),
which is a build failure, not a warning. And it would put the owner's own image
and the generated one in competition through a precedence rule ("an explicit
`openGraph.images` overrides the file") that is invisible at both call sites.

---

## Prioritised action plan

**Critical — ship together**

1. Always emit a full OG block; never `openGraph: undefined`. (§1)
2. Reorder the title fallback; drop the description fallback. (§2, §3)
3. Emit a self-referencing path-only canonical. (§4)

**High**

4. Build the admin panel — the four fields with live character counters against
   the convention's budgets. Without this, 1-3 are a better set of defaults and
   nothing more. (§6)
5. Emit published `/go/` URLs in the sitemap, honouring `noindex`. (§5)
6. Write real copy for the one published step. (§2, §3)

**Done after the first pass, on the same branch**

10. **A generated share card.** `og_image_url` stays NULL and
    `/og/funnel/<slug>` draws a 1200x630 typographic card from the step's own
    title. fal is wired in this repo (`@fal-ai/client`; blog heroes already go
    through `flux-pro`) and could draw a photographic one instead — that was
    considered and deliberately not taken. A generated photograph of an athlete
    on the share card of a business whose proof is real, named athletes is a
    claim the brand does not need to make, and a static image would have to be
    produced once per funnel forever. A photographic backdrop remains available
    as a follow-up.

**Worth doing next, not in this pass**

7. **The orphan-page problem is not fixed by the sitemap.** Nothing on the
   marketing site links to `/go/athlete-quiz`. A sitemap entry makes it
   discoverable to a crawler; an internal link is what actually passes
   authority. Worth a link from `/assessment` or the blog.
8. **No structured data on funnel pages.** The marketing routes carry JSON-LD;
   `/go/` pages carry none. A quiz funnel is a reasonable `WebPage` at minimum.
   Deliberately out of scope here — the compiled document is frozen at publish
   time, so page-level JSON-LD wants its own decision about where it lives.
9. **`noindex` policy for thank-you / confirmation steps.** The convention doc
   says booking confirmations should be `{ index: false, follow: false }`.
   Nothing applies that to funnel steps automatically. Now that the toggle has
   a UI, it is a decision the owner can make per step — but a default worth
   revisiting.

---

## What was checked and found healthy

- `robots.txt` is correct and does not block `/go/`.
- The sitemap is referenced from `robots.txt` and returns 200.
- HTTPS throughout, `www` canonical host, no mixed content on the funnel page.
- The layout template (`%s | DJP Athlete`) applies to `/go/` pages, so a
  page-level title must not repeat the brand — it does not.
- `metadataBase` is set, so path-only canonicals and relative OG images resolve.
- The `noindex` column is already wired to Next's `robots` field and works; it
  had simply never been set.
