# Athlete Test Report — design

**Date:** 2026-08-06
**Status:** approved (owner approved the section walkthrough, then went to bed — remaining
judgment calls were made under the autonomous-mode rules and are listed in §12)

## 1. Problem

Darren hands prospects a 3-page PDF (`Test Report Example.pdf` in the repo root) produced by
two external services — Speed Solutions 3D sprint analysis and VALD ForceDecks. It is the best
sales artifact he has: dark editorial layout, KPI tiles, left/right asymmetry callouts,
percentile benchmarks, status pills, and a coaching cue written from the athlete's own numbers.

He wants the same artifact for DJP Athlete clients, in DJP branding, generated from the app —
**focused on testing, not on the exercise program**.

The app already has a public athlete share page at `/athlete/<token>` (the "Full Arena" card).
It is a training-highlight reel: streaks, total volume, badges, current program, career
programs. That is the wrong emphasis for this artifact, and Darren wants it kept for himself
inside admin rather than shared with clients.

## 2. Decisions taken (owner-answered)

| # | Question | Decision |
|---|---|---|
| 1 | Where do the numbers come from? | **Both, phased.** Phase 1 renders only data the app already stores. The layout is shaped from day one to accept external bilateral/percentile fields; phase 2 adds that data model. |
| 2 | What happens to the Arena card? | **Moves behind admin login.** No longer publicly reachable. |
| 3 | Snapshot or living page? | **Living page**, always current, with an "as of" date in the header. |
| 4 | Audience and candor? | **Athlete/parent-facing, candid but constructive.** Strengths *and* weaknesses with status pills and a coaching cue. No injury history, no internal notes, no medical language. |
| 5 | Structure? | **Paged web report that prints 1:1** — three full-bleed pages on screen, and Save-PDF outputs exactly those three pages. |
| 6 | Old links? | **Reuse `/athlete/<token>`** and the existing token family. Every link already sent silently upgrades to the new report. |
| 7 | Coaching cue? | **Deterministic cue library** keyed by (category × band). Free, instant, identical on every render, unit-testable, editable in one file. |

## 3. Scope

**In scope (phase 1)**

- A new public test report at the existing `/athlete/<token>` URL.
- The Arena card relocated to an admin-only route, unchanged in content.
- Repointing the three call-sites that link to the old public card.
- Pure scoring + cue modules with full unit coverage.

**Out of scope (phase 1)**

- Any new table, column, migration, or feature flag. Phase 1 is **zero-migration**.
- External testing data entry/import (that is phase 2, sketched in §10).
- AI-generated copy of any kind.
- Changing how tests are logged.

**Explicitly excluded from the report content** — this is the "testing not exercise" line:
current program & week, career programs, badges, milestones, training-load chart, total lifted
volume, workout streak, and `Weight PR!` achievements derived from workout logs. All of those
stay on the admin Arena card.

Note the boundary: `bench_press_1rm` / `back_squat_1rm` / `deadlift_1rm` **are** performance
tests and stay in the report. Lifting PRs inferred from logged workout sets do not.

## 4. Architecture

### 4.1 Routing

```
/athlete/<token>                       PUBLIC  → NEW test report   (token + verify unchanged)
/admin/clients/[id]/arena              ADMIN   → existing Arena card (moved, not rewritten)
```

`lib/profile-share/token.ts` is **not touched**. Same `ap.` token family, same HMAC, same
permanence, same revocation story (rotate `NEXTAUTH_SECRET`). The route's `verifyAthleteProfileToken`
call is unchanged; only the component it renders changes. This is what makes already-shared
links upgrade instead of breaking.

`lib/profile-share/data.ts` also stays exactly as it is — it remains the Arena card's data
layer, now consumed from admin.

### 4.2 New modules

| Path | Kind | Responsibility |
|---|---|---|
| `lib/test-report/scoring.ts` | pure | Category scores, bands, deltas, reference-range position. |
| `lib/test-report/cues.ts` | pure | Cue library + selector. |
| `lib/test-report/data.ts` | I/O | `getTestReportData(clientUserId)` — assemble and scrub. |
| `components/public/report/TestReport.tsx` | RSC | Composes the three pages. |
| `components/public/report/ReportCover.tsx` | RSC | Page 1. |
| `components/public/report/ReportHeadline.tsx` | RSC | Page 2. |
| `components/public/report/ReportVerdict.tsx` | RSC | Page 3. |
| `components/public/report/panels/*.tsx` | RSC | KPI tile, score bar, band card, range bar, cue block, page chrome. |

Scoring and cues are pure by design: no Supabase import, no `Date.now()` in the signature (an
`asOf` is passed in). That is what makes them exhaustively testable without fixtures.

### 4.3 Component relocation

`components/public/athlete/**` → `components/admin/arena/**` (16 files, mechanical move).
The directory name `public/` becomes a lie once the card is admin-only, and CLAUDE.md
organizes components by audience.

The `.athlete-arena` CSS scope in `app/globals.css` **keeps its class name** — it is the
canonical DJP dark-document scope and the new report applies it too, so the palette is defined
once and both documents inherit it. The report layers a `.test-report` class on top for its
own page/print rules. No token values are duplicated.

## 5. Scoring

All scoring wraps the existing `normalize(testType, value, bodyWeightKg)` from
[`lib/coach-intel/test-normalization.ts`](../../../lib/coach-intel/test-normalization.ts).
**No new scoring math is invented** — that function already encodes Darren's reference ranges
and, importantly, already handles direction (sprints improve downward) and bodyweight-relative
1RMs.

- **Test score** — `normalize()` of the athlete's *latest* value for that test type, 0–100.
- **Category score** — the mean of available test scores in that category, rounded. Categories
  are the existing `RADAR_CATEGORIES` (Speed, Power, Strength, Endurance, Mobility).
- **Athlete score** — the mean of available *category* scores, rounded. Averaging categories
  rather than raw tests stops an athlete with six sprint tests and one jump from having a score
  that is really just a sprint score.
- **Bands** — `>= 65` STRENGTH, `40–64` DEVELOPING, `< 40` PRIORITY. Exported as named
  constants with boundary tests.

**Exclusions that must stay visible, not silently vanish:**

- `custom` tests have no reference range → excluded from every score, but still **listed** on
  page 3 with value, unit, and date, and no score or range bar.
- 1RM tests with no `body_weight_kg` → `normalize()` returns null → excluded from scoring, still
  listed.
- A category with zero scorable tests is omitted from the bars and the chip row entirely.

**Delta vs previous** uses the stored `pct_change_from_prev` where present. Direction of
*goodness* comes from `testDirection(testType)`: for a `lower`-is-better test a negative pct
change is an **improvement**. Getting this backwards would tell an athlete their improving
sprint is a decline, so it gets an explicit test per direction.

## 6. The three pages

### Page 1 — Cover

Eyebrow `DJP ATHLETE · PERFORMANCE TESTING REPORT`. H1 is the athlete's name. Sub-line is
sport · position · age. Body paragraph states the report's premise (every number is a logged,
dated test). Three numbered stat lines in the reference's exact style, all derived:

- `N` tests logged across `M` categories
- `N` personal bests
- `N` months of tracked testing history

The reference's stock action photo becomes the athlete's `avatar_url`, degrading to a branded
gradient panel when absent. Footer rule: *Report for: **Name**, Sport · <as-of date>* and
*Prepared by **Darren Paul**, Performance Coach*.

### Page 2 — "The Headline Numbers"

Three KPI tiles: **Athlete Score /100**, **Strongest — <category> <score>/100**,
**Focus — <category> <score>/100**.

- **Where you're strong and where you're not** — one horizontal bar per scorable category
  (mirrors the reference's "Where time is won or lost"), plus one derived sentence naming the
  gap between the best and worst category.
- **Category breakdown** — up to three accent-topped cards, each with score, a band pill
  (STRENGTH / DEVELOPING / PRIORITY), and a line naming the tests behind the score. Selection:
  the strongest, the weakest, and the next-weakest, **de-duplicated by category** — with two
  scorable categories only two cards render, with one only one.
- **Movement since last test** — occupies the reference's "Rehab & Asymmetry" slot. Phase 1
  shows the single largest improvement *or* decline as a large percentage callout, tinted with
  the accent for a gain and the error token for a decline. ▸ *Phase 2 pairs this with true L/R
  asymmetry.*
- **Category chip row** — the reference's "seven angles" strip, with scorable categories active.
- **Coaching cue** — the quote block, captioned "generated from this athlete's own test scores".

### Page 3 — "The Full Verdict"

Up to four KPI tiles of headline test values (`45.7cm CMJ · PR`, `3.02s 20m Sprint`, …),
sub-captioned with the test's own score. Selection is **the four most recently tested test
types, newest first** — one tile per test type, so a type tested five times occupies one slot.
Fewer than four scorable types renders fewer tiles; the row is omitted at zero.

- **Test by test** — a card per test type: latest value + unit, delta vs previous with a
  correctly-directed arrow, PR badge, sparkline of history, and a **position bar** showing where
  the value sits inside its reference range. Labelled *reference range* — never "percentile",
  because the app has no population data and claiming one would be a fabricated number.
  ▸ *The range-bar component accepts optional `left`/`right` values from day one, so phase 2's
  bilateral dots and asymmetry pill drop in without a rewrite.*
- **Assessment batteries** — completed `performance_assessments` with title, date, and items.
- **Closing synthesis** — a derived sentence naming the weakest category and the constructive
  action, then the signature block (Darren Paul — Performance Coach, darren@darrenjpaul.com).

## 7. Coaching cues

`lib/test-report/cues.ts` exports a `Record<RadarCategory, Record<Band, string>>` — 15 hand-written
cues. The selector picks the athlete's **weakest scorable category** and returns that cue; ties
break by a fixed category order so the output is deterministic.

A test asserts every (category × band) pair resolves to a non-empty string, so adding a category
to `RADAR_CATEGORIES` later fails loudly instead of rendering an empty quote block.

## 8. Privacy and scrubbing

The page is public to anyone holding the link, so the data layer returns a **projection**, never
raw rows — the same discipline already documented in `lib/profile-share/data.ts`.

Never present in the payload: `notes`, `video_url`, `created_by`, `client_user_id`,
`admin_notes`, `youtube_url`, `video_path`, assessment message threads, injuries, email, or date
of birth (age only, via the existing `computeAge`).

`robots: { index: false, follow: false }` stays on the route. Assessment batteries are filtered
to `status === "completed" && !is_template`, matching the existing rule.

Access control is unchanged and inherited: `getTestReportData` returns null unless the user
exists, has `role === "client"`, and `status === "active"` — deactivating a client kills every
link they have.

## 9. Degradation

The dominant failure mode for a premium document is rendering it empty. Rules:

- **Zero performance tests** → the report renders the cover plus a single honest "No tests logged
  yet" state. It does not render three skeletal pages.
- **Any panel with no data is omitted entirely**, never rendered empty (existing rule in
  `data.ts`: *"an empty panel reads as broken, not premium"*).
- **Only one scorable category** → the comparison bar section is dropped (there is nothing to
  compare), the KPI tiles collapse to Athlete Score + that category.
- **The admin share dialog warns** when the athlete has fewer than three logged tests, so Darren
  doesn't send a thin report by accident.
- Every data source is `Promise.allSettled`-guarded and fails soft to an empty section, matching
  the existing assembly.

## 10. Phase 2 sketch (not built now)

A `test_report_metrics` table keyed by (client, test date, metric): `value`, `unit`,
`left_value`, `right_value`, `percentile`, `source` (`vald_forcedecks | speed_solutions | manual`),
with an admin entry form and CSV import. On arrival:

- the **Movement since last test** slot gains the asymmetry callout,
- the range bars gain their second dot and asymmetry pill,
- a benchmark card row can appear on page 3.

The phase-1 components are shaped for this: the range bar already takes `left`/`right`, and the
page-3 grid already lays out four cards per row.

## 11. Testing

Per the repo's dominant defect class (tests that pass without verifying their claim), every test
below gets a mutation probe — break the implementation, confirm the test fails, restore.

**Pure units (no fixtures needed):**
- band boundaries at exactly 39/40/64/65
- `lower`-is-better direction: a faster sprint reads as an improvement
- bodyweight-relative 1RM with and without `body_weight_kg`
- `custom` test excluded from scores but present in the listing
- category with no scorable tests omitted from bars, chips, and the athlete score
- athlete score averages *categories*, not tests (the six-sprints case)
- every (category × band) resolves to a cue

**Data layer:** assert the returned object has no `notes` / `video_url` / `created_by` key at
any depth; non-client and inactive users return null; a throwing source degrades to an empty
section rather than failing the page.

**Components:** panels omit rather than render empty; PRIORITY pill renders for a low band;
the range bar renders two dots when given `left`/`right` (the phase-2-ready path, tested now).

**Routes:** `/athlete/<valid token>` renders the report; an invalid token 404s; the admin arena
page is unreachable without an admin session.

**Gates:** targeted `vitest` runs for the touched suites plus `npm run build`. Not the full
suite — per the standing instruction, and nothing here is cross-cutting.

## 12. Judgment calls made without the owner

1. **Band thresholds 65 / 40** — the reference uses STRENGTH/DEVELOPING/PRIORITY without
   publishing its cut-points. These are exported constants and trivially retunable.
2. **Athlete score averages categories, not tests** — prevents a lopsided test history from
   producing a misleading headline number.
3. **"Reference range", not "percentile"** — the app has no population data. Borrowing the
   reference's percentile language would be inventing a statistic.
4. **Components move to `components/admin/arena/`** rather than staying under `public/`.
5. **Phase 1 is zero-migration** — the whole report derives from existing tables.
6. **The dark presentation carries into print**, matching the reference PDF and the existing
   `.athlete-arena.print-document` rule.
