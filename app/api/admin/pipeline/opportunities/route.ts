// app/api/admin/pipeline/opportunities/route.ts — a coach putting a person on
// a pipeline board BY HAND: a phone call, a DM, somebody met at a camp. Body:
// { pipelineId: string; contactId?: string; person?: { name: string;
// email?: string; phone?: string }; valueCents?: number }.
//
// Same template as the other routes in this directory: withAudit, auth() ->
// 401, canAccessAdminPath -> 403, resolveAdminTenantForRequest with the
// NoAccessibleBusinessError -> 403 branch, a foreign/nonexistent board ->
// 404 (PipelineBoardNotFoundError from the DAL), every other readable DAL
// refusal -> 400.
//
// THE ONE THING THIS ROUTE MUST NEVER DO: enrol anybody in a sequence. That
// is enforced structurally in `createOpportunityManually`
// (lib/db/pipeline.ts) — it resolves the contact through
// `upsertContactIdentity` / `recordEventForExistingContact`
// (lib/db/contacts.ts), never `recordContactEvent`, which is the one
// function that calls `enrollIfTriggered`. This route adds nothing on top of
// that and must not grow a second contact-resolution path that bypasses it.

import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { NoAccessibleBusinessError, resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { PipelineBoardNotFoundError, createOpportunityManually } from "@/lib/db/pipeline"
// Type-only, so the closed audit taxonomy is checked at compile time — a
// slug that is not a row in `AUDIT_ACTIONS` stops the build instead of
// writing a row the log viewer cannot name. Same convention as every other
// route in this directory.
import type { AuditAction } from "@/lib/audit/actions"

const MAX_NAME_LENGTH = 200

const OPPORTUNITY_CREATED_MANUALLY_AUDIT_ACTION: AuditAction = "pipeline.opportunity_created_manually"

const PersonSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(MAX_NAME_LENGTH, `Name must be ${MAX_NAME_LENGTH} characters or fewer.`),
    email: z.string().trim().min(1).optional(),
    phone: z.string().trim().min(1).optional(),
  })
  .strict()
  // `upsertContactIdentity` (lib/db/contacts.ts) requires at least one of
  // email/phone — refused here too, so the 400 names the actual problem
  // rather than surfacing as a generic DAL error one layer down.
  .refine((data) => Boolean(data.email) || Boolean(data.phone), {
    message: "Add an email or phone number for this person.",
  })

const CreateOpportunitySchema = z
  .object({
    pipelineId: z.string().trim().min(1, "pipelineId is required."),
    contactId: z.string().trim().min(1).optional(),
    person: PersonSchema.optional(),
    valueCents: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((data) => Boolean(data.contactId) || Boolean(data.person), {
    message: "Provide either an existing contactId or a new person's details.",
  })

export const POST = withAudit(
  {
    action: OPPORTUNITY_CREATED_MANUALLY_AUDIT_ACTION,
    category: "admin_write",
    // Reads the ORIGINAL request — the handler below always parses
    // `request.clone()`, so the body here is still fresh no matter which
    // branch the handler took (401/403/400/404/200; `withAudit` only ever
    // calls this AFTER the handler has already returned).
    target: async (request) => {
      const body = (await request.json().catch(() => null)) as
        | { pipelineId?: unknown; person?: { name?: unknown } }
        | null
      const pipelineId = typeof body?.pipelineId === "string" ? body.pipelineId : undefined
      if (!pipelineId) return undefined
      const label = typeof body?.person?.name === "string" ? body.person.name : undefined
      return { type: "pipeline_board", id: pipelineId, ...(label ? { label } : {}) }
    },
  },
  async (request) => {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (!(await canAccessAdminPath(session.user, request))) {
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

    // A CLONE — the `target` resolver above reads the ORIGINAL after this
    // handler returns; reading it here directly would leave nothing for it.
    const body = await request.clone().json().catch(() => null)
    const parsed = CreateOpportunitySchema.safeParse(body)
    if (!parsed.success) {
      // Repo trap: a bare "Invalid request body" hides WHICH field failed.
      // Name it explicitly.
      const issue = parsed.error.issues[0]
      return NextResponse.json(
        {
          error: issue?.message ?? "Invalid request body.",
          ...(issue && issue.path.length > 0 ? { field: issue.path.join(".") } : {}),
        },
        { status: 400 },
      )
    }

    try {
      const result = await createOpportunityManually({
        businessId,
        pipelineId: parsed.data.pipelineId,
        contactId: parsed.data.contactId,
        person: parsed.data.person,
        valueCents: parsed.data.valueCents,
        actorUserId: session.user.id,
      })
      return NextResponse.json({ ok: true, opportunityId: result.opportunityId, contactId: result.contactId })
    } catch (err) {
      // `PipelineBoardNotFoundError` covers BOTH a nonexistent id and a
      // foreign tenant's board — same status, same message, on purpose, same
      // convention as every sibling route in this directory.
      if (err instanceof PipelineBoardNotFoundError) {
        return NextResponse.json({ error: err.message }, { status: 404 })
      }
      // Every other DAL refusal ("Add an email or phone number...", "X is
      // already on Y, in Z") is a readable Error and surfaces as 400, not
      // 500.
      const message = err instanceof Error ? err.message : "Failed to create opportunity"
      return NextResponse.json({ error: message }, { status: 400 })
    }
  },
)
