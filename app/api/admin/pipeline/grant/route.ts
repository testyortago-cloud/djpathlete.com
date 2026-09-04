// app/api/admin/pipeline/grant/route.ts — a coach handing the athlete behind a
// won card their account. Body: { opportunityId, programId }.
//
// Sits beside ../move/route.ts rather than under an /opportunities/[id] tree
// so the two things a human does to a card live together.
//
// NO LONGER ADMIN-ONLY as of 2026-09-04: `/api/admin/pipeline` is mapped to the
// `contacts` permission so a coach can grant on their OWN board. What replaced
// the blanket role check is a permission gate PLUS a tenant, and the tenant is
// the load-bearing half -- `opportunityId` arrives in the request body, so an
// unscoped read here would let a coach grant against another coach's won card.
// This still creates a real account and sends a real person a real email; it is
// the highest-consequence write behind that permission.
//
// PROMPTED, NEVER AUTOMATIC — the board asks which program before calling this.
// Won alone does not say what was bought: a card can be a cash deal, a camp, or
// a plan nobody has priced. Granting from the card's value would mean one
// mis-dragged card mails a stranger.
//
// Every rule lives in grant-manual.ts and grant.ts. This route is auth, parse,
// call, and a distinct HTTP answer per refusal so the screen can say something
// true rather than "could not grant".

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import { NoAccessibleBusinessError, resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { grantWonOpportunity } from "@/lib/funnels/checkout/grant-manual"

type GrantBody = { opportunityId?: unknown; programId?: unknown }

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0
}

export const POST = withAudit(
  {
    action: "pipeline.opportunity_granted",
    category: "commerce",
    // Reads the ORIGINAL request; the handler parses a clone, so this is the
    // first real read on every path including 401/403.
    target: async (request) => {
      const body = (await request.json().catch(() => null)) as GrantBody | null
      return isNonEmptyString(body?.opportunityId)
        ? { type: "opportunity", id: body.opportunityId }
        : undefined
    },
  },
  async (request) => {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    // Was `role !== "admin"`. A coach holding `contacts` reaches this now.
    if (!(await canAccessAdminPath(session.user, request))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // This is the highest-consequence write behind the `contacts` permission:
    // it assigns a program, can create an account and sends email. The
    // opportunityId comes from the request body, so the read below is fenced to
    // the caller's own tenant -- otherwise a coach grants against another
    // coach's won opportunity.
    let businessId: string
    try {
      ;({ businessId } = await resolveAdminTenantForRequest(request))
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
      throw err
    }

    const body = (await request.clone().json().catch(() => null)) as GrantBody | null
    if (!isNonEmptyString(body?.opportunityId) || !isNonEmptyString(body?.programId)) {
      return NextResponse.json({ error: "opportunityId and programId are required" }, { status: 400 })
    }

    // Lazily imported for the same measured reason as the Stripe webhook's
    // call site: buildManualGrantDeps reaches assign-program, the ~2800-line
    // email module, the password-reset DAL and Supabase. No other request to
    // this file's neighbours should pay for that graph.
    const [{ readOpportunityForGrant, readContactIdentity }, { buildManualGrantDeps }, { grantFunnelPurchase }] =
      await Promise.all([
        import("@/lib/db/pipeline"),
        import("@/lib/funnels/checkout/deps"),
        import("@/lib/funnels/checkout/grant"),
      ])

    const result = await grantWonOpportunity(
      { opportunityId: body.opportunityId, programId: body.programId },
      {
        getOpportunity: (opportunityId: string) => readOpportunityForGrant(opportunityId, businessId),
        getContactIdentity: readContactIdentity,
        runGrant: (purchase) =>
          grantFunnelPurchase(purchase, buildManualGrantDeps({ opportunityId: body.opportunityId as string })),
      },
    )

    switch (result.outcome) {
      case "granted":
        return NextResponse.json({
          ok: true,
          userId: result.userId,
          accountCreated: result.accountCreated,
          // The account exists and is granted; only the invite did not send.
          // The screen must say so rather than reporting a clean success.
          emailFailed: result.emailFailed,
        })
      case "already_granted":
        return NextResponse.json({ ok: true, alreadyGranted: true })
      case "provisioned_by_checkout":
        return NextResponse.json(
          { error: "This deal came through checkout — the athlete already has their account." },
          { status: 409 },
        )
      case "not_won":
        return NextResponse.json({ error: "Only a won deal can be granted." }, { status: 409 })
      case "unknown_opportunity":
        return NextResponse.json({ error: "That card no longer exists." }, { status: 404 })
      case "no_contact_email":
        return NextResponse.json(
          { error: "No email address on this card, so there is nobody to send the invite to." },
          { status: 409 },
        )
      case "failed":
        // The money is not at stake here the way it is in the webhook — nothing
        // was charged — so this is an honest 500 rather than a swallowed alert.
        return NextResponse.json({ error: result.error, stage: result.stage }, { status: 500 })
    }
  },
)
