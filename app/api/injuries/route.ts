import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { injuryFormSchema } from "@/lib/validators/injury"
import { create, listByUser } from "@/lib/db/injuries"
import { withAudit } from "@/lib/audit/with-audit"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const url = new URL(req.url)
  const clientUserId =
    session.user.role === "admin" && url.searchParams.get("client_user_id")
      ? url.searchParams.get("client_user_id")!
      : session.user.id
  const injuries = await listByUser(clientUserId)
  return NextResponse.json({ injuries })
}

export const POST = withAudit(
  { action: "injury.reported", category: "client_action" },
  async (req: Request) => {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    const body = await req.json()
    const parsed = injuryFormSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 })
    }
    const clientUserId =
      session.user.role === "admin" && body.client_user_id ? (body.client_user_id as string) : session.user.id
    const injury = await create(clientUserId, parsed.data)
    return NextResponse.json({ injury })
  },
)
