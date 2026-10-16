# Newsletter results — design

2026-10-17. Written autonomously (the owner was asleep and asked for it: "if not create one for the
email blasts"). Every decision below is marked as mine where the owner did not make it.

## Intent

The coach sends a newsletter and today sees only "1100 delivered, 4783 failed" — and "delivered"
there means "Resend accepted it", not "it arrived". Opens, clicks, bounces and spam reports exist
only inside Resend, for about 30 days, per email. The coach should be able to answer, for each issue,
on the newsletter screens: how many it went to, how many arrived, how many opened it, how many
clicked, how many bounced, and how many marked it as spam.

## Goals

- Per-issue results for every newsletter sent from now on, kept in our own database (not lost after
  Resend's ~30-day log window).
- The same results for the 2026-10-09 issue, recovered from Resend's log by a script.
- Shown in two places: one line per sent newsletter on `/admin/newsletter`, and a results panel on
  that newsletter's own page (`/admin/newsletter/[id]/edit`, titled "View Newsletter" once sent).
- Plain-language labels and a one-line caution that opens are approximate.

## Non-goals

- Per-person drill-down ("who opened"). The data will exist; no screen for it yet. (My call.)
- Unsubscribes per issue. The newsletter's unsubscribe link carries no token, so an unsubscribe
  cannot be tied to an issue. (Mine; flagged in the report.)
- Results for 2026-09-25 (sent on the other Resend account, whose key we do not use) and 2026-09-11
  (older than Resend's log). They show "No results recorded for this send."
- Charts, trends over time, the weekly report email. (Mine; later.)

## Anti-goals

- Nothing here may change what or when anyone is emailed. The retry queue and its bounce brake
  keep their exact behaviour. Recording a send must never be able to fail the send.

## How (decided by me)

- **One per-recipient ledger, not a second table.** `newsletter_deliveries` (migration 00291) already
  holds one row per person for the retry queue. Every send now writes one row per person too, with a
  new `origin` column: `'send'` (the original blast) or `'retry'` (the queue; every existing row).
  `unique (newsletter_id, email)` already guarantees one row per person per issue: a person is either
  reached by the blast or queued for the retry, never both.
- **New columns** (migration 00292): `origin`, `delivered_at`, `opened_at`, `clicked_at`
  (`bounced_at`, `complained_at` exist).
- **The retry keeps seeing only its own rows.** Its brake stats and its status-line counts are scoped
  to `origin = 'retry'`.
- **Writers:** `functions/src/newsletter-send.ts` records each accepted batch (Resend's ids, in payload
  order, as the retry already relies on) after the batch succeeds, never throwing. The Resend webhook
  stamps `delivered_at` / `opened_at` / `clicked_at` (first time only) for an email id no sequence
  message claimed, beside the existing bounce and complaint stamps.
- **Reader:** a `security_invoker` view `newsletter_delivery_results` with one row per newsletter:
  recipients, delivered, opened, clicked, bounced, complained. Read under `platformBusinessId()`, the
  business the writers stamp, like the retry status line.
- **Rates:** delivered ÷ recipients; opened and clicked ÷ delivered; bounced ÷ recipients; spam ÷
  delivered. No rate shown when its base is 0.
- **Backfill:** `scripts/backfill-newsletter-results.ts --newsletter <id> [--prod] [--apply]`, dry run by
  default. It reads the issue's emails from Resend's log (the same reader the enqueue script uses, moved
  into a shared helper), maps each email's `last_event` to stamps (clicked ⇒ opened ⇒ delivered;
  complained ⇒ delivered; bounced; suppressed/failed ⇒ none), inserts `origin='send'` rows for people
  not yet in the table, and fills missing stamps on rows already there (today's retry sends, whose early
  events predate the webhook change). Stamp times are the email's send time: approximate, and only
  presence is counted.

## Settled after the builder check (all my calls unless marked)

- **Recipients = rows Resend accepted** (`status = 'sent'`, either origin). Queue rows still waiting,
  paused, refused or skipped are not recipients. When the retry queue for an issue still has rows
  waiting, the panel adds one line, "N more are still being resent", and the list keeps its existing
  retry status line.
- **Live numbers, with a note.** Results are shown as they stand, with "Results keep coming in for a few
  days after a send." No time-based state.
- **Bounced = hard bounces only**, the same stamp the retry brake reads. Labelled "Bounced (the address
  does not exist)". It will read lower than Resend's dashboard, which also counts soft bounces. The
  backfill cannot tell the two apart from `last_event`, so for 2026-10-09 it counts every `bounced`.
- **Refused retry rows** (`failed`) are not in the results; the retry status line already says
  "N could not be sent".
- **Already true (checked 2026-10-16):** the prod webhook subscribes to delivered, opened, clicked,
  bounced and complained; open tracking is on (Resend shows 252 opens for 2026-10-09).
- **Undeliverable addresses** the blast drops before sending have no row and are not counted.

## Left to the builder

Component structure, exact copy, test layout, file names inside the existing patterns.
