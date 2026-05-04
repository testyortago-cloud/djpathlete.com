// app/api/admin/ads/conversion-actions/route.ts
// Admin upsert for the conversion-action map (one per trigger per customer).
// DELETE accepts ?id=... query param.

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import {
  deleteConversionAction,
  upsertConversionAction,
} from "@/lib/db/google-ads-conversion-actions"

const UpsertSchema = z.object({
  customer_id: z.string().min(1),
  conversion_action_id: z.string().min(1),
  name: z.string().min(1).max(120),
  trigger_type: z.enum(["booking_created", "payment_succeeded"]),
  default_value_micros: z.number().int().nonnegative(),
  default_currency: z.string().length(3).optional(),
  is_active: z.boolean().optional(),
})

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const raw = await request.json().catch(() => null)
  const parsed = UpsertSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }
  try {
    const action = await upsertConversionAction(parsed.data)
    return NextResponse.json({ ok: true, action })
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message ?? "upsert failed" },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const id = request.nextUrl.searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })
  try {
    await deleteConversionAction(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message ?? "delete failed" },
      { status: 500 },
    )
  }
}
