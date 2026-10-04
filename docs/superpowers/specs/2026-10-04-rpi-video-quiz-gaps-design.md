# RPI video quiz: closing the gaps — design

Date: 2026-10-04
Status: design approved in chat 2026-10-04; this document awaits review.
Builds on: `docs/superpowers/specs/2026-09-19-rotational-performance-index-design.md` (§7 follow-ups).

Source documents (Google Drive, owner's):

- "Lead Magnet" (`1m-v1Hccrf…`) — the scoring system, and the CTA script: *"Your results suggest
  you may have a rotational performance leak"* → what it means → why traditional training misses it →
  how Rotational Reboot addresses it → *"See if Rotational Reboot is right for you."*
- "Quiz Athlete" (`1B1Mb81GiBib…`) — its "Results Pages — Built Like a Mini-Assessment" section:
  **mirror** back what they said, **reframe** as a system gap (*"This isn't an effort problem. It's a
  structure problem."*), **map** the gaps, **one** CTA.

Source footage: `~/Downloads/Test {1..5}_*.MOV.mp4` (1080p, 82–121 s). Each ends with a narrated
"Compensations include…" section. Transcripts: `media/quiz-rotational-reboot/t1..t5.srt`.

## 1. What is missing today

1. **Darren cannot add a video himself.** `QuizEditor.tsx` carries `mediaUrl` through a save but has
   no input for it. Clips go in only through `scripts/upload-quiz-media.ts`.
2. **The athlete grades themselves without seeing what a bad rep looks like.** The compensations
   footage is filmed and unused.
3. **The per-side answers are collected and thrown away.** Four of the five tests are asked once per
   side; the result is one number.
4. **The results page is a score and a paragraph.** It mirrors nothing, maps nothing.

## 2. Out of scope (owner actions)

- Publishing the RPI funnel (one click in `/admin/funnels`; makes it public).
- Deleting the two clone quizzes in prod (`rotational-reboot-score` 0f694fb0, `rotational-reboot`
  e72781a4). Irreversible; the second still backs a draft funnel.
- Merging to `main` (deploys the app and applies the migration to prod).
- Transcoding uploads. The editor warns above 25 MB instead.
- A help-text input in the editor (also missing; not asked for).

## 3. Data — migration `00286_quiz_question_report_and_mistakes.sql`

Four nullable columns on `quiz_questions`:

| Column | Type | Meaning |
|---|---|---|
| `mistakes_media_url` | text | Durable public URL of a "common mistakes" clip. Null unless a movement test. |
| `mistakes_media_poster_url` | text | Its poster frame. Null whenever the clip is. |
| `report_label` | text | Name of the row this question feeds on the results map. Null = not on the map. |
| `side` | text, `check (side in ('left','right'))` | Which side of a paired test. Null = unpaired. |

All nullable for the same reasons `00262` gives (28 athlete-quiz questions have none; insert
builders keep compiling). No URL check constraint — Zod `.url()` in the admin route is the layer.

**Backfill, scoped to `quizzes.key = 'rotational-performance-index'`, idempotent, non-destructive:**

- `report_label` and `side` from the seed's prompt shape `"<Test> — <side> side: …"` (and
  `"Rocking hollow: …"` with no side), only `where report_label is null`.
- `mistakes_media_url` / poster to the five new clips, only `where mistakes_media_url is null`.
- Tier `body` rewritten (§6.2), only where the body still equals the seed's original text — copy a
  human has edited is left alone.

A database without that quiz (any tenant's clone, a fresh dev DB) is untouched. The key is verified
on the dev clone; prod's (quiz `8698d925…`) is **unverified** — the seeder mints it from the name, so
it should match, but confirm with one read before merge. If it differs, the backfill is a silent
no-op, not a wrong write.

Dev clone first (`apply_migration` via the dev MCP), then `npm run test:integration:drift`.

## 4. Upload in the editor

**Route** `POST /api/admin/quizzes/[id]/media-upload-url`, body `{ filename, contentType }`.

- Same guard as `PATCH /api/admin/quizzes/[id]`: `auth()`, `resolveAdminTenantForRequest`, quiz read
  under the caller's business, 404 for missing/foreign.
- `contentType` must be `video/mp4 | video/quicktime | video/webm | image/jpeg | image/png`.
- Path: `quizMediaStoragePath(quiz.key, `${Date.now()}-${filename}`)` — timestamped because the
  objects are served `immutable`; a re-upload must be a new name.
- Returns `{ uploadUrl, publicUrl }`: a v4 signed **write** URL (15 min) and the durable
  `quizMediaPublicUrl(bucket.name, path)`. The browser PUTs the file directly — Vercel's 4.5 MB body
  limit makes a proxied upload impossible for video.
- The PUT sends only `Content-Type`. No `Cache-Control` is signed: an extra signed header must also
  pass the bucket's CORS `responseHeader`/method config, which nothing here verifies, and a CORS
  failure is a silent dead upload. Ceiling: editor-uploaded clips get Firebase's default caching,
  not the script's `immutable`. Upgrade path: sign `extensionHeaders` once CORS is confirmed.

**Editor** — under each question's prompt, a collapsible "Video" block with two pickers:
"Demo clip" (`mediaUrl`/`mediaPosterUrl`) and "Common mistakes clip" (`mistakesMediaUrl`/
`mistakesMediaPosterUrl`). Each picker:

1. Accepts a video file; warns (does not block) above 25 MB.
2. Grabs a poster in the browser: load into an off-DOM `<video>`, seek to 1 s (or 0 if shorter),
   draw to canvas, `toBlob('image/jpeg', 0.85)`.
3. Requests two signed URLs, PUTs both, then `patchQuestion` with the two public URLs.
4. Shows the current clip as a small `<video controls>` with a "Remove" button (sets both to null).

Plus two fields for the results map: "Results map label" (text) and "Side" (None / Left / Right).
Nothing is written until the editor's existing Save — same as every other field.

## 5. Runner — the mistakes clip

When `current.mistakesMediaUrl` is set, a two-button toggle above the player — "How to do it" /
"Common mistakes" — swaps `src` and `poster`. Default "How to do it". Both clips stay
`muted loop playsInline controls preload="none"`; the mistakes clip keeps its audio track so the
visitor can unmute Darren's narration. Toggle resets on question change.

`publicQuizDefinition` ships `mistakesMediaUrl` and `mistakesMediaPosterUrl` (the point of them).
It does **not** ship `reportLabel` or `side` — the browser has no use for them before the result.

## 6. Result — the mini-assessment

### 6.1 Pure builder `lib/quizzes/report.ts`

`buildReport(definition, answers, branchId)` → `{ mirror, map }`, imports types only.

- **map**: walked questions with a `reportLabel`, grouped by label in first-position order. Each
  row: `{ label, left?, right?, single?, max, status }` where each side is the chosen option's
  weight (unanswered = omitted) and `max` is the question's highest weight. Status, using
  `f = points / max`:
  - `gap` — both sides present and `|fL − fR| ≥ 0.5` (on a 0–3 scale: a 2-point difference)
  - `leak` — any side `f < 0.5`
  - `watch` — any side `f < 1`
  - `solid` — otherwise
- **mirror**: walked, answered questions whose options are all weight 0 **and** carry no profile
  vote (those surface as the profile block): `{ prompt, answer }`, in walk order.

`presentResult` moves out of the submit route into `lib/quizzes/present-result.ts` and gains
`mirror` and `map`. `submit` and `preview-submit` both call it — today the preview route builds the
same object by hand, which is exactly the duplication that lets the two drift.

Weights reach the browser only as the visitor's own points, only after they submit, through the
same response that already carries their score. `publicQuizDefinition` is unchanged on that front.

### 6.2 Copy (RPI tiers, from the owner's two documents)

- **red** — "Your results suggest you have a rotational performance leak — and a big one. This isn't
  an effort problem. It's a structure problem: your body is finding ways around the work instead of
  doing it, and that is where speed and power leak out.\n\nTraditional training misses it because
  it trains the sport and the gym, not the connection between them.\n\nRotational Reboot is six
  weeks built to close exactly these gaps, side by side."
- **orange** — "Your results suggest you have a rotational performance leak. This isn't an effort
  problem. It's a structure problem: you held some of it together and lost the rest, and those gaps
  cost you output when you are tired.\n\nMost programs never test for it, so they never train
  it.\n\nRotational Reboot targets the gaps on the map below."
- **yellow** — "Your results suggest you may have a rotational performance leak. A solid base, with
  specific leaks in it. This isn't an effort problem. It's a structure problem — and a small
  one.\n\nThese are the leaks that decide close results. Rotational Reboot closes them before they
  do."
- **green** — "You control rotation well. The value now is precision — the small side-to-side
  differences on the map below still cost output, and an assessment measures them properly."

CTAs unchanged (red/orange/yellow → Rotational Reboot, green → `/assessment`).

### 6.3 Rendering

Order: tier chip, score, "out of 100" → **"What you told us"** (mirror) → tier body, split on blank
lines into paragraphs → **"Your movement map"** (one row per map entry: label, a 0..max meter per
side labelled L/R, status chip: Solid / Watch / Leak / "Left/right gap") → profile → CTA.

**Mirror and map render only when the map is non-empty.** The athlete quiz has no
`report_label`s, so its live results page is unchanged — and that page's published CSS is frozen
(`styles.ts` changes reach a funnel only on republish), so new markup there would be unstyled.

New CSS in `lib/funnels/sections/styles.ts` under `.djp-s-quiz`: `.djp-quiz-toggle`,
`.djp-quiz-mirror`, `.djp-quiz-map`, `.djp-quiz-map-row`, `.djp-quiz-meter`, `.djp-quiz-status`.
Semantic variables only. **No backticks in comments** in that file — it is one template literal.

## 7. Media production

ffmpeg from each source, from the "Compensations include" timestamp to the end, 1280×720 H.264,
`-crf 26`, AAC kept, `+faststart`, poster at +1 s:

| Test | Source | Start |
|---|---|---|
| 1 Prone hip abduction | `Test 1_Prone_compensate.MOV.mp4` | 1:05.0 |
| 2 Rocking hollow | `Test 2_Rocking Hollows.MOV.mp4` | 1:15.0 |
| 3 Short lever Copenhagen | `Test 3_Short lever Copenhagen.MOV.mp4` | 1:00.0 |
| 4 Windshield wipers | `Test 4_Windshield wiper.MOV.mp4` | 0:53.3 |
| 5 Retro backwards hop | `Test 5_ Retro backwards jump.MOV.mp4` | 1:04.3 |

Uploaded with `scripts/upload-quiz-media.ts` to `quiz-media/rotational-reboot/N-<slug>-mistakes.mp4`
(+ `-poster.jpg`). **One Firebase project: this is a live-bucket write** — new objects, referenced by
nothing until the migration runs. View one frame of each cut before uploading.

## 8. Testing

- `report.test.ts` (zero mocks): pairing, each status boundary (gap at diff 2, not 1), unanswered
  side omitted, branch filtering, mirror excludes scored and profile-vote questions, empty map for
  a quiz with no labels.
- `present-result` used by both routes; existing `quiz-submit` / `preview-submit` tests extended to
  assert `map` and `mirror` arrive.
- `public-definition.test.ts`: mistakes URLs present; `reportLabel` / `side` absent.
- Upload route: 401, 404 foreign quiz, 400 bad content type, 200 returns a `publicUrl` under
  `quiz-media/<quizKey>/`.
- Editor: picking a file calls the route and patches the question (fetch mocked); save payload
  carries the four new fields.
- Runner: toggle appears only with a mistakes clip and swaps `src`; result renders map + mirror
  only when map non-empty.
- Seed test: every paired test has both sides labelled; five mistakes clips.
- `npm run test:integration:selects` and `test:integration:drift` after the dev migration.
- Annotated screenshots (light only — admin UI is light-only) of the editor video block, the runner
  toggle, and the results page, from the real `/preview/<slug>` route.
