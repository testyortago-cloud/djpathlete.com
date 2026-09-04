// app/api/admin/sequences/enrol/route.ts — a human putting selected contacts
// into a sequence by hand. Body: { contactIds: string[], sequenceKey, onePerContact? }.
//
// THE POINT OF THIS FILE. `enrolContactManually` (lib/lead-engine/enroll.ts)
// has existed since migration 00223 and had exactly one caller in the whole
// repo: `scripts/enrol-repermission.ts`. Nothing in `app/` ever called it, so
// `cold_lead_re_engagement` — seeded by migration 00218 with
// `trigger_source = NULL`, meaning manual enrolment is the ONLY way anyone
// gets into it — could not be reached at all from the product. Migration
// 00218's own table records the gap in as many words: "No — no manual-enrol
// surface exists yet". This is that surface's back end.
//
// Deliberately thin, the same shape as app/api/admin/pipeline/move/route.ts:
// auth, parse, loop, tally, respond. Every consequence of an enrolment is
// already `enrolContactManually`'s job and is NOT reimplemented here — the
// active-sequence refusal, the duplicate-run guard (a 23505 on
// `sequence_runs_one_active_per_sequence`), and the optional
// one-per-contact-ever check. Reimplementing any of them would be a second
// copy of a safety rule that could drift from the real one.
//
// ADMIN-ONLY, NOT PERMISSION-TIERED. Enrolling someone into a sequence causes
// EMAIL TO BE SENT TO A REAL PERSON — a marketing message, to a member of the
// public, in the business's name. That is not a "leads"-shaped permission, so
// staff are refused here for the same reason they are refused on the pipeline
// move route.
//
// ONE FAILURE NEVER ABORTS THE REST. `enrolContactManually` throws on a real
// database error, so the loop catches per contact and counts a `failed`.
// Letting the first bad row 500 the request would leave the operator with no
// idea which of their selection went through — and every enrolment before the
// throw would already be committed.
//
// CAUGHT IS NOT THE SAME AS IGNORED, though. Each caught error is logged with
// its contact id, and a batch that enrolled NOBODY while something threw
// answers 500 rather than 200, so `withAudit` records it as a failure and the
// 24h-failure strip on /admin/audit-logs can see it. The response body carries
// the tally either way. Both rules are argued at the return statement.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { enrolContactManually } from "@/lib/lead-engine/enroll"
import { emptyTally, parseEnrolRequest, type EnrolTally } from "@/lib/lead-engine/manual-enrol"

// One enrolment is a `sequences` lookup plus a `sequence_runs` insert, run
// sequentially. A full batch (100, the cap in lib/lead-engine/manual-enrol.ts)
// finishes well inside this, and a request that is going to be killed anyway
// is better killed after the tally exists than half way through the loop.
export const maxDuration = 60

export const POST = withAudit(
  {
    action: "sequence.contacts_enrolled",
    category: "admin_write",
    // Reads the ORIGINAL (still-unconsumed) request — the handler below parses
    // a CLONE of it, so this is the first real read regardless of which branch
    // the handler took, including the 401/403 paths.
    target: async (request) => {
      const body = (await request.json().catch(() => null)) as { sequenceKey?: unknown } | null
      return typeof body?.sequenceKey === "string" && body.sequenceKey.length > 0
        ? { type: "sequence", id: body.sequenceKey }
        : undefined
    },
    // COUNTS AND A KEY, NOTHING THAT NAMES A PERSON. Not the contact ids, not
    // an email, not a phone number — same rule lib/lead-engine/unsubscribe.ts
    // states for its own row, and for the same reason: an audit trail that
    // mirrors the contact table is a second copy of the personal data with a
    // different retention rule attached to it. "Who was enrolled" is already
    // answerable from `sequence_runs`, whose rows this action created.
    //
    // NAMED FIELDS, NEVER `...body`. The response now also carries
    // `failedContactIds` so the screen can re-tick exactly the ones that threw,
    // and that list must not follow it into the audit row. Spreading the whole
    // body here would put it there the day it was added, silently.
    metadata: async (_request, response) => {
      const body = (await response.json().catch(() => null)) as {
        tally?: EnrolTally
        requested?: number
        sequenceKey?: string
      } | null
      if (!body?.tally) return {}
      return { sequence_key: body.sequenceKey, requested: body.requested, ...body.tally }
    },
  },
  async (request) => {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const raw = await request
      .clone()
      .json()
      .catch(() => null)
    const parsed = parseEnrolRequest(raw)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const tally: EnrolTally = emptyTally()
    // The status the sequence reported when it refused. Carried back so the
    // screen can say "this sequence is still a draft" rather than "it did not
    // work" — see `describeEnrolResult` in lib/lead-engine/manual-enrol.ts for
    // why that distinction is the whole point of this surface's error path.
    let sequenceStatus: string | null = null
    // WHICH contacts threw, not just how many. Counts alone made the screen's
    // "try those again" an instruction nobody could follow: no row on the page
    // is marked as failed and the audit row deliberately holds no ids, so
    // retrying three of ten meant re-ticking all ten. These ids go back to the
    // admin who supplied them one moment earlier — they are NOT allowed into
    // the audit metadata above, which stays counts and a sequence key.
    const failedContactIds: string[] = []

    // FOLLOW-UP, NOT YET DONE: no businessId is passed here, so
    // enrolContactManually (lib/lead-engine/enroll.ts) defaults it to
    // SINGLETON_BUSINESS_ID regardless of which business the caller actually
    // belongs to. The contact-detail page's "Add to a sequence" picker (Task
    // 13) is now correctly scoped to the caller's own business, so a
    // non-singleton coach ordinarily gets a loud `sequence_not_found` here —
    // not silent, because the picked key does not exist under the singleton.
    // But the seeded sequence keys are generic templates
    // (`new_lead_nurture`, `cold_lead_re_engagement`), so a second business
    // provisioned from the same templates COLLIDES on those keys and gets a
    // silent success: a `sequence_runs` row written against the singleton's
    // sequence, carrying this business's own contact_id. Needs
    // resolveAdminTenantForRequest threaded through to `enrolContactManually`
    // (and its own test suite retargeted, not just extended) in a follow-up
    // task — not attempted here.
    for (const contactId of parsed.contactIds) {
      try {
        const outcome = await enrolContactManually(contactId, parsed.sequenceKey, {
          onePerContact: parsed.onePerContact,
        })
        tally[outcome.outcome] += 1
        if (outcome.outcome === "sequence_not_active") sequenceStatus = outcome.status
      } catch (error) {
        // NOT re-thrown, per contact. See this file's header: the alternative is
        // a 500 that tells the operator nothing about which of their selection
        // was already committed.
        //
        // But it IS logged. This catch used to be a bare `} catch {` with no
        // binding, so a broken enrol path — Supabase down, an RLS or schema
        // break — produced a hundred failures and left the reason nowhere at
        // all: not in the response, not in the audit row, not in a log.
        console.error(`[sequences/enrol] contact ${contactId} failed to enrol into ${parsed.sequenceKey}:`, error)
        tally.failed += 1
        failedContactIds.push(contactId)
      }
    }

    // A batch that added NOBODY and hit at least one real database error is a
    // failed request, and must be recorded as one.
    //
    // `classifyOutcome` in lib/audit/with-audit.ts maps every 2xx to
    // `outcome: "success"`, so the old unconditional 200 wrote a hundred broken
    // enrolments into `audit_logs` looking like a hundred good ones — and the
    // 24h-failure strip at the top of /admin/audit-logs, the one thing that
    // surfaces a silent breakage to somebody who is not already looking, stayed
    // quiet. Metadata counts alone would not have fixed that: they only help a
    // person who has already opened the row.
    //
    // A batch that enrolled somebody stays 200 even with failures in it — real
    // people are in the sequence and will be emailed, so it is not a failed
    // request; the `failed` count rides along in the audit metadata instead.
    // And a whole batch refused by a draft sequence stays 200 too: nothing
    // threw, and calling this product's own seeded state an outage would fire
    // the failure strip every time somebody tried the first thing they try.
    //
    // THE BODY IS THE SAME EITHER WAY. The tally is what the screen has to say
    // something true about, and "could not reach the server" is not it — see
    // the `body?.tally` check in components/admin/contacts/ContactsTable.tsx,
    // which reads the tally before it reads the status.
    const nothingWorked = tally.enrolled === 0 && tally.failed > 0

    return NextResponse.json(
      {
        ok: !nothingWorked,
        ...(nothingWorked ? { error: "Every contact in this batch failed to enrol." } : {}),
        sequenceKey: parsed.sequenceKey,
        requested: parsed.contactIds.length,
        tally,
        failedContactIds,
        sequenceStatus,
      },
      { status: nothingWorked ? 500 : 200 },
    )
  },
)
