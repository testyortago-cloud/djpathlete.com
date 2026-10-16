# Newsletter Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-issue sent / delivered / opened / clicked / bounced / spam results for newsletters, stored per recipient and shown on `/admin/newsletter` and the newsletter's own page.

**Architecture:** Every send writes one `newsletter_deliveries` row per person (`origin='send'`); the existing retry rows are `origin='retry'`. The Resend webhook stamps delivered/opened/clicked on those rows; a `security_invoker` view aggregates per newsletter. A script backfills 2026-10-09 from Resend's log.

**Tech Stack:** Next.js 16 App Router, Supabase/PostgREST, Firebase Functions (functions/ twin rule), Resend, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-17-newsletter-results-design.md`

## Global Constraints

- Migration number `00292` (00291 is on main and prod).
- Retry behaviour is unchanged: brake stats and status-line counts scoped to `origin = 'retry'`.
- Recording a send never throws and never changes the send's counts.
- Stamps are first-time only (`.is(<col>, null)`); filter columns are string constants (the live select contract cannot read a variable column).
- Reads under `platformBusinessId()`, as `/admin/newsletter` already does for the retry line.
- Copy is plain language; "Bounced (the address does not exist)"; caution "Opens are approximate: some mail apps open every email automatically." and "Results keep coming in for a few days after a send."

## Review Focus

- The retry status line's "N done" must not include `origin='send'` rows: a 5,883-person blast would read "5,883 done". Task 1 test: view `sent` counts retry rows only (live check).
- The retry brake must not count the blast's bounces. Task 1: `settledRetryStats` filters `origin='retry'` (live check inserts a bounced `send` row and asserts it is not counted).
- A rate whose base is 0 shows no percentage (no `NaN%`). Task 5 test.
- A failed recording insert leaves the send's result and counts exactly as before. Task 2 test.
- Resend's batch answer shorter than the payload: rows beyond it are recorded with a null id, not dropped or crashed. Task 2 test.

---

### Task 1: Schema + DAL

**Files:**
- Create: `supabase/migrations/00292_newsletter_results.sql`
- Modify: `lib/db/newsletter-deliveries.ts`
- Live check (not committed): scratch script against the dev clone

**Interfaces:**
- Produces: columns `origin text not null default 'retry' check (origin in ('send','retry'))`, `delivered_at`, `opened_at`, `clicked_at` (timestamptz); view `newsletter_delivery_summary` recreated with every count scoped to `origin='retry'` (same columns); view `newsletter_delivery_results(business_id, newsletter_id, recipients, delivered, opened, clicked, bounced, complained)` over `status='sent'` rows, `security_invoker`.
- Produces (DAL): `type NewsletterResults = { newsletter_id: string; recipients: number; delivered: number; opened: number; clicked: number; bounced: number; complained: number }`; `getNewsletterResults(businessId: string): Promise<Record<string, NewsletterResults>>`; `markNewsletterDeliveryDelivered|Opened|Clicked(providerMessageId: string, at: Date): Promise<boolean>`; `settledRetryStats` adds `.eq("origin", "retry")`.

- [ ] Write 00292 (alter table, drop + recreate summary view because its body changes, create results view). Apply to the dev clone; run `npm run test:integration:drift`.
- [ ] DAL changes. Live check: insert one `send` row (sent, bounced) and one `retry` row (sent) for a dev newsletter; assert `settledRetryStats` = sent 1 bounced 0, summary `sent` = 1, results `recipients` = 2 `bounced` = 1; stamps are first-time only. Clean up.
- [ ] `npm run test:integration:selects` green. Commit.

### Task 2: The blast records who it reached

**Files:**
- Modify: `functions/src/lib/newsletter-retry-queue.ts`, `functions/src/newsletter-send.ts`
- Test: `functions/src/__tests__/newsletter-retry-queue.test.ts`, `functions/src/__tests__/newsletter-send.test.ts`

**Interfaces:**
- Produces: `recordNewsletterSends(supabase, businessId: string, newsletterId: string, sent: { email: string; providerMessageId: string | null }[], at: Date): Promise<number>` — upsert `origin:'send', status:'sent', provider_message_id, sent_at` with `onConflict: "newsletter_id,email", ignoreDuplicates: true`; never throws.

- [ ] Tests: `recordNewsletterSends` writes those fields; logs and returns 0 on error. `handleNewsletterSend`: after an accepted batch, records each address with ITS id in payload order; `data.data` shorter than the batch → trailing rows recorded with `null`; recording rejected → job result unchanged; no `businessId` → nothing recorded.
- [ ] Implement; run both files; commit.

### Task 3: Webhook stamps opens, clicks, deliveries

**Files:**
- Modify: `app/api/webhooks/resend/route.ts`
- Test: `__tests__/api/webhooks/resend-events.test.ts`

- [ ] Tests: for `outcome === "unknown_message"`, `email.delivered|opened|clicked` call the matching `markNewsletterDelivery*` with Resend's id and the event's own time; a sequence-owned id calls none; a throwing stamp still answers 200.
- [ ] Implement; run; commit.

### Task 4: Shared Resend log reader + backfill

**Files:**
- Create: `lib/newsletter/resend-log.ts`, `scripts/backfill-newsletter-results.ts`
- Modify: `scripts/enqueue-newsletter-retry.ts` (use the shared reader), `lib/newsletter/retry-backfill.ts` (add `stampsFromLastEvent`)
- Test: `__tests__/lib/newsletter/retry-backfill.test.ts`

**Interfaces:**
- Produces: `fetchNewsletterEmails(apiKey: string, subject: string, sentAt: Date): Promise<{ id: string; to: string[]; last_event: string; created_at: string }[]>` (throws when the log starts after the send); `stampsFromLastEvent(lastEvent: string, at: string): Partial<Record<"delivered_at"|"opened_at"|"clicked_at"|"bounced_at"|"complained_at", string>>`.

- [ ] Test `stampsFromLastEvent`: clicked → delivered+opened+clicked; opened → delivered+opened; delivered → delivered; complained → delivered+complained; bounced → bounced; suppressed/failed/sent → {}.
- [ ] Script: dry run by default; `--apply` inserts `origin='send'` rows for addresses with no row and fills null stamps on rows matched by `provider_message_id`; refuses the 2026-09-11 send and any send `unsafeToQueue` would refuse. Prod dry run for `d8fc510b-…` must report 1,100 blast emails + today's retry sends.
- [ ] Commit.

### Task 5: Screens

**Files:**
- Create: `lib/newsletter/results.ts`, `components/admin/newsletter/NewsletterResultsPanel.tsx`
- Modify: `app/(admin)/admin/newsletter/page.tsx`, `components/admin/newsletter/NewsletterList.tsx`, `app/(admin)/admin/newsletter/[id]/edit/page.tsx`
- Test: `__tests__/lib/newsletter/results.test.ts`

**Interfaces:**
- Produces: `pct(n: number, base: number): string | null` ("35%" / "4.3%" under 10 / null when base 0); `resultsLine(r: NewsletterResults | undefined): string | null` → `"Opened 35% · Clicked 4.3% · Bounced 9.3%"` (parts with null rates dropped; null when recipients 0); `resultTiles(r)` → `{ label: string; value: string; detail: string | null }[]` for Sent, Delivered, Opened, Clicked, Bounced (the address does not exist), Marked as spam.

- [ ] Tests for the three functions incl. base-0 and no-results cases. Implement.
- [ ] List: results line under the Sent cell text. View page: panel above the form for a sent newsletter ("No results recorded for this send." when none), plus "N more are still being resent." when the retry has rows waiting.
- [ ] Annotated light-mode screenshots of both screens on the real routes (dev clone, data by SQL/backfill script; never click Send). Commit.
