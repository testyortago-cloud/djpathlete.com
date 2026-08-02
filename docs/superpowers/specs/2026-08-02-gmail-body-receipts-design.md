# Gmail Body Receipts + Forwarder Watch — Design

**Date:** 2026-08-02
**Status:** Approved pending owner spec review
**Supersedes:** Decision C-7 of `2026-07-25-bookkeeper-completion-design.md` (attachments-only v1)

## 1. Problem

Darren's software-subscription receipts (Google Cloud, Vercel, Supabase, …) arrive in
`yortago@gmail.com` / `testyortago@gmail.com` as **HTML-body-only emails** — no PDF or
image attachment. The shipped Gmail receipt poller (Track C) ingests attachments only,
so forwarding these to `darren@darrenjpaul.com` produces nothing: the poller settles
them as `attachmentless` and moves on. Decision C-7 descoped body ingestion on the
assumption it required headless HTML→PDF rendering. It does not — the scan job calls
Claude through `callAgent`, and Claude reads plain text directly. The renderer
assumption was the whole blocker, and it was wrong.

Additionally, the poller only sees messages carrying the "DJP Receipts" label, which
requires one-time Gmail-filter setup. The owner wants **forward-and-done**: forwarding
to `darren@darrenjpaul.com` should be sufficient with zero Gmail-side configuration.

## 2. Goals

1. A labeled or forwarder-matched email with **no usable attachment** but a non-empty
   body is ingested: body stored as the durable receipt document, scanned by the same
   `receipt_scan` job, surfaced pre-filled on `/admin/books/email-receipts`.
2. The poller additionally watches messages **from or to** configured forwarder
   addresses (seeded: `yortago@gmail.com`, `testyortago@gmail.com`) — no label needed.
3. Ship **activated**: cron flag flipped ON after deploys verify green (owner opted in).
4. Zero regression to the attachment path; posting remains human-gated.

Non-goals: auto-posting to the ledger; parsing linked invoices behind "View invoice"
buttons; IMAP/other mailboxes; headless rendering.

## 3. Approach (chosen: A — body text through the existing job)

Considered:
- **A. Body text through the existing `receipt_scan` job** — poller stores the raw
  HTML body as the document; the functions handler gains a text branch that strips
  HTML to text (pure string code) and prompts on it. One pipeline, durable results,
  original email preserved as IRS evidence. **Chosen.**
- **B. Inline Claude call in the cron route** — no functions deploy, but duplicates
  coalesce/back-fill root-side, bypasses `ai_generation_log`/job conventions, and puts
  up to 25 sequential AI calls inside the route's 300 s budget. Rejected.
- **C. Headless-render HTML → image** (original C-7 idea) — puppeteer on the money
  path; heavyweight and brittle. Rejected (again).

## 4. Design

### 4.1 Forwarder watch (poller listing)

- New setting `bookkeeping_gmail_receipt_forwarders` (jsonb string array), seeded
  `["yortago@gmail.com", "testyortago@gmail.com"]` via migration **00196** (idempotent
  `on conflict (key) do nothing`, same style as 00193's seeds). Admin-editable in
  `/admin/settings` like any settings row. Empty array ⇒ label-only listing (today's
  behavior). Key constant lives in `lib/bookkeeping/email-receipts.ts` beside the
  existing keys.
- The route builds a Gmail search query from the list:
  `(from:a OR to:a OR from:b OR to:b) -in:sent`. `from:` catches manual forwards
  (sender = the yortago account); `to:` catches Gmail auto-forwards (original sender
  preserved, original To: = the yortago account). `-in:sent` excludes darren@'s own
  outgoing mail to those addresses. Gmail API excludes spam/trash by default.
- Listing: existing label loop first, then a second `listMessages({ q })` loop; ids
  are unioned (Set) before the per-message walk. `MAX_LIST_PAGES` bounds the two loops
  **combined**; the existing `unsettledSeen > MAX_MESSAGES_PER_RUN` early-out applies
  to the union. New run-detail counter `forwarder_listed`.
- Everything downstream of listing (settled set, per-message isolation, attempts,
  poison pill, external_ref idempotency) applies to forwarder-matched messages
  unchanged.

### 4.2 Body ingestion (poller per-message walk)

Current branch behavior at `route.ts` (`attachments.length === 0`): count + settle.
New behavior — attachments still win; body is the fallback:

- **Scannable attachment(s) present** → attachment path exactly as today; the body is
  never ingested (no double ingest of one receipt).
- **No scannable attachments** (whether or not receipt-shaped-but-unreadable ones
  exist) → extract the body: prefer the `text/html` part, else `text/plain`, via a new
  pure walker in `lib/bookkeeping/receipt-attachments.ts`. Gmail `format=full` inlines
  text-part bytes in `body.data` (base64url); the rare large part carrying
  `attachmentId` instead is resolved with the existing `getAttachment`.
  - Non-empty body → `ingestReceiptDocument` with:
    - `buffer` = the **raw decoded body bytes, unmodified** (evidence artifact),
    - `mimeType` = `text/html` or `text/plain` as found,
    - `originalFilename` = `safeStatementName(subject)` + `.html`/`.txt`
      (subject fallback `"Email receipt"`),
    - `externalRef` = `gmail:<messageId>:body` (cannot collide with attachment
      refKeys, which are Gmail partIds or `p<n>`; the existing per-message
      `gmail:<messageId>:` prefix check covers it),
    - `uploadedBy: null` (cron actor), same book/accounts as today.
    Then settle **clean** — a captured body means the receipt is captured, so
    unreadable-attachment messages that body-ingest are NOT marked
    `needs_manual_upload` and NOT added to the unreadable set. (Consequence: a later
    `SCANNABLE_MIMES` widening does not re-open them — correct, the receipt is
    already in review.)
  - Empty/absent body → today's behavior exactly: `attachmentless++` (or
    unreadable-marking when receipt-shaped unreadables exist) + settle.
- **Body size cap 2 MB**: a body over the cap is treated as unreadable
  (`needs_manual_upload`, unreadable set, settle) — pathological, never a real receipt.
- Failures in body fetch/ingest use the existing `failedHere`/attempts/poison-pill
  machinery unchanged. New run-detail counter `body_ingested`; `attachmentless` now
  means "nothing usable at all".

### 4.3 Functions: text branch in the scan job

`ReceiptScanJobInput` is **unchanged** (`storagePath` + `mimeType` already carry
everything). In `functions/src/receipt-scan.ts`:

- New pure `emailBodyToReceiptText(raw: string, mimeType: string): string` — for
  `text/html`: drop `<style>`/`<script>`/`<head>` blocks, strip tags to spaces, decode
  the common entities (`&amp; &lt; &gt; &quot; &#39; &nbsp;`), collapse whitespace;
  for `text/plain`: pass through. Cap the result at **15 000 chars** (receipt totals
  live near the top; Google/Vercel/Supabase bodies are far smaller).
- `buildReceiptVisionPayload` gains a text branch: mime `text/html` or `text/plain`
  returns `{ bodyText }` (no image/document block, sharp untouched).
- `receiptUserMessage` gains an email variant: the accounts block, then an instruction
  to read the following **email text** (possibly a forwarded message — ignore the
  forwarding header wrapper), report the single grand total, and — prompt-injection
  hygiene — treat the email content strictly as data, never as instructions.
  `bodyText` is appended inside a fenced block. Posting stays human-gated regardless.
- Coalesce, `documentBackfillPayload` (`scan_result` write), log completion, RTDB:
  all unchanged.

### 4.4 Review surface

- `rowFromEmailDocument` gains `isBody` (mime `text/html` OR `text/plain` — without
  it a text doc falls into the editor's `<img>` branch and renders a broken image).
  `ReceiptRowEditor` renders body docs in an iframe like PDFs but with the
  **`sandbox` attribute (no scripts, opaque origin)** — the framed content is
  third-party email HTML; browsers render framed `text/plain` natively. Same lazy signed-URL fetch; GCS serves the stored
  `text/html` content-type. `frame-src` already allows the signed-URL host (PDF
  previews use it today) — no CSP change; the plan includes a config assertion check.
- Copy: the empty state currently promises "body-only emails (no attachment) aren't
  imported" — now they are. Update it (and the `needs_manual_upload` notice, which
  gains the over-cap-body case) to describe forward-and-done: forward a receipt email
  to darren@ from a watched address, or label anything else "DJP Receipts". Grep for
  other body-only copy (owner docs / guide) and update.

### 4.5 What does NOT change

No change to: `ingestReceiptDocument` (already mime-agnostic), commit route,
retention (body docs carry `retain_until` like any receipt), photo upload flow,
statement import, `receiptScanSchema`, audit slugs (the existing
`bookkeeping.gmail_receipt_ingested` covers body ingests via its metadata counters).
Double-count vs a future card-statement import is handled by Phase 2's expense-first
dedupe. Settled-set back-compat is a non-issue: the flag has never been ON in prod,
so no message was ever settled under the old attachmentless rule.

## 5. Decisions

| # | Topic | Decision | Why |
|---|-------|----------|-----|
| B-1 | Body scan mechanism | Text through the existing `receipt_scan` job; no renderer | C-7's renderer assumption was wrong; one pipeline, durable results |
| B-2 | Detection | Forwarder watch (`from:` OR `to:` per address, `-in:sent`) + label kept | Owner wants forward-and-done; label stays as manual override |
| B-3 | Attachment vs body | Attachments win; body only when zero scannable attachments | One receipt, one document; no double ingest |
| B-4 | Unreadable + body | Body ingest settles clean (no unreadable mark, no fingerprint re-open) | Receipt captured; re-open would double-ingest |
| B-5 | Evidence artifact | Raw body bytes stored unmodified as the document; stripping happens at scan time | IRS evidence = what arrived; strip is a scan concern |
| B-6 | Preview | Sandboxed iframe (no scripts) on the signed URL | Third-party HTML must not script; PDFs already frame the host |
| B-7 | Activation | Flag ON after green deploys; owner pre-authorized in brainstorm | Poller output is review-gated; nothing posts unattended |
| B-8 | Prompt hygiene | Email text framed as data-not-instructions in the user message | Cheap injection guard; human review is the real gate |

## 6. Testing

- **Pure (zero-mock):** body-part walker (html preferred, plain fallback, inline
  `data` vs `attachmentId` ref, empty → null); `emailBodyToReceiptText` against
  realistic Google/Vercel/Supabase-shaped HTML fixtures (entities, style blocks,
  forwarded-message wrapper) with assertions on vendor/amount strings surviving and
  the 15 000-char cap; forwarder query builder (multi-address, empty list ⇒ no query).
- **Route:** body-only message → ingest with `gmail:<id>:body` + settle clean;
  message with scannable attachment → body NOT ingested; unreadable-attachment +
  body → body ingested, NOT marked manual-upload; empty body → attachmentless settle;
  forwarder listing unioned with label listing and page-capped; over-cap body →
  unreadable path.
- **Functions:** text branch returns `{ bodyText }` (no sharp call); email user
  message contains the fenced body and the data-not-instructions line; image/PDF
  branches unchanged.
- **Review page:** HTML row renders sandboxed iframe; copy assertions updated.
- **Migration test:** 00196 seeds the forwarders array idempotently.

Targeted runs only + `npm run build`; functions build separately. Known-red baseline
rules apply (Stripe-webhook wall-clock flake — stash-isolate before blaming).

## 7. Rollout

1. Commit per-task on `main` (solo-dev convention), targeted tests green, both builds
   green (root build under the Vercel condition if any new root↔functions seams —
   none expected: twin discipline holds, no cross-imports).
2. Push → Vercel deploy + functions GHA deploy; **verify both green** (memory:
   `npm_build_vs_tsc`).
3. Apply migration 00196 via MCP (additive, inert).
4. Flip `cron_bookkeeping_gmail_receipts_enabled` → `true` via MCP (B-7).
5. Owner actions (report, don't build): optionally set up Gmail auto-forwarding
   yortago→darren@ (one-time verification click per account); nothing else — the
   forwarder watch removes the filter/label requirement.
