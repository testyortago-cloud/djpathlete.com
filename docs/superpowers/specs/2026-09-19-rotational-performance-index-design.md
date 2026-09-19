# The Rotational Performance Index — design

Date: 2026-09-19
Status: approved to build (owner granted full autonomy on 2026-09-19)

Source documents:

- "LEAD MAGNET — FUNNEL INTO ROTATIONAL REBOOT" (Google Doc `1m-v1Hccrf…`) — the
  scoring system: 5 movement tests + 4 questions. **This is what we are building.**
- "The Architecture" (Google Doc `1B1Mb81GiBib…`) — an 11–12 question branched quiz
  with an 8-row offer-routing table. **Not this build.** Its routing table names
  Rotational Reboot as one destination, so the two sit at different points in the
  funnel: this quiz is the top-of-funnel magnet, that one is the qualifier.

## 1. Why this exists

`rotational-reboot-score` is a draft quiz wired to a Quiz → Offer → Checkout →
Confirmation funnel. Its contents are a **clone of the athlete quiz** — four
avatar branches, ceiling-breaker questions, generic tier copy, and not one
movement test. The funnel promises a movement index and would deliver a
questionnaire about training structure.

This replaces that quiz's contents with the design the scoring doc describes.

## 2. What the scoring doc gets wrong, and the corrections

These are the defects found in review, and what this build does instead.

### 2.1 The floor is not zero

As written every movement test scores minimum 1, so a person who cannot perform
a single movement still scores 8/26 = **31%**. The bottom third of the scale is
unreachable and RED collapses to three raw totals.

**Correction:** every scored question gains an honest zero. Movement tests get a
fourth option — "I couldn't do it at all" — which is also simply true: some
people cannot hold a Copenhagen. Scale runs 0–100 as the tier bands assume.

### 2.2 Q2 is scored inside-out

> After a heavy session, where do you feel it most? — Lower back (3), Hips (3),
> Core (3), Shoulders (2), I feel fine (1)

Everywhere else higher = healthier, and `scoreQuiz` normalises so that green =
"well prepared". As written, the athlete who feels fine after competition is
scored the most compromised. Three options also share the value 3, so the
question carries one bit of information dressed as four.

**Correction:** Q2 becomes **segmentation** (all weights 0, the documented
marker in `lib/quizzes/types.ts`). It is diagnostic colour, not quality, and it
is worth far more as results-page copy — "you told us you feel it in your lower
back; that is a rotational problem, not a back problem" — than as two points.

### 2.3 "Out of 30" reconciles with nothing

5 tests × 3 = 15. Everything together = 26. Neither is 30. The figure is a
throwaway in the doc ("eg 30 points") and the engine normalises to 0–100 anyway,
so the raw maximum is invisible to the visitor. **We do not contort the design
to hit it.** Raw max lands at 33; see §4.

### 2.4 Asymmetry is the pitch and the scoring discards it

Prone hip abduction, Copenhagen, retro hop and windshield wipers all have a real
left/right. One score per test throws that away — and left-vs-right is the most
compelling thing this battery can tell someone.

**Correction:** the four tests that have a side are asked **once per side**.
Rocking hollow is sagittal and has no side, so it is asked once. Nine scored
movement questions.

### 2.5 Self-grading inflates toward green

The athlete grades themselves on "no compensations", but the person with poor
control is the least able to see their own compensation. Everyone marks a 3,
lands in green, and the CTA has nothing to push against.

**Correction, and it came from the footage rather than the doc:** every clip
ends with a *"compensations include…"* section where Darren demonstrates each
wrong version. The option labels are therefore written **in his own words from
the transcripts**, naming the specific compensation rather than asking for a
self-judgement. Showing that footage beside the options is a deferred follow-up
(§7) — the labels alone already do most of the work.

## 3. Structure

### 3.1 The branch, and why there is one at all

`lib/quizzes/gate.ts` refuses to activate a quiz with no router question, and
refuses a branch with no questions. The scoring doc describes a flat quiz, so it
cannot be activated as written.

Rather than weaken a safety gate for one quiz, the router is the **sport**, and
each branch carries the doc's Q1 re-voiced in that sport's language. This is the
same device the athlete quiz already uses for its parent/coach branch — same
question, different words — and it earns its keep: "when you swing" reads as
written-for-me where "when changing direction or rotating quickly" does not.

| Branch key | Covers | Q1 voiced as |
|---|---|---|
| `racquet` | tennis, pickleball, padel, squash | "when you swing or push off for a wide ball" |
| `golf` | golf | "through the downswing and into follow-through" |
| `throwing` | baseball, softball, cricket, quarterback | "when you throw or swing hard" |
| `field_court` | soccer, rugby, hockey, lacrosse, basketball | "when you cut or change direction at speed" |
| `other` | everything else, incl. combat | "when you rotate or change direction quickly" |

`other` is a genuine catch-all so no visitor is stranded by the router.

### 3.2 The walk

Position numbering is global across the quiz (`score.ts` sorts on it), so shared
and branch questions interleave by number.

| Pos | Question | Branch | Scored |
|---|---|---|---|
| 10 | Which sport? (router) | — | no |
| 20 | Q1 — instability when rotating, sport-voiced | each | **0–3** |
| 30–110 | 9 movement tests (see §3.3) | — | **0–3 each** |
| 120 | Q3 — how often you train rotation specifically | — | **0–3** |
| 130 | Q2 — where you feel it after a heavy session | — | no (segmentation) |
| 140 | Q4 — which area best describes you | — | no (profile vote) |

Twelve screens plus the router. The movement tests dominate the time, and that
is the product.

### 3.3 The nine movement questions

Each carries `media_url` (silent demo loop) and `media_poster_url`.

| Pos | Test | Sides | Clip |
|---|---|---|---|
| 30, 40 | Prone hip abduction with external rotation | L, R | `1-prone-hip-abduction.mp4` |
| 50 | Rocking hollow | — | `2-rocking-hollow.mp4` |
| 60, 70 | Short lever Copenhagen (90-90 hold) | L, R | `3-short-lever-copenhagen.mp4` |
| 80, 90 | Windshield wipers | L, R | `4-windshield-wipers.mp4` |
| 100, 110 | Retro backwards hop | L, R | `5-retro-backwards-hop.mp4` |

Both sides of a test share one clip — the movement is the same, the side is not.

Options, every test, weights **3 / 2 / 1 / 0**:

1. All three points, no compensation — 3
2. Two of the three — 2
3. One of the three, or a real struggle — 1
4. I couldn't do it at all — 0

Points 1–3 are named per test from the transcripts. Prone hip abduction, for
example: foot rotated outwards · hip stays down, pelvis does not rotate · whole
leg stays off the ground.

## 4. Scoring

| Source | Items | Max each | Max |
|---|---|---|---|
| Movement tests | 9 | 3 | 27 |
| Q1 instability | 1 | 3 | 3 |
| Q3 rotational training frequency | 1 | 3 | 3 |
| Q2, Q4, router | 3 | 0 | 0 |
| | | | **33** |

Minimum 0. `normalise()` turns it into 0–100, so branches of differing length
stay comparable — the reason the engine has never used a raw total.

Bands keep the doc's four names, and keep the athlete quiz's cutoffs so a colour
means the same thing across both quizzes:

| Tier | Band | Headline |
|---|---|---|
| `red` | 0–39 | High compensation and disconnection |
| `orange` | 40–59 | Movement inefficiencies limiting performance |
| `yellow` | 60–79 | Potential performance leaks |
| `green` | 80–100 | Good rotational connection and control |

Red and orange alert the operator and open a pipeline card — `shouldAlert` and
`decideMove` already own that rule and are not touched.

Profiles reuse the five already seeded (`explosive_but_tight`, `mobile_but_weak`,
`struggle_in_transitions`, `strong_but_slow`, `not_sure` at position 0 as the
no-vote fallback), which is exactly what the doc's Q4 asks for.

## 5. The media field

One migration adds two nullable columns to `quiz_questions`:

- `media_url text` — the demo clip
- `media_poster_url text` — the poster frame

Threaded through the eight sites `help_text` already travels: `lib/quizzes/types.ts`,
`lib/db/quizzes.ts` (read, structural read, save shape, insert, patch),
`lib/quizzes/public-definition.ts`, `components/funnels/islands/QuizRunner.tsx`,
`components/admin/quizzes/QuizEditor.tsx`, `app/api/admin/quizzes/[id]/route.ts`,
and the seed.

`publicQuizDefinition` copies every field explicitly and must keep doing so — a
field added to `QuizQuestion` next year should be invisible to the browser until
somebody adds a line. Media is safe to ship (it is the point), weights are not.

Hosting: `quiz-media/{quizKey}/{fileName}` in Firebase Storage, public by
`storage.rules`, durable Firebase download URL. Same constraint and same answer
as `lib/funnel-storage.ts` — a signed URL expires and leaves the visitor grading
a movement they cannot see. Helper in `lib/quiz-media-storage.ts`, uploader in
`scripts/upload-quiz-media.ts`.

**One Firebase project.** `.env.local` and `.env.prod` both name `darrenjpaulcom`.
There is no dev/prod split for storage; every upload is a live-bucket write.

## 6. Deliberately not done

- **Publishing.** The funnel stays draft. Owner's call.
- **Merging `storage.rules` to main.** That auto-deploys to the live Firebase
  project via `deploy-firebase-rules`. The clips return 403 until it lands,
  which is the correct state for an unmerged branch.
- **Touching the athlete quiz.** It is `active`, and its live question set has
  drifted from its seed (4 questions deleted, 2 deactivated). Restoring them
  would silently change what every future score means. Flagged, not done — see
  the handoff note.

## 7. Follow-ups worth doing next

1. **Computed left/right asymmetry.** The per-side answers make it available;
   surfacing "your left held, your right gave out at 4 seconds" on the results
   page is the single most compelling line this quiz could print. Needs a pure
   pairing helper and a field on `QuizScoreResult`.
2. **The compensations footage as a second clip per test.** Already filmed, sitting
   in the last ~25 seconds of each source video. Turns self-grading from a
   judgement into a comparison.
3. **The results page as a mini-assessment** — mirror, reframe, map the gaps, one
   CTA. Described well in the other doc and worth taking from it.
