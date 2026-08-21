# Lead Engine Stage 4 (Spine) — Task 3, captured from the running app

Captured 2026-08-21 by driving the real app with Playwright against branch
`feat/lead-engine-stage4-spine`, dev server on `localhost:3050`, against the
**dev** Supabase project (`anjvztjiokcgiyhobknq`) — never production. No row
in the clone database was written or modified to take these shots (light
mode, per the task brief).

**Re-taken after task review.** The first capture drew the caption band as a
fixed overlay on top of the live page, which hid the "How did you hear about
us?" label and the submit button underneath it. This version captures the
annotated form and the caption band as two separate images (`sharp`
composites them vertically) so the band extends the canvas below the form
instead of covering any of it — nothing in the screenshots below is hidden
by its own caption anymore. The capture viewport also grew from 900px to
1000px tall so the submit button is actually in frame on both pages, not
just no-longer-covered.

| File                        | What it shows                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `inquiry-form-camps.png`     | `/camps` — the real "Apply for a spot" `InquiryForm`, phone field, with **no** SMS consent checkbox (see below)                            |
| `step-up-inquiry-form.png`   | `/step-up-for-students` — the real "Book Your Consultation" `StepUpInquiryForm`, phone field, with **no** SMS consent checkbox (see below) |

Both pages are public marketing pages — no auth, no preview gate, no dev
bypass needed. What's rendered is exactly what a real visitor gets.

## Why neither screenshot shows the checkbox

Same situation `screenshots/lead-engine-sms/README.md` documented for the
funnel form: `business_settings.display_name` is blank in this clone
(confirmed via `node scripts/dev-db-query.mjs business_settings
"business_id,display_name"` — `""`). `InquiryForm.tsx` and
`StepUpInquiryForm.tsx` (the new async server wrappers this task adds) fetch
`getBusinessSettings()` and gate on `hasSmsConsentDisplayName` — the same
function `app/api/inquiry/route.ts` checks server-side before filing a
consent row — so a blank name suppresses the checkbox on the page exactly as
it suppresses the write on submit. This task doesn't touch the clone
database (never writes to it), so both shots show the honest,
unconfigured-install state: the phone field renders, nothing renders below
it. The dashed red box in each screenshot marks where the checkbox would
appear once `business_settings.display_name` is set — its width matches the
real element it would replace: the same full-width row the checkbox actually
occupies below the phone/service (or phone/age) grid, not the phone input's
own half-width column.

Filling in `business_settings.display_name` is the ops step that turns the
checkbox on for both forms (and for the funnel form from Stage 2) at once —
all three read the same gate.

## Two capture wrinkles, worth recording

**`<FadeIn>` (framer-motion, `whileInView`) had to be waited out, not
skipped.** Both forms sit inside a `FadeIn`-wrapped section
(`components/shared/FadeIn.tsx`), which starts at `opacity: 0` and reveals
via an `IntersectionObserver` once scrolled into view — a real ~0.6s+
animation, not an instant toggle. A jump-scroll (`scrollIntoView`) plus a
short fixed wait isn't reliable: on `/step-up-for-students` the first capture
attempt landed before the observer had even fired, producing a screenshot
with a fully blank right-hand column (the form existed in the DOM —
`boundingBox()` and `isVisible()` both confirmed it — it just hadn't faded in
yet). The fix: scroll, then wait 1.5s for the animation to actually finish on
its own, then force-settle anything still not at full opacity as a last
resort immediately before the screenshot (so nothing has a chance to
re-animate in the gap).

**Next.js's own dev-mode indicator (`<nextjs-portal>`, the black "N" badge,
bottom-left) is hidden before capture** — dev-only framework chrome, not
part of the app or this feature, and not present in production. Removed in
the capture script itself, never in app code, same rule the house recording
standard applies to debug buttons and quick-login panels.

## Not a re-shoot: consistent with the honest-state precedent

Per the task brief, the correct capture here is the *honest* current state
of an unconfigured install, not a synthetic "what it would look like"
render — mutating `business_settings.display_name` in the clone to force the
checkbox on was explicitly out of scope (never write to the clone). The
placeholder annotation communicates the same thing
`screenshots/lead-engine-sms/funnel-consent.png` did for the funnel form:
exactly where the control would sit, and why it doesn't today.

---

# Task 4 — event signup joins the spine: no live event to screenshot it against

Captured 2026-08-21, same setup as Task 3 above: Playwright against the real
running dev server (`localhost:3050`, branch `feat/lead-engine-stage4-spine`),
the **dev** Supabase project (`anjvztjiokcgiyhobknq`), light mode. No row in
the clone database was written or modified to take these shots.

| File                             | What it shows                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `event-detail-404-annotated.png`  | `/camps/hi-performance-soccer-camp` — the real "We couldn't find that page" not-found page, live right now |
| `camps-coming-soon-annotated.png` | `/camps`'s real "Upcoming sessions" section — the real `EventsComingSoonPanel` empty state, live right now  |

## Why there's no screenshot of the modal itself

The task brief asks for "the modal on a real event page" but, failing that,
"the closest reachable state, honestly labeled" — this clone needed the
fallback. Queried directly (`node` against the dev Supabase project):

```
draft   clinic  /clinics/hi-performance-soccer
draft   camp    /camps/hi-performance-soccer-camp-copy
draft   camp    /camps/hi-performance-soccer-camp
```

All three events seeded in this clone are `status: "draft"`.
`app/(marketing)/camps/[slug]/page.tsx` and `.../clinics/[slug]/page.tsx`
both call `notFound()` for anything that isn't `"published"` — that check
runs *before* `EventSignupCard` (and therefore `EventSignupModal`) is ever
mounted, so there is no live link anywhere on the site that opens the modal
right now. `/camps` itself (`camps-coming-soon-annotated.png`) confirms the
same thing from the other direction: `getPublishedEvents()` returns zero
rows, so the page renders its real "Coming Soon" empty state instead of any
`EventCard`.

Flipping one event's `status` to `"published"` would have made the modal
reachable, but the task brief is explicit: **never write to the clone.** No
exception was made for a temporary/revertable write — so this is the honest
closest-reachable state instead of a manufactured one.

Worth noting for whoever eventually does capture the modal live: even with a
published event, the new SMS consent checkbox specifically would still not
render in *this* clone, for the same reason Task 3's screenshots show no
checkbox on the inquiry forms — `business_settings.display_name` is blank
here (see Task 3's section above), and `EventSignupModal` renders no
checkbox at all when `smsConsentWording` is `undefined` (same
`hasSmsConsentDisplayName` gate, now checked in
`app/(marketing)/camps/[slug]/page.tsx` /
`app/(marketing)/clinics/[slug]/page.tsx` before the prop is even passed
down through `EventSignupCard`). Both blockers — no published event, and no
configured business name — are independent of each other and would each
need to be resolved before the checkbox can be captured live.

## Two things confirmed live, not assumed

- **The specific draft slug 404s.** `event-detail-404-annotated.png` was
  captured by navigating straight to a real draft event's own detail URL —
  not inferred from the DB row's `status` column. (This dev server reports
  the response as HTTP 200 rather than 404 for this route, confirmed via
  `curl` — a Next.js/Turbopack dev-mode quirk unrelated to this task — but
  the rendered page, checked via the body text, is the real not-found page,
  the same one a visitor hitting any broken link on the site would see.)
- **The sticky "Apply for coaching" CTA** (`components/public/StickyApplyCTA.tsx`)
  appears on `/camps` after scrolling past 800px and is not on that
  component's hide-list for this route — the capture script checked for it
  (`getByRole("button", { name: "Dismiss" })`) and dismissed it via its own
  close button before the "Coming Soon" shot, per the task brief, since it
  can overlap the section being captured.
