// app/api/admin/programs/[id]/give/route.ts
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { withAudit } from "@/lib/audit/with-audit"
import { resolveAdminTenantForRequest, NoAccessibleBusinessError } from "@/lib/tenancy/resolve"
import { deleteProgram, getProgramById, updateProgram } from "@/lib/db/programs"
import { getProgramFolder } from "@/lib/db/program-folders"
import { copyProgram } from "@/lib/services/copy-program"
import { assignProgram } from "@/lib/services/assign-program"
import { createStripeProductAndPrice } from "@/lib/stripe"
import { releaseAnchorFor } from "@/lib/programs/week-visibility"
import { giveProgramSchema } from "@/lib/validators/program-library"

/**
 * Give a library program to a client: copy it, make the copy sellable if it is
 * paid, and assign the copy (optionally releasing one week at a time). Any
 * failure after the copy deletes the copy, so the coach never finds a stray
 * half-given program.
 */
export const POST = withAudit(
  {
    action: "program.given_to_client",
    category: "admin_write",
    target: async (_req, ctx) => ({ type: "program", id: ((await ctx.params) as { id: string }).id }),
    metadata: async (_req, res) => {
      const id = res.headers.get("x-audit-target-id")
      return id ? { copy_program_id: id } : {}
    },
  },
  async (request, context) => {
    try {
      const { id } = await (context as { params: Promise<{ id: string }> }).params
      const session = await auth()
      if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

      const parsed = giveProgramSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid data", details: parsed.error.flatten().fieldErrors },
          { status: 400 },
        )
      }
      const input = parsed.data

      const { businessId } = await resolveAdminTenantForRequest(request)
      const source = await getProgramById(id)
      const folder =
        source.is_template && source.folder_id ? await getProgramFolder(businessId, source.folder_id) : null
      if (!folder) {
        return NextResponse.json({ error: "Only a program in your library can be given to a client." }, { status: 400 })
      }
      if (input.release_weekly && input.weeks_visible_at_start > source.duration_weeks) {
        return NextResponse.json(
          { error: `This program has ${source.duration_weeks} weeks, so they can't see more than that at the start.` },
          { status: 400 },
        )
      }

      const copy = await copyProgram(id, { is_template: false, folder_id: null, is_public: false, name: input.name })
      try {
        if (copy.payment_type !== "free" && copy.price_cents) {
          // ponytail: on a later rollback this Stripe product is left behind, unused. It sells nothing.
          const { productId, priceId } = await createStripeProductAndPrice({
            name: copy.name,
            description: copy.description,
            priceCents: copy.price_cents,
            paymentType: copy.payment_type,
            billingInterval: copy.billing_interval,
            programId: copy.id,
          })
          await updateProgram(copy.id, { stripe_product_id: productId, stripe_price_id: priceId })
        }

        const { assignment, skipped } = await assignProgram({
          programId: copy.id,
          userId: input.user_id,
          startDate: input.start_date,
          assignedBy: session.user.id,
          complimentary: input.complimentary,
          releaseBaseWeek: input.release_weekly ? input.weeks_visible_at_start : null,
          releaseAnchorAt: input.release_weekly ? releaseAnchorFor(input.start_date, new Date()) : null,
        })
        if (skipped || !assignment) throw new Error("assignProgram skipped a brand-new program")

        const res = NextResponse.json({ program: copy, assignment }, { status: 201 })
        res.headers.set("x-audit-target-id", copy.id)
        return res
      } catch (err) {
        console.error(`[give] rolling back copy ${copy.id}:`, err)
        await deleteProgram(copy.id).catch((e) => console.error(`[give] rollback of ${copy.id} failed:`, e))
        return NextResponse.json(
          { error: "Couldn't give the program to this client. Nothing was saved." },
          { status: 500 },
        )
      }
    } catch (err) {
      if (err instanceof NoAccessibleBusinessError) return NextResponse.json({ error: err.message }, { status: 403 })
      console.error("[give]", err)
      return NextResponse.json({ error: "Couldn't give the program to this client." }, { status: 500 })
    }
  },
)
