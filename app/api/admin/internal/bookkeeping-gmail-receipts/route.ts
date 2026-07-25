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
} from "@/lib/bookkeeping/receipt-attachments"
import { ingestReceiptDocument } from "@/lib/bookkeeping/receipt-ingest"
import {
  GMAIL_SETTLED_IDS_KEY, GMAIL_UNREADABLE_IDS_KEY, GMAIL_SCANNABLE_MIMES_KEY,
  GMAIL_MESSAGE_ATTEMPTS_KEY, GMAIL_RECEIPT_LABEL_KEY, GMAIL_RECEIPTS_CRON_KEY,
  DEFAULT_GMAIL_RECEIPT_LABEL,
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
    if (!label) {
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
    let attachmentless = 0
    let unsupportedAttachments = 0
    let oversizedAttachments = 0
    let needsManualUpload = 0
    let poisoned = 0
    let failed = 0
    const failures: string[] = []
    let more_pending = false

    // Label-only listing, no date bound (Decision C-8) — the label is the
    // coach's explicit opt-in set; per-message skip keeps re-polls cheap.
    // Bounded twice: we stop as soon as we have more unsettled ids than one
    // run can consume, and hard-stop at MAX_LIST_PAGES either way.
    const messageIds: string[] = []
    let pageToken: string | undefined
    let pages = 0
    let unsettledSeen = 0
    do {
      const page = await listMessages(accessToken, { labelIds: [label.id], pageToken })
      for (const m of page.messages ?? []) {
        messageIds.push(m.id)
        if (!settled.has(m.id)) unsettledSeen++
      }
      pageToken = page.nextPageToken
      pages++
      if (unsettledSeen > MAX_MESSAGES_PER_RUN) {
        more_pending = true
        break
      }
      if (pages >= MAX_LIST_PAGES) {
        if (pageToken) more_pending = true
        break
      }
    } while (pageToken)

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

        if (attachments.length === 0) {
          if (unusable.unsupportedMime + unusable.oversized > 0) {
            // The email DID carry a receipt — we just cannot read it (PDF/HEIC,
            // or over the 10MB cap). Settled so it never starves the budget,
            // but recorded so the review surface can say "upload these by
            // photo" and so a future SCANNABLE_MIMES change re-opens it.
            needsManualUpload++
            markUnreadable(messageId)
          } else {
            // Body-only email — produces nothing, v1 by design (Decision C-7).
            attachmentless++
          }
          settle(messageId)
          continue
        }

        // Idempotency is PER ATTACHMENT, not per message: a run that ingested
        // part 1 and then died on part 2 must retry only part 2 next hour.
        const existingRefs = new Set(await listExternalRefsWithPrefix(`gmail:${messageId}:`))
        for (const att of attachments) {
          const externalRef = `gmail:${messageId}:${att.refKey}`
          if (existingRefs.has(externalRef)) {
            skipped++
            continue
          }
          try {
            const buffer = await getAttachment(accessToken, messageId, att.attachmentId)
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
          } catch (attErr) {
            // One bad part must not abort the run and strand its siblings — a
            // 500 here would leave the sibling documents written while the
            // message never gets retried. Count it, keep going, stay unsettled.
            failedHere++
            noteFailure(externalRef, attErr)
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
      listed: messageIds.length, processed, skipped, attachmentless,
      unsupported_attachments: unsupportedAttachments,
      oversized_attachments: oversizedAttachments,
      needs_manual_upload: needsManualUpload,
      unreadable_backlog: unreadable.size,
      poisoned, reconsidered, ingested, failed,
      ...(failures.length > 0 ? { failures } : {}),
      more_pending,
    }
    if (ingested > 0) {
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
