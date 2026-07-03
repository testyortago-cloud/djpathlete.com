import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getSetting, setSetting } from "@/lib/db/system-settings"
import { NO_SHOW_FEE_CENTS_KEY, LATE_CANCEL_FEE_CENTS_KEY, CANCEL_WINDOW_HOURS_KEY } from "@/lib/packs/flags"
import { listFeeCharges } from "@/lib/db/session-fee-charges"

const configSchema = z.object({
  noShowFeeCents: z.number().int().nonnegative(),
  lateCancelFeeCents: z.number().int().nonnegative(),
  cancelWindowHours: z.number().int().nonnegative().max(168),
})

async function requireAdmin() {
  const session = await auth()
  return session?.user?.id && session.user.role === "admin" ? session : null
}

/** GET — current fee config + recent charges. */
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const [noShow, late, windowH, charges] = await Promise.all([
    getSetting<number>(NO_SHOW_FEE_CENTS_KEY, 0),
    getSetting<number>(LATE_CANCEL_FEE_CENTS_KEY, 0),
    getSetting<number>(CANCEL_WINDOW_HOURS_KEY, 12),
    listFeeCharges(100),
  ])
  return NextResponse.json({
    config: { noShowFeeCents: noShow, lateCancelFeeCents: late, cancelWindowHours: windowH },
    charges,
  })
}

/** POST — update fee config. */
export async function POST(request: Request) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const parsed = configSchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: "Invalid config" }, { status: 400 })
  const p = parsed.data
  await Promise.all([
    setSetting(NO_SHOW_FEE_CENTS_KEY, p.noShowFeeCents, session.user.id),
    setSetting(LATE_CANCEL_FEE_CENTS_KEY, p.lateCancelFeeCents, session.user.id),
    setSetting(CANCEL_WINDOW_HOURS_KEY, p.cancelWindowHours, session.user.id),
  ])
  return NextResponse.json({ ok: true })
}
