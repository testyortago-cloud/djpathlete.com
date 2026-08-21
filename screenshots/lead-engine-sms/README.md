# Lead Engine Stage 2 (SMS) — Task 6, captured from the running app

Captured 2026-08-21 by driving the real app with Playwright against branch
`feat/lead-engine-stage2-sms`, signed in through the dev-login bypass, against
the **dev** Supabase project (`anjvztjiokcgiyhobknq`) — never production. No
row in the clone database was written or modified to take this shot.

**Re-taken after code review.** The first capture showed the checkbox
rendered with a malformed sentence ("...from about my inquiry") because
`business_settings.display_name` is blank in this database. Review flagged
that as consent evidence with a hole in it; the fix makes a blank or
unreadable business name suppress the checkbox entirely, and this screenshot
is from after that fix — see "The fix, and why the shot changed" below.

| File                 | What it shows                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `funnel-consent.png` | `/go/test/index` — the real funnel page, real `NodeRenderer` → `FormIsland` → `FunnelForm` render chain, phone field with **no** SMS consent checkbox (see below) |

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

## The fix, and why the shot changed

`business_settings.display_name` is seeded `''` in this clone (confirmed via
`node scripts/dev-db-query.mjs business_settings "business_id,display_name"`),
same default noted in `screenshots/lead-engine-stage1c/README.md` for the
pipeline pages. The first version of this task fed that straight into
`renderSmsConsentWording` with no fallback, so the checkbox rendered next to
"I agree to receive text messages from about my inquiry." — a sentence that
cannot name who is texting. Code review caught two Medium findings on this:
the same gap also meant a FAILED `business_settings` read rendered the
checkbox too (the code substituted `""` and the comment claimed "no
checkbox" without the code doing that), and — more seriously — a
successfully-configured business name at page-render time could still go
blank before the submit request landed (or vice versa), so the row filed
could carry different wording than what the checkbox actually showed.

**The fix:** `hasSmsConsentDisplayName` (`lib/lead-engine/sms-consent-wording.ts`)
is now the one gate both sides check. `FormIsland.tsx` shows the checkbox
only when a settings read succeeds AND `display_name` is non-blank —
anything else (a failed read, or a blank/whitespace name) renders no
checkbox at all, the same "no pixel" outcome. The submit route re-checks the
same thing at write time and skips the consent row (logging why) even if
`sms_consent` came in `true` — the lead capture is unaffected either way.

This screenshot is from **after** that fix, against the same still-blank
`display_name` (never written to — this task doesn't touch the clone DB), so
it now shows the honest state for an unconfigured install: the phone field
renders, and there is no checkbox beneath it. The annotation marks where the
checkbox would have appeared. Filling in `business_settings.display_name` is
still the ops step that turns the checkbox back on; it's just no longer
possible to collect consent with a name-shaped hole in it while that's
unset.
