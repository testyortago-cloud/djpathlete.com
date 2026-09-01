# Why a recent invoice never reached the email-receipts queue

**Date:** 2026-09-01 · **Mailbox:** `darren@darrenjpaul.com` · **Verdict:** not a fault — the
poller has no source that can see mail delivered straight to the inbox.

## What was checked

Read-only against production (`scripts/inspect-gmail-receipts.mjs .env.prod`): the eight
`system_settings` keys the poller reads, the `platform_connections` gmail row, all 721
`cron_runs` rows for `bookkeepingGmailReceiptsCron`, and every `bookkeeping_documents` row
whose `external_ref` starts `gmail:`.

The mailbox itself was **not** read — the credentials sit in Supabase Vault and that read was
refused. So the label finding below is the poller's own observation, repeated hourly, not a
direct look at Gmail.

## The mechanism

`app/api/admin/internal/bookkeeping-gmail-receipts/route.ts` lists messages from exactly two
sources and unions them:

1. **The label** — messages carrying the Gmail label named in
   `bookkeeping_gmail_receipt_label`, currently `"DJP Receipts"`.
2. **The forwarder watch** — `buildForwarderQuery` over
   `bookkeeping_gmail_receipt_forwarders`, which today produces:
   `(from:yortago@gmail.com OR to:yortago@gmail.com OR from:testyortago@gmail.com OR to:testyortago@gmail.com) -in:sent after:2026/08/02`

A message that matches neither is never listed, so it is never fetched, never ingested, and
never appears on `/admin/books/email-receipts`.

## What the evidence says

**The label source has never worked.** Every run since the poller went live on 2026-08-02
records `label_missing: true`, and `forwarder_listed` has equalled `listed` on every single
run. The label has contributed **zero messages, ever**. The lookup is
`labels.find((l) => l.name === labelName)` — exact and case-sensitive, and Gmail names a
nested label `Parent/Child`, so `DJP/Receipts` would not match either.

**The forwarder source has been idle for two weeks.** `listed` has been frozen at 16 since
2026-08-16T21:20Z, all 16 already settled, so every hourly run since reports
`processed: 0, ingested: 0` — 380-odd consecutive no-op successes.

| | |
|---|---|
| Runs since 2026-08-02 | 721, of which 720 `success` |
| Last message ingested | 2026-08-16 |
| Documents ever ingested from Gmail | 45 (11 still unposted) |
| Messages the label source has ever supplied | 0 |

So an invoice a vendor sends directly to `darren@darrenjpaul.com` matches neither `from:` nor
`to:` a watched forwarder, and carries no label. It is invisible to the poller.

## Why nothing raised a flag

Three safety nets all pass this through, each correctly by its own rules:

- **The cron.** A missing label with a forwarder configured is deliberately "a note, not an
  outage" (the route degrades to `success` only when *neither* source exists). The note lands
  in `cron_runs.detail.label_missing`, which nothing reads or alerts on.
- **The admin page.** `EmailReceiptsClient` renders the configured label *name* as though it
  were live: "Receipts pulled hourly from Gmail messages labeled 'DJP Receipts'…", and its
  empty state instructs the coach to "apply the 'DJP Receipts' label to receipt emails". That
  is the one action that currently does nothing, and the app has known so for a month.
- **The receipt watchdog.** `receiptWatchdogFindings` only fires on a *ledger entry* that is
  already in the books without a document. An invoice that never became an entry is outside
  its reach.

## Fix it now, no deploy

Create the label in `darren@darrenjpaul.com` — **exact name `DJP Receipts`, case-sensitive,
top level** — and apply it to the invoice. The next run at :20 past the hour ingests it. The
label source is deliberately unbounded (no `since` cutoff), so labelling older invoices
backfills them too; a Gmail filter that auto-labels the usual senders makes it permanent.

**Do not add `darren@darrenjpaul.com` to the forwarder list.** The query is
`from: OR to:`, so `to:darren@darrenjpaul.com` matches essentially the entire mailbox and
would walk everything since the cutoff into the review queue.

## Worth fixing in code

1. **Surface `label_missing` on `/admin/books/email-receipts`.** The page should report the
   label as *observed*, not as *configured* — telling the coach the label it is asking them to
   apply does not exist in the connected mailbox. This is the whole reason a month passed.
2. **Neither the label nor the forwarder list is editable in the app.** Nothing writes those
   keys; the empty state literally names a raw settings key at the coach. A Phase-5 business
   settings screen is the natural home.
3. **The single failed run, 2026-08-08T21:20Z, logged `{"message":"[object Object]"}`** — the
   known raw-PostgREST-error rethrow, so that failure has no recoverable reason. It self-healed
   on the next run.

## Also sitting there

11 receipts already imported and scanned but never posted, from 2–16 August: Atlassian,
Basecamp, Anthropic (invoice + receipt), Loom, a refund, and three HTML-body captures.
