# AI Bookkeeper walkthrough video — design (2026-07-26)

A ~12-minute captioned walkthrough of the complete AI Bookkeeper, built from **real captured admin UI** (Playwright) edited in **Remotion**. No voiceover — on-screen captions carry the narration.

Owner decisions (2026-07-26): **seed a demo dataset** (invented data, dev project only), **captions only / no audio**, **sync the dev DB to the prod schema**.

Feature under demonstration: `docs/superpowers/2026-07-25-bookkeeper-completion-report.md`.

---

## 0. Findings that constrain the design

1. **Auth is solved twice over.** `app/api/dev/login/route.ts` mints an admin NextAuth JWT from a single GET (`/api/dev/login?callbackUrl=/admin/books`), triple-gated on `NODE_ENV !== "production"` && `!process.env.VERCEL` && `DEV_AUTH_BYPASS_ENABLED === "true"` — all satisfied in `.env.local`. The recorder uses this, not the login form (no typing, no password on camera). Consequence: **capture must run against local `npm run dev`**, never a Vercel URL, because the route 404s when `VERCEL` is set.
2. **The recorder does not exist.** The client-promo Playwright recorder lived in a deleted session scratchpad; only the Remotion half was committed. Written from scratch here.
3. **Recording geometry is a hard constraint** (JOURNAL 2026-07-17): `recordVideo.size` only scales content **down** and ignores `deviceScaleFactor`. Video resolution == CSS viewport width, which also drives layout. So `size` MUST equal `viewport`, and the chosen width *is* the layout width.
4. **`@remotion/captions` is not installed.** Captions are custom components. Precedents to reuse: the `CaptionedCut` composition and the `useTyped` typewriter helper in `promo/scenes/S5Purpose.tsx:13-22`.
5. **Dev DB drift**: `.env.local` → Supabase project `anjv…`; all migrations go through the MCP to `epzu…` (prod). Dev lacks **00191**, **00192**, **00194**, so `bookkeeping_payouts`, `bookkeeping_payout_lines` and `bookkeeping_finding_dismissals` 404 → `/admin/books/reports` and `/admin/books/insights` both throw. Prod confirmed by data only prod could have: 29 rows / $8,496 with a row stamped `2026-07-25 04:30:04` (the income-sync cron's first verified run) vs dev's $8,246.
6. **PII disqualifies filming real data.** Prod: 23 of 29 ledger rows contain a real client's full name, 2 contain real emails. **Dev is a prod clone** (27 rows, 21 name-shaped, 1 email) — so dev is *not* safe by default either.
7. **Insights and the Reports per-book summary are NOT book-scoped** (`listEntriesForInsights`, `listAccountsForReports` take no book filter). Adding a demo book would therefore not hide the cloned real rows — the seeder must **replace** them.
8. **Year-end flags cannot fire in July** (`year-end-flags.ts:21` requires `todayMonth >= 10`). No beat is scripted around that card.

---

## 1. Architecture — four units

### Unit A — dev schema sync
`scripts/sync-dev-bookkeeping-schema.ts`. Applies the SQL of migrations 00191, 00192, 00194 to the **dev** project using `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`.

- **Prod guard (mandatory):** refuses to run if the resolved project ref matches the prod ref (`epzuvzkokzqtzomeyoha`) or if `NODE_ENV === "production"`. Aborts loudly.
- All statements `IF NOT EXISTS` / `on conflict do nothing` — safe to re-run.
- Verifies afterwards by querying `information_schema` for the three tables and reporting a table of results. Does **not** claim success from the absence of an error.

### Unit B — demo seeder
`scripts/seed-bookkeeping-demo.ts`, idempotent, `--clean` reverses it. Same prod guard as Unit A.

**It replaces, not appends.** The dev project's cloned bookkeeping ledger rows are deleted and rewritten with invented data, because Insights and Reports aggregate across books (finding 7). Scope is strictly the `bookkeeping_*` tables; nothing else in dev is touched.

Seed volumes are derived from the exact thresholds the finders use — below these, the screens render empty and the video has nothing to show:

| Data | Volume | Gate it satisfies |
|---|---|---|
| Ledger expenses | ~50 rows, ≥6 expense accounts, ≥4 months | P&L expense side; ledger tiles; source pills across all four `source` values |
| Uncategorized | 8-10 rows `account_id = null` | Insights "Uncategorized expenses"; amber rows on Reports |
| Recurring vendors | 2 vendors × ≥3 charges at **25-35 day gaps** | `vendor-sweep.ts:87` monthly cadence detection |
| Near-duplicates | 2 same-day, same-account pairs | `vendor-sweep.ts:125` `duplicate_group` |
| Missing purpose | ~6 rows on `requires_business_purpose` accounts | Substantiation gaps; receipt watchdog |
| Home office | household rows on accounts named exactly `rent`, `utilities`, `internet`, `renter's insurance`, `home repairs & maintenance` | `deduction-finder.ts:164-170` literal allowlist |
| Service lines | income across ≥3 service lines; ≥2 expense accounts with a service line and **≥1 without** | `service-line-profit.ts`; the "without" is what creates a shared cost to allocate |
| Documents | 8-12, linked via `ledger_entries.document_id` | Paperclip affordance, statements list, pack Document Index |
| Payouts + lines | 4-6 `status='paid'` + 20-40 fee-bearing lines, arrival dates inside the report window | Without ≥1 payout, `payout_count === 0` and Reports renders the *hedged* fee/net strings instead of real money |
| Period closes | 2-3 consecutive closed months | Close card history; 🔒/🔓 contrast |
| Assets | 3-5, varied in-service dates | Assets page + depreciation |

Names are invented (vendors like "Northgate Sports Supply"; clients as first-name + initial). **No string is copied from the real data.**

Documents are seeded as rows only — a paperclip click hits `/documents/:id/download`, which needs a real storage object. The recorder therefore **does not click download affordances**; the paperclip is shown, not exercised.

### Unit C — recorder
`scripts/record-bookkeeper-walkthrough.mjs` (Playwright, standalone — not a spec, so it never runs in the e2e gate).

- `viewport: { width: 1600, height: 1000 }` with `recordVideo.size` **identical** (finding 3).
- Auth via the `dev/login` bypass.
- Chapters are declared as data (`BEATS`), each with an id, an async action, and a settle time — so retiming is a data edit, mirroring `client-promo/config.ts`.
- Emits **`timeline.json`**: `{ beat, startMs, endMs }` measured from `performance.now()` at real transitions — never eyeballed. This is what the captions sync to.
- Clean-capture hygiene: `prefers-reduced-motion` to steady the UI, a synthetic cursor so clicks are visible, deliberate dwell after each action, and no download clicks.
- Output: `.playwright-out/walkthrough.webm` + `timeline.json`.

### Unit D — Remotion composition
`render-worker/src/remotion/walkthrough/` at **1920×1080 / 30fps**.

- `config.ts` holds the EDL: the take filename, the imported `timeline.json`, and per-beat caption copy. `chapterStart()` derives offsets from the ordered map, so retiming one chapter never requires editing downstream numbers (the `promo/theme.ts:72-79` pattern).
- `Walkthrough.tsx` composes `OffthreadVideo` of the take with caption and chapter-title overlays.
- Captions: a lower-third card, entrance via the existing `useEntrance` helper, brand colors/fonts from `promo/theme.ts`, `PromoBug` for the logo. Chapter cards mark each of the 12 sections.
- Registered in `Root.tsx` as `BookkeeperWalkthrough`.

**Conversion:** webm → mp4 via `ffmpeg-static`, reusing the `execFile(ffmpegPath, [...])` pattern already in `render-worker/src/lib/detect-face.ts:106-110`. The mp4 lands at `render-worker/public/bookkeeper-take.mp4` (gitignored, like `client-take.mp4`).

---

## 2. Data flow

```
Unit A (schema sync)  ─┐
                       ├─► dev Supabase (anjv) ─► npm run dev ─► real UI
Unit B (demo seeder)  ─┘                                          │
                                                                  ▼
                                          Unit C recorder (Playwright 1600×1000)
                                                                  │
                                          walkthrough.webm + timeline.json
                                                                  │
                                                    ffmpeg ──► bookkeeper-take.mp4
                                                                  │
                                          Unit D Remotion ◄───────┘
                                                                  │
                                                   BookkeeperWalkthrough.mp4 (1920×1080)
```

---

## 3. Chapters

Approved 2026-07-26. Times are targets; the recorder's measured timeline is authoritative.

| # | Chapter | Screen / action | ~s |
|---|---|---|---|
| 1 | The problem | Title card over the ledger | 40 |
| 2 | The three books | `/admin/books` — book tabs, tiles, accounts | 70 |
| 3 | Income, automatically | Import platform income dialog; mention the nightly sync cron | 60 |
| 4 | Bank statements | Import statement → AI categorize → dedupe review → commit | 95 |
| 5 | Receipts, four ways | Photo/vision, cash 2-tap, Amazon CSV, `/admin/books/email-receipts` | 120 |
| 6 | Categories & business purpose | `/admin/books/accounts`; why the IRS-facing fields exist | 50 |
| 7 | Stripe payouts & net revenue | `/admin/books/reports` — gross vs net, the fee line | 65 |
| 8 | Insights | `/admin/books/insights` — deductions, gaps, vendors, profit by line, allocation toggle, a live dismissal, AI narrative | 130 |
| 9 | Monthly close | Close card, closed-month history | 50 |
| 10 | Reports & accountant pack | QBO CSV, xlsx, print view, email dialog (shown, not downloaded) | 80 |
| 11 | Assets & depreciation | `/admin/books/assets` | 35 |
| 12 | Automation & wrap | The crons; closing card | 40 |

Total ≈ **12m15s**.

---

## 4. Verification

- **Unit A**: `information_schema` query proves all three tables exist on dev afterwards.
- **Unit B**: after seeding, assert per-screen liveness by querying the same DAL predicates the finders use — at minimum: ≥1 monthly-cadence vendor detected, ≥1 shared-cost line, ≥1 payout with fee lines, ≥2 closed months. Seeding "succeeded" without these is a failure, because the screens would still film empty.
- **Unit C**: `timeline.json` beat count equals the declared beat count; the webm is non-zero and its duration is within tolerance of the sum of beats.
- **Unit D**: `npx remotion render` produces a non-zero mp4 of the expected duration; visual spot-check of caption sync at chapter boundaries.
- **Repo hygiene**: the existing `__tests__/e2e/bookkeeping-surfaces.spec.ts` authed tests — currently RED because their selectors were written blind (`/books|ledger/i` vs the real `<h1>` "Accounting") — are corrected against the captured snapshots as part of this work, and the temporary recon spec `zz-capture-ui.spec.ts` is removed or folded in.
- No production database is touched at any point. No new migration is created.

---

## 5. Risks / open items

- **Book labels on camera.** The three books are named "Darren — DJP Athlete", "Spouse — Business", "Household & Personal". The *numbers* are seeded/fake, so no real finances appear, but the labels reveal household structure. Default: keep them (the three-book split is a feature being explained). One-line change in the seeder if the owner prefers neutral labels.
- **Dev is mutated.** Unit B rewrites dev's bookkeeping tables. Acceptable — dev is a clone, `--clean` reverses it, and prod is guarded — but it means dev's bookkeeping data is demo data afterwards.
- **Long single take.** A ~12-minute Playwright run is one fragile take; any mid-run failure wastes it. Mitigation: chapters record to **separate takes** stitched by the EDL, so a failed chapter is re-recorded alone.
- **Firebase storage objects** are not seeded, so download/preview affordances are shown but never clicked.
