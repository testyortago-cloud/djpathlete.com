// app/api/admin/sequences/[key]/settings/route.ts — a sequence's settings.
// Today that is one field: `reenrol_cooldown_days` (migration 00263), how
// long a contact must be out of this sequence before a trigger may put them
// back in.
//
// ADMIN-ONLY, NOT PERMISSION-TIERED, for the same reason the status route
// gives in its own header: this changes what the engine does for EVERYONE who
// re-triggers the sequence from now on, which is a wider blast radius than
// enrolling a handful of contacts by hand.
//
// Reads the key from the URL and the value from the body; the body's own
// `key`, if any, is ignored. Copies the status route's auth shape exactly.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { setSequenceReenrolCooldown } from "@/lib/db/sequence-admin"
import { setSequenceReenrolCooldownRequestSchema } from "@/lib/validators/sequence-admin"
import { NoAccessibleBusinessError, resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"

const BAD_BODY = "Enter a whole number of days between 0 and 365."

export const PATCH = withAudit(
  {
    action: "sequence.settings_changed",
    category: "admin_write",
    target: async (_request, ctx) => {
      const { key } = (await ctx.params) as { key: string }
      return { type: "sequence", id: key }
    },
    // The key, the setting's column name and its before/after value — no
    // contact ids, no email addresses, matching the status route's rule.
    metadata: async (_request, response) => {
      const body = (await response.json().catch(() => null)) as {
        sequenceKey?: string
        from?: number
        to?: number
      } | null
      if (!body) return {}
      return { sequence_key: body.sequenceKey, setting: "reenrol_cooldown_days", from: body.from, to: body.to }
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
    const parsed = setSequenceReenrolCooldownRequestSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: BAD_BODY }, { status: 400 })
    }
    const days = parsed.data.reenrolCooldownDays

    try {
      const result = await setSequenceReenrolCooldown(businessId, key, days)
      if (!result) {
        return NextResponse.json({ error: "Sequence not found." }, { status: 404 })
      }
      return NextResponse.json({ ok: true, sequenceKey: key, from: result.from, to: days })
    } catch (error) {
      console.error("[PATCH /api/admin/sequences/:key/settings]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)
