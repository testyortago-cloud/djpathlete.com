// Called by functions bookkeepingGmailReceiptsCron (hourly :20). Reads the
// coach's Gmail via the SHIPPED /admin/inbox OAuth connection
// (platform_connections row "gmail" — no Firebase secrets), lists messages
// under the configured receipt label, and ingests the image attachments the
// vision path can actually decode through the same recipe as photo upload
// (ingestReceiptDocument).
//
// STRICTLY READ-ONLY on the mailbox (Decision C-3): never marks read, never
// touches labels — idempotency is entirely external_ref check-then-insert
// ('gmail:<messageId>:<refKey>', 00193; NEVER an onConflict target).
// Gmail-not-connected / label-missing / token-refresh-failure are SUCCESSFUL
// degraded runs (inbox-SLA precedent, lib/db/inbox-sla.ts) — a missing or
// briefly-unhappy integration must never page. SINGLE cron_runs owner
// "bookkeepingGmailReceiptsCron".
import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped, getSetting, setSetting } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { listBooks, listAccounts, listExternalRefsWithPrefix } from "@/lib/db/bookkeeping"
import {
  getAccessTokenForConnection, listLabels, listMessages, getMessage, getAttachment, GmailNotConnectedError,
} from "@/lib/gmail/client"
import {
  collectReceiptAttachments, countUnusableReceiptAttachments, SCANNABLE_MIMES,
  findReceiptBody, decodeBodyData, messageSubject, MAX_BODY_BYTES,
} from "@/lib/bookkeeping/receipt-attachments"
import { ingestReceiptDocument } from "@/lib/bookkeeping/receipt-ingest"
import { isPdfMime, pdfRejectionReasonForBuffer } from "@/lib/bookkeeping/receipt-pdf"
import {
  GMAIL_SETTLED_IDS_KEY, GMAIL_UNREADABLE_IDS_KEY, GMAIL_SCANNABLE_MIMES_KEY,
  GMAIL_MESSAGE_ATTEMPTS_KEY, GMAIL_RECEIPT_LABEL_KEY, GMAIL_RECEIPTS_CRON_KEY,
  DEFAULT_GMAIL_RECEIPT_LABEL, buildForwarderQuery, GMAIL_RECEIPT_FORWARDERS_KEY,
  GMAIL_RECEIPT_FORWARDERS_SINCE_KEY, buildReceiptQuery, GMAIL_RECEIPT_QUERY_KEY,
  GMAIL_RECEIPT_QUERY_WINDOW_KEY,
} from "@/lib/bookkeeping/email-receipts"
import { recordAudit } from "@/lib/audit/record"

export const runtime = "nodejs"
export const maxDuration = 300

/** Cap on NEW (not-yet-settled) messages fully fetched per run — bounds
 *  Gmail getMessage calls; the remainder is picked up next hour
 *  (more_pending in detail). Backlog labeling Just Works (Decision C-8). */
export const MAX_MESSAGES_PER_RUN = 25
/** Hard stop on the label listing loop. Listing is cheap per page but a
 *  mislabeled 50k-message mailbox would otherwise spend the whole 300s budget
 *  building an id array we can only ever consume 25 of. */
export const MAX_LIST_PAGES = 40
/** Consecutive failed runs after which a message is force-settled (poison
 *  pill). Without it a permanently-broken attachment — a Gmail part that 404s,
 *  a buffer sharp can never open — stays unsettled forever and burns one of
 *  the MAX_MESSAGES_PER_RUN slots on every run for the life of the mailbox.
 *  It is recorded as needing manual upload, not thrown away. */
export const MAX_MESSAGE_ATTEMPTS = 5
const DEFAULT_LABEL = DEFAULT_GMAIL_RECEIPT_LABEL

/** Durable "this message needs no further work" marker set (system_settings
 *  jsonb array of Gmail message ids).
 *
 *  WHY IT EXISTS: without it, a message that yields nothing usable (a body-only
 *  HTML receipt — the common Uber/Amazon shape that Decision C-7 says will not
 *  import, or an email whose only attachment is an unscannable PDF) consumes a
 *  slot of MAX_MESSAGES_PER_RUN on EVERY run and never drops out of the working
 *  set. Gmail lists newest-first, so 26 such emails permanently starve an older
 *  message that really does carry the receipt: the run keeps succeeding while
 *  the receipt is never ingested, and the only signal is more_pending in a
 *  cron_runs detail nothing alerts on.
 *
 *  A message settles when (a) it produced no ingestible attachment, (b) every
 *  ingestible attachment landed with no failure, or (c) it hit
 *  MAX_MESSAGE_ATTEMPTS. A message with a FAILED attachment under that cap
 *  deliberately stays unsettled so the next run retries it.
 *
 *  Settling is NOT forgetting: case (a) with receipt-shaped-but-unreadable
 *  attachments and case (c) also land in GMAIL_UNREADABLE_IDS_KEY, which the
 *  review surface reports and which the mime-fingerprint check re-opens. */
export const SETTLED_IDS_KEY = GMAIL_SETTLED_IDS_KEY
/** Newest-N cap on the stored marker sets. Truncation is safe: a truncated id
 *  is merely re-fetched once, and the per-attachment external_ref check below
 *  still prevents a duplicate ingest. */
export const MAX_SETTLED_IDS = 5000

function asStringSet(stored: unknown): Set<string> {
  return new Set<string>(
    Array.isArray(stored) ? stored.filter((v): v is string => typeof v === "string") : [],
  )
}

function asAttemptRecord(stored: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v
    }
  }
  return out
}

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const authHeader = request.headers.get("authorization") ?? ""
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({
    enabledKey: GMAIL_RECEIPTS_CRON_KEY,
    defaultEnabled: false,
  })
  // `skipped` is a string here and a count on a real run (income-sync
  // convention) — skipped_reason is the single-typed alias for consumers.
  if (gate.skipped) {
    return NextResponse.json({ skipped: gate.reason, skipped_reason: gate.reason }, { status: 200 })
  }

  const supabase = createServiceRoleClient()
  const runId = await logCronStart(supabase, "bookkeepingGmailReceiptsCron")
  try {
    const labelName = await getSetting<string>(GMAIL_RECEIPT_LABEL_KEY, DEFAULT_LABEL)

    let accessToken: string
    try {
      ;({ accessToken } = await getAccessTokenForConnection())
    } catch (err) {
      // EVERY auth-side failure is a degraded success, not a run failure.
      // getAccessTokenForConnection marks platform_connections 'error' on any
      // refresh throw, so a single Google 5xx already costs the coach a
      // reconnect prompt — it must not ALSO fail the cron and page the
      // automation-health watchdog. The next hourly run retries and
      // self-heals (lib/gmail/client.ts clears 'error' on a good refresh).
      const notConnected = err instanceof GmailNotConnectedError
      const detail = {
        fetch_status: "degraded",
        fetch_detail: notConnected ? "gmail_not_connected" : "gmail_auth_failed",
        label: labelName,
        ...(notConnected ? {} : { message: err instanceof Error ? err.message : String(err) }),
      }
      if (!notConnected) console.warn("[bookkeeping-gmail-receipts] token refresh failed:", err)
      await logCronEnd(supabase, runId, "success", detail)
      return NextResponse.json({ ok: true, ...detail })
    }

    const labels = await listLabels(accessToken)
    const label = labels.find((l) => l.name === labelName)
    const forwarderQuery = buildForwarderQuery(
      await getSetting<unknown>(GMAIL_RECEIPT_FORWARDERS_KEY, []),
      await getSetting<unknown>(GMAIL_RECEIPT_FORWARDERS_SINCE_KEY, null),
    )
    // Vendor watch: mail that is neither labelled nor forwarded — an invoice a
    // vendor sends straight to the coach. Empty setting ⇒ source off.
    const receiptQuery = buildReceiptQuery(
      await getSetting<unknown>(GMAIL_RECEIPT_QUERY_KEY, ""),
      await getSetting<unknown>(GMAIL_RECEIPT_QUERY_WINDOW_KEY, null),
    )
    // Degraded ONLY when NO source at all exists — a missing label with a
    // configured forwarder or vendor watch is a note, not an outage.
    if (!label && !forwarderQuery && !receiptQuery) {
      const detail = { fetch_status: "degraded", fetch_detail: "label_not_found", label: labelName }
      await logCronEnd(supabase, runId, "success", detail)
      return NextResponse.json({ ok: true, ...detail })
    }

    const books = await listBooks()
    const book = books.find((b) => b.is_primary && b.book_kind === "business")
    if (!book) throw new Error("No primary business book found")
    const accountRows = await listAccounts(book.id)
    const accounts = accountRows.map((a) => ({ name: a.name, account_type: a.account_type }))

    const settled = asStringSet(await getSetting<unknown>(SETTLED_IDS_KEY, []))
    const unreadable = asStringSet(await getSetting<unknown>(GMAIL_UNREADABLE_IDS_KEY, []))
    const attempts = asAttemptRecord(await getSetting<unknown>(GMAIL_MESSAGE_ATTEMPTS_KEY, {}))
    let settledDirty = false
    let unreadableDirty = false
    let attemptsDirty = false

    // Widening (or narrowing) the readable-mime allow-list retroactively
    // re-opens every message we settled ONLY because we could not read its
    // attachments. Without this, adding application/pdf to SCANNABLE_MIMES
    // would silently keep ignoring every PDF receipt already labeled.
    const mimeFingerprint = [...SCANNABLE_MIMES].join(",")
    const storedFingerprint = await getSetting<string>(GMAIL_SCANNABLE_MIMES_KEY, "")
    let reconsidered = 0
    if (storedFingerprint !== mimeFingerprint) {
      for (const id of unreadable) if (settled.delete(id)) reconsidered++
      unreadable.clear()
      settledDirty = true
      unreadableDirty = true
      await setSetting(GMAIL_SCANNABLE_MIMES_KEY, mimeFingerprint)
    }

    let processed = 0
    let skipped = 0
    let ingested = 0
    let bodyIngested = 0
    let attachmentless = 0
    let unsupportedAttachments = 0
    let oversizedAttachments = 0
    let needsManualUpload = 0
    let poisoned = 0
    let failed = 0
    const failures: string[] = []
    let more_pending = false

    // Two listing sources, unioned + deduped: the coach's explicit label set,
    // and the forwarder watch (Decision B-2). Bounded twice ACROSS BOTH: stop
    // as soon as we have more unsettled ids than one run can consume, and
    // hard-stop at MAX_LIST_PAGES total.
    const sources: Array<{ kind: "label" | "forwarder" | "query"; labelIds?: string[]; q?: string }> = []
    if (label) sources.push({ kind: "label", labelIds: [label.id] })
    if (forwarderQuery) sources.push({ kind: "forwarder", q: forwarderQuery })
    // The vendor watch is listed LAST on purpose. Listing stops as soon as more
    // unsettled ids are seen than one run can consume, so whichever source is
    // listed last is the one that starves — and this is by far the broadest.
    if (receiptQuery) sources.push({ kind: "query", q: receiptQuery })

    const messageIds: string[] = []
    const listedIds = new Set<string>()
    const listingFailures: string[] = []
    let pages = 0
    let unsettledSeen = 0
    let forwarderListed = 0
    let queryListed = 0
    listing: for (const [sourceIndex, source] of sources.entries()) {
      const { kind, ...listOpts } = source
      let pageToken: string | undefined
      // Per-source isolation, the same reflex as the per-message and
      // per-attachment isolation below: the vendor watch carries a RAW Gmail
      // query out of settings, so one typo 400s the API. That must cost this
      // source its run, never the label and forwarder sources theirs — and it
      // must be recorded rather than swallowed into a clean-looking success.
      try {
        do {
          const page = await listMessages(accessToken, { ...listOpts, pageToken })
          for (const m of page.messages ?? []) {
            if (listedIds.has(m.id)) continue
            listedIds.add(m.id)
            messageIds.push(m.id)
            if (kind === "forwarder") forwarderListed++
            if (kind === "query") queryListed++
            if (!settled.has(m.id)) unsettledSeen++
          }
          pageToken = page.nextPageToken
          pages++
          if (unsettledSeen > MAX_MESSAGES_PER_RUN) {
            more_pending = true
            break listing
          }
          if (pages >= MAX_LIST_PAGES) {
            if (pageToken || sourceIndex < sources.length - 1) more_pending = true
            break listing
          }
        } while (pageToken)
      } catch (listErr) {
        const msg = listErr instanceof Error ? listErr.message : String(listErr)
        listingFailures.push(`${kind}: ${msg}`)
        console.error(`[bookkeeping-gmail-receipts] ${kind} listing failed:`, listErr)
      }
    }

    /** Settle + reset the retry counter. */
    const settle = (messageId: string) => {
      settled.add(messageId)
      settledDirty = true
      if (messageId in attempts) {
        delete attempts[messageId]
        attemptsDirty = true
      }
    }
    const markUnreadable = (messageId: string) => {
      unreadable.add(messageId)
      unreadableDirty = true
    }
    const noteFailure = (ref: string, err: unknown) => {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      if (failures.length < 5) failures.push(`${ref}: ${msg}`)
      console.error(`[bookkeeping-gmail-receipts] ${ref} failed:`, err)
    }

    for (const messageId of messageIds) {
      // Settled first: an already-answered message must never consume a slot
      // of the per-run budget (that is the starvation bug) and costs zero IO.
      if (settled.has(messageId)) {
        skipped++
        continue
      }
      if (processed >= MAX_MESSAGES_PER_RUN) {
        more_pending = true
        break
      }
      processed++
      let failedHere = 0

      // getMessage lives INSIDE the per-message isolation, symmetric with
      // getAttachment/ingest below: one 404'd or malformed message must not
      // 500 the run and strand every sibling still in the list.
      let full: Awaited<ReturnType<typeof getMessage>> | null = null
      try {
        full = await getMessage(accessToken, messageId)
      } catch (msgErr) {
        failedHere++
        noteFailure(`gmail:${messageId} getMessage`, msgErr)
      }

      if (full) {
        const unusable = countUnusableReceiptAttachments(full.payload)
        unsupportedAttachments += unusable.unsupportedMime
        oversizedAttachments += unusable.oversized
        const attachments = collectReceiptAttachments(full.payload)

        /** Body fallback shared by the no-attachments branch AND the
         *  every-attachment-rejected branch (the fal shape — a Stripe invoice
         *  email whose attached PDF fails the page/parse gate but whose body
         *  carries the amounts). Ingests the body once, idempotent on
         *  gmail:<id>:body; the caller decides settle/flag/attempts from the
         *  outcome. */
        const tryBodyFallback = async (): Promise<"ingested" | "skipped" | "none" | "overcap" | "failed"> => {
          const body = findReceiptBody(full!.payload)
          if (!body) return "none"
          if (body.size > MAX_BODY_BYTES) return "overcap"
          const externalRef = `gmail:${messageId}:body`
          const existingRefs = new Set(await listExternalRefsWithPrefix(`gmail:${messageId}:`))
          if (existingRefs.has(externalRef)) return "skipped"
          try {
            const buffer = body.data
              ? decodeBodyData(body.data)
              : await getAttachment(accessToken, messageId, body.attachmentId!)
            const subject = messageSubject(full!.payload)
            await ingestReceiptDocument({
              bookId: book.id,
              buffer,
              mimeType: body.mimeType,
              originalFilename: `${(subject ?? "Email receipt").slice(0, 120)}${body.mimeType === "text/html" ? ".html" : ".txt"}`,
              uploadedBy: null,
              externalRef,
              accounts,
              bookName: book.name,
              bookKind: book.book_kind,
            })
            bodyIngested++
            return "ingested"
          } catch (bodyErr) {
            // Leaves the message unsettled via failedHere — retried next run,
            // poisoned at the cap.
            failedHere++
            noteFailure(externalRef, bodyErr)
            return "failed"
          }
        }

        if (attachments.length === 0) {
          // Body-only receipt (spec 2026-08-02, supersedes C-7): the raw body
          // IS the receipt document; the scan job reads it as text. Settles
          // CLEAN even when unreadable attachments exist (B-4) — the receipt
          // is captured, so no manual-upload flag and no fingerprint re-open.
          const outcome = await tryBodyFallback()
          if (outcome === "ingested" || outcome === "skipped") {
            if (outcome === "skipped") skipped++
            settle(messageId)
            continue
          }
          if (outcome !== "failed") {
            if (outcome === "overcap" || unusable.unsupportedMime + unusable.oversized > 0) {
              // The email DID carry a receipt — we just cannot read it (HEIC,
              // an over-cap body, or over the caps) and nothing else worked.
              needsManualUpload++
              markUnreadable(messageId)
            } else {
              // Nothing usable at all (empty body, no attachments).
              attachmentless++
            }
            settle(messageId)
            continue
          }
          // "failed" falls through to the attempts block below.
        } else {
          // Idempotency is PER ATTACHMENT, not per message: a run that ingested
          // part 1 and then died on part 2 must retry only part 2 next hour.
          const existingRefs = new Set(await listExternalRefsWithPrefix(`gmail:${messageId}:`))
          // capturedHere: attachments that ingested now OR in an earlier run —
          // either way the receipt is on file and the body must not double it.
          let capturedHere = 0
          let rejectedHere = 0
          for (const att of attachments) {
            const externalRef = `gmail:${messageId}:${att.refKey}`
            if (existingRefs.has(externalRef)) {
              skipped++
              capturedHere++
              continue
            }
            try {
              const buffer = await getAttachment(accessToken, messageId, att.attachmentId)

              // Same page cap as the upload button, applied here because this is
              // the first point that has bytes (collectReceiptAttachments sees
              // only part metadata). pdfRejectionReasonForBuffer never throws,
              // so a corrupt PDF cannot 500 the run and strand this message's
              // sibling attachments. The manual-upload flagging is deferred
              // below: when EVERY attachment is rejected, the body gets a shot
              // first (2026-08-02 amendment — attachments win only when one
              // actually ingests).
              if (isPdfMime(att.mimeType)) {
                const reason = await pdfRejectionReasonForBuffer(buffer)
                if (reason) {
                  unsupportedAttachments++
                  rejectedHere++
                  continue
                }
              }

              await ingestReceiptDocument({
                bookId: book.id,
                buffer,
                mimeType: att.mimeType,
                originalFilename: att.filename,
                uploadedBy: null,
                externalRef,
                accounts,
                bookName: book.name,
                bookKind: book.book_kind,
              })
              ingested++
              capturedHere++
            } catch (attErr) {
              // One bad part must not abort the run and strand its siblings — a
              // 500 here would leave the sibling documents written while the
              // message never gets retried. Count it, keep going, stay unsettled.
              failedHere++
              noteFailure(externalRef, attErr)
            }
          }

          if (rejectedHere > 0) {
            const bodyOutcome =
              capturedHere === 0 && failedHere === 0 ? await tryBodyFallback() : "none"
            if (bodyOutcome === "ingested" || bodyOutcome === "skipped") {
              // Receipt captured via the body — settle clean (B-4), no
              // manual-upload flag, no fingerprint re-open.
              if (bodyOutcome === "skipped") skipped++
            } else if (bodyOutcome !== "failed") {
              // Rejected attachments with no fallback: keep the pre-amendment
              // accounting — one manual-upload flag per rejected part, and the
              // unreadable mark so a future format widening re-opens it.
              needsManualUpload += rejectedHere
              markUnreadable(messageId)
            }
            // "failed" → the attempts block below keeps the message unsettled.
          }
        }
      }

      if (failedHere === 0) {
        settle(messageId)
        continue
      }
      const tries = (attempts[messageId] ?? 0) + 1
      attempts[messageId] = tries
      attemptsDirty = true
      if (tries >= MAX_MESSAGE_ATTEMPTS) {
        poisoned++
        markUnreadable(messageId)
        settle(messageId) // also clears the counter
      }
    }

    if (settledDirty) await setSetting(SETTLED_IDS_KEY, [...settled].slice(-MAX_SETTLED_IDS))
    if (unreadableDirty) await setSetting(GMAIL_UNREADABLE_IDS_KEY, [...unreadable].slice(-MAX_SETTLED_IDS))
    if (attemptsDirty) {
      const entries = Object.entries(attempts).slice(-MAX_SETTLED_IDS)
      await setSetting(GMAIL_MESSAGE_ATTEMPTS_KEY, Object.fromEntries(entries))
    }

    const detail = {
      fetch_status: "ok", label: labelName,
      ...(label ? {} : { label_missing: true }),
      listed: messageIds.length, processed, skipped, attachmentless,
      unsupported_attachments: unsupportedAttachments,
      oversized_attachments: oversizedAttachments,
      needs_manual_upload: needsManualUpload,
      unreadable_backlog: unreadable.size,
      poisoned, reconsidered, ingested, body_ingested: bodyIngested, forwarder_listed: forwarderListed,
      query_listed: queryListed, failed,
      ...(failures.length > 0 ? { failures } : {}),
      ...(listingFailures.length > 0 ? { listing_failures: listingFailures } : {}),
      more_pending,
    }
    if (ingested + bodyIngested > 0) {
      void recordAudit({
        action: "bookkeeping.gmail_receipt_ingested",
        category: "commerce",
        outcome: "success",
        actor: { id: null, email: "bookkeepingGmailReceiptsCron", role: "system" },
        target: { type: "bookkeeping_book", id: book.id },
        metadata: detail,
      })
    }
    await logCronEnd(supabase, runId, "success", detail)
    return NextResponse.json({ ok: true, ...detail })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[bookkeeping-gmail-receipts] failed:", err)
    await logCronEnd(supabase, runId, "failed", { message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
