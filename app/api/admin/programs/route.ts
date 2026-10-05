import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { programFormSchema } from "@/lib/validators/program"
import { createProgram } from "@/lib/db/programs"
import { createStripeProductAndPrice } from "@/lib/stripe"
import { withAudit } from "@/lib/audit/with-audit"
import { z } from "zod"
import { resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { getProgramFolder } from "@/lib/db/program-folders"

export const POST = withAudit(
  {
    action: "program.created",
    category: "admin_write",
    metadata: async (_req, res) => {
      const id = res.headers.get("x-audit-target-id")
      return id ? { target_id: id } : {}
    },
  },
  async (request) => {
    try {
      const session = await auth()
      const body = await request.json()

      const result = programFormSchema.safeParse(body)

      if (!result.success) {
        console.error("[API programs POST] Validation failed:", result.error.flatten().fieldErrors)
        return NextResponse.json(
          { error: "Invalid form data", details: result.error.flatten().fieldErrors },
          { status: 400 },
        )
      }

      const data = result.data

      // "New program" in the Library tab sends folder_id. Read off the RAW body: the form schema strips
      // it. A folder of this business makes the row a library program; is_template is never taken
      // from the body.
      let libraryFields: { is_template: true; folder_id: string; is_public: false } | null = null
      const rawFolderId = (body as { folder_id?: unknown }).folder_id
      if (rawFolderId !== undefined) {
        const folderId = z.string().uuid().safeParse(rawFolderId)
        if (!folderId.success) return NextResponse.json({ error: "Folder not found." }, { status: 404 })
        const { businessId } = await resolveAdminTenantForRequest(request)
        const folder = await getProgramFolder(businessId, folderId.data)
        if (!folder) return NextResponse.json({ error: "Folder not found." }, { status: 404 })
        libraryFields = { is_template: true, folder_id: folder.id, is_public: false }
      }

      // Create Stripe Product + Price for paid programs
      let stripe_product_id: string | null = null
      let stripe_price_id: string | null = null

      if (data.payment_type !== "free" && data.price_cents) {
        const stripeResult = await createStripeProductAndPrice({
          name: data.name,
          description: data.description,
          priceCents: data.price_cents,
          paymentType: data.payment_type,
          billingInterval: data.billing_interval,
          programId: "", // will be set after program creation if needed
        })
        stripe_product_id = stripeResult.productId
        stripe_price_id = stripeResult.priceId
      }

      const program = await createProgram({
        ...data,
        stripe_product_id,
        stripe_price_id,
        is_active: true,
        created_by: session?.user?.id ?? null,
        is_ai_generated: false,
        ai_generation_params: null,
        ...(libraryFields ?? {}),
      })

      // Update Stripe product metadata with actual program ID
      if (stripe_product_id) {
        const { stripe } = await import("@/lib/stripe")
        await stripe.products.update(stripe_product_id, {
          metadata: { programId: program.id },
        })
      }

      const response = NextResponse.json(program, { status: 201 })
      response.headers.set("x-audit-target-id", program.id)
      return response
    } catch (err) {
      console.error("[API programs POST] Error:", err)
      return NextResponse.json({ error: "Failed to create program. Please try again." }, { status: 500 })
    }
  },
)
