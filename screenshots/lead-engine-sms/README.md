# Lead Engine Stage 2 (SMS) — Task 6, captured from the running app

Captured 2026-08-21 by driving the real app with Playwright against branch
`feat/lead-engine-stage2-sms`, signed in through the dev-login bypass, against
the **dev** Supabase project (`anjvztjiokcgiyhobknq`) — never production. No
row in the clone database was written or modified to take this shot.

| File                 | What it shows                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `funnel-consent.png` | `/go/test/index` — the real funnel page, real `NodeRenderer` → `FormIsland` → `FunnelForm` render chain, phone field + the new SMS consent checkbox |

## Why this is `/go/test/index?preview=1`, not a bare `/go/test/index`

The only funnel in the clone database (`test`) has `funnels.status = "draft"`,
so an unauthenticated visit to `/go/test/index` 404s (`getPublishedStep`
refuses any funnel whose status isn't `"published"` unless the caller passes
`includeUnpublished`). `?preview=1` plus an admin session is the funnel page's
own preview gate — same route file
(`app/(funnel)/go/[slug]/[[...step]]/page.tsx`), same live components, same
compiled markup a real visitor would get, just without the funnel-status
check. Signed in via `/api/dev/login` (gated on `DEV_AUTH_BYPASS_ENABLED=true`
in `.env.local`, dev-only, 404s in production) in the same browser context so
the session cookie carries to the page load.

Confirmed this is not a meaningfully different code path: the `index` step's
`funnel_steps.published_version_id` is set, so `getPublishedStep` reads that
exact published `funnel_step_versions` row regardless of the preview flag —
the page renders byte-identical markup to what a real visitor would see if
`funnels.status` were flipped to `"published"`.

## A finding, not a bug in this task: the form on this page is unstyled

The screenshot shows every control on the form — not just the new checkbox —
with no border, no padding, labels and inputs running together. This is
**not** something Task 6 introduced. Direct inspection of this step's frozen
`funnel_step_versions.css` (22KB) confirms it contains **zero** occurrences of
`.djp-form`, `.djp-field`, or `.djp-control` — the CSS was compiled and
published before the form-control styling pass existed in `styles.ts`
(see the block comment at the top of `FunnelForm.tsx`). Per
`[[published-funnel-css-is-frozen]]`: a step's CSS is baked in at publish
time and only changes on that step's _own_ next re-publish — there is no
cache to blame, and nothing short of a re-publish fixes it. This repo's
`.env.local` points at a database this task was told not to write to, so
that re-publish wasn't done here.

**What this confirms for Task 6's own change:** the SMS consent checkbox
reuses the exact `.djp-field[data-djp-field-type="checkbox"]` markup an
ordinary checkbox-type field already renders (see `FunnelForm.tsx`), so it is
styled — or unstyled — exactly the same way every other checkbox on this same
form already is. It picks up whatever CSS a given published step has, with
zero new funnel-doc CSS of its own, on every existing live funnel with a
`tel` field, with no re-publish required for the _markup_ to appear. A
funnel published after this branch's styles.ts (unrelated to Task 6) ships
would show a properly boxed control; one published before it — like this
test fixture — won't, and neither will its sibling fields.

## Another pre-existing condition visible in the wording

`business_settings.display_name` is seeded `''` in this clone (confirmed via
`node scripts/dev-db-query.mjs business_settings "business_id,display_name"`),
same default noted in `screenshots/lead-engine-stage1c/README.md` for the
pipeline pages. `renderSmsConsentWording` (`lib/lead-engine/sms-consent-wording.ts`)
has no fallback — its contract in the Task 6 brief is an exact string with
`{displayName}` substituted, nothing more — so with a blank `display_name` the
line reads "I agree to receive text messages from about my inquiry." (HTML
collapses the resulting double space to one, so it isn't as visibly broken as
the `'s pipeline` bug that README documents, but the sentence still reads as
missing a name). Filling in `business_settings.display_name` is an ops step,
not a code fix; flagged here for whoever runs the go-live checklist.
