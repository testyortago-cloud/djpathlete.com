import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { updateFeeCharge } from "@/lib/db/session-fee-charges"
import { retryFeeCharge } from "@/lib/services/session-fees"

const schema = z.object({ action: z.enum(["retry", "waive"]) })

/** PATCH — retry a failed fee charge or waive it. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }
  const { id } = await ctx.params
  const parsed = schema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: "Invalid action" }, { status: 400 })

  if (parsed.data.action === "waive") {
    await updateFeeCharge(id, { status: "waived", failure_reason: "waived by coach" })
    return NextResponse.json({ ok: true })
  }
  const result = await retryFeeCharge(id)
  return NextResponse.json({ ok: result.charged, reason: result.reason })
}
