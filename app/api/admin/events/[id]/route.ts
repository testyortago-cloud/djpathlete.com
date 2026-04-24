import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { updateEventSchema } from "@/lib/validators/events"
import { updateEvent, deleteEvent, getEventById, ALLOWED_STATUS_TRANSITIONS } from "@/lib/db/events"
import { syncEventToStripe, archiveAndCreateNewPrice, stripe } from "@/lib/stripe"

async function requireAdmin() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") return null
  return session
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { id } = await ctx.params
    const body = await request.json()
    const result = updateEventSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid event data", fieldErrors: result.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { status, price_dollars, ...rest } = result.data as {
      status?: string
      price_dollars?: number | null
      [k: string]: unknown
    }

    try {
      const merged: Record<string, unknown> = { ...rest }

      // Load the current event up-front so we can detect price changes and validate transitions.
      const current = await getEventById(id)
      if (!current) {
        return NextResponse.json({ error: "Event not found" }, { status: 404 })
      }

      // Validate status transition (read-only, no DB write yet). A payload that
      // echoes the current status is a no-op — the form sends it on every save
      // even when the admin is only tweaking non-status fields, so don't treat
      // that as a transition attempt.
      if (status && status !== current.status) {
        const allowed = ALLOWED_STATUS_TRANSITIONS[current.status]
        if (!allowed.includes(status as "draft" | "published" | "cancelled" | "completed")) {
          return NextResponse.json(
            { error: `Cannot transition event from ${current.status} to ${status}` },
            { status: 409 },
          )
        }
        merged.status = status
      }

      // Carry the price_dollars-to-price_cents conversion that updateEvent normally does.
      const priceChanged =
        price_dollars !== undefined && Math.round((price_dollars ?? 0) * 100) !== (current.price_cents ?? 0)
      if (price_dollars !== undefined) {
        merged.price_cents = price_dollars == null ? null : Math.round(price_dollars * 100)
      }

      // Auto-resync on price change for already-synced paid events (clinics + camps).
      if (
        priceChanged &&
        current.stripe_product_id &&
        current.stripe_price_id &&
        merged.price_cents != null &&
        (merged.price_cents as number) > 0
      ) {
        try {
          const newPriceId = await archiveAndCreateNewPrice({
            productId: current.stripe_product_id,
            oldPriceId: current.stripe_price_id,
            priceCents: merged.price_cents as number,
            paymentType: "one_time",
            billingInterval: null,
          })
          merged.stripe_price_id = newPriceId
        } catch (err) {
          console.error("[admin events PATCH] auto-resync failed", err)
          return NextResponse.json(
            { error: "Stripe sync failed — try again or use the Resync button" },
            { status: 502 },
          )
        }
      }

      // Auto-sync on publish for paid events (clinics + camps) with no existing sync.
      const transitionToPublished = status === "published" && current.status !== "published"
      const priceOnPublish =
        (typeof merged.price_cents === "number" ? merged.price_cents : current.price_cents) ?? 0
      if (transitionToPublished && priceOnPublish > 0 && !current.stripe_price_id) {
        try {
          const eventForSync = {
            ...current,
            ...(typeof merged.price_cents === "number" ? { price_cents: merged.price_cents } : {}),
          }
          const synced = await syncEventToStripe(eventForSync)
          merged.stripe_product_id = synced.productId
          merged.stripe_price_id = synced.priceId
        } catch (err) {
          console.error("[admin events PATCH] auto-sync on publish failed", err)
          return NextResponse.json(
            { error: "Stripe sync failed — try again or use the Resync button" },
            { status: 502 },
          )
        }
      }

      // Auto-archive Stripe product when cancelling a synced paid event (clinics + camps).
      if (status === "cancelled" && current.stripe_product_id) {
        try {
          await stripe.products.update(current.stripe_product_id, { active: false })
        } catch (err) {
          console.error("[admin events PATCH] Stripe product archive failed (non-fatal)", err)
        }
      }

      if (Object.keys(merged).length === 0) {
        return NextResponse.json({ event: current })
      }

      const updated = await updateEvent(id, merged)
      return NextResponse.json({ event: updated })
    } catch (err) {
      const msg = (err as Error).message
      if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
        return NextResponse.json(
          { error: "Slug already in use", fieldErrors: { slug: ["That slug is already taken"] } },
          { status: 409 },
        )
      }
      throw err
    }
  } catch (err) {
    console.error("[API admin/events PATCH]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const { id } = await ctx.params
    const force = new URL(request.url).searchParams.get("force") === "true"

    const current = await getEventById(id)
    if (!current) return NextResponse.json({ ok: true })

    try {
      await deleteEvent(id, { force })
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes("Cannot delete")) {
        return NextResponse.json({ error: msg }, { status: 409 })
      }
      throw err
    }

    // Best-effort: archive any Stripe product tied to this event so the
    // catalog stays clean. Non-fatal — the row is already gone.
    if (current.stripe_product_id) {
      try {
        await stripe.products.update(current.stripe_product_id, { active: false })
      } catch (err) {
        console.error("[admin events DELETE] Stripe product archive failed (non-fatal)", err)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[API admin/events DELETE]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
