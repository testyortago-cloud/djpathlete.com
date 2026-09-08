// app/api/admin/sequences/[key]/status/route.ts — turning a sequence on or off.
//
// ADMIN-ONLY, NOT PERMISSION-TIERED. Same precedent
// app/api/admin/sequences/enrol/route.ts states in its own header: switching
// a sequence ON starts sending real email to real people, in the business's
// name, for EVERYONE who enters from now on — a wider blast radius than
// enrolling a handful of contacts by hand, not a narrower one. So this route
// copies that route's auth shape exactly, rather than gating on the
// `contacts` permission, which only lets someone VIEW /admin/sequences.
//
// WRITES `active` OR `paused` ONLY — see §4.1 of the design doc.
// `sequences_status_check` also allows `draft` and `archived`, but there is no
// toggle position that means either one; both are read as "off" on the list,
// never written here.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { setSequenceStatus } from "@/lib/db/sequence-admin"
import { setSequenceStatusRequestSchema } from "@/lib/validators/sequence-admin"
import { NoAccessibleBusinessError, resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"

export const PATCH = withAudit(
  {
    action: "sequence.status_changed",
    category: "admin_write",
    // Read from the URL, not the body — unlike the enrol route's target
    // resolver, nothing else here needs to read the request body, so there is
    // no clone/original split to worry about.
    target: async (_request, ctx) => {
      const { key } = (await ctx.params) as { key: string }
      return { type: "sequence", id: key }
    },
    // COUNTS AND THE KEY ONLY — no contact ids, no email addresses, no phone
    // numbers, matching the rule the enrol route states for its own row.
    // "from"/"to" are sequence STATUSES ("active"/"paused"), not personal data.
    metadata: async (_request, response) => {
      const body = (await response.json().catch(() => null)) as {
        sequenceKey?: string
        from?: string
        to?: string
      } | null
      if (!body) return {}
      return { sequence_key: body.sequenceKey, from: body.from, to: body.to }
    },
  },
  async (request, context) => {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    let businessId: string
    try {
      ;({ businessId } = await resolveAdminTenantForRequest(request))
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      throw err
    }

    const { key } = (await context.params) as { key: string }

    const raw = await request.json().catch(() => null)
    const parsed = setSequenceStatusRequestSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: "Expected { on: boolean }." }, { status: 400 })
    }

    // The whole mapping: `on` -> "active", off -> "paused". Never "draft",
    // never "archived" — see this file's header.
    const status = parsed.data.on ? "active" : "paused"

    try {
      const result = await setSequenceStatus(businessId, key, status)
      if (!result) {
        return NextResponse.json({ error: "Sequence not found." }, { status: 404 })
      }
      return NextResponse.json({ ok: true, sequenceKey: key, from: result.from, to: status })
    } catch (error) {
      console.error("[PATCH /api/admin/sequences/:key/status]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)
