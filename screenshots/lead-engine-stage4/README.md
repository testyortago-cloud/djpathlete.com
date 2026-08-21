# Lead Engine Stage 4 (Spine) — Task 3, captured from the running app

Captured 2026-08-21 by driving the real app with Playwright against branch
`feat/lead-engine-stage4-spine`, dev server on `localhost:3050`, against the
**dev** Supabase project (`anjvztjiokcgiyhobknq`) — never production. No row
in the clone database was written or modified to take these shots (light
mode, per the task brief).

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
