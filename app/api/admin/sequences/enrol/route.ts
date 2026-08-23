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

    for (const contactId of parsed.contactIds) {
      try {
        const outcome = await enrolContactManually(contactId, parsed.sequenceKey, {
          onePerContact: parsed.onePerContact,
        })
        tally[outcome.outcome] += 1
        if (outcome.outcome === "sequence_not_active") sequenceStatus = outcome.status
      } catch {
        // Swallowed ON PURPOSE, per contact. See this file's header: the
        // alternative is a 500 that tells the operator nothing about which of
        // their selection was already committed.
        tally.failed += 1
      }
    }

    return NextResponse.json({
      ok: true,
      sequenceKey: parsed.sequenceKey,
      requested: parsed.contactIds.length,
      tally,
      sequenceStatus,
    })
  },
)
