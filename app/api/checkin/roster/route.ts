import { NextResponse } from "next/server"
import { verifyCheckinToken } from "@/lib/qr/checkin-token"
import { listActivePackClients } from "@/lib/db/client-packages"
import { qrCheckinEnabled } from "@/lib/packs/flags"
import { remainingCredits } from "@/lib/services/session-credits"

/** Token-gated roster for the self-check-in page: active-pack clients to tap. */
export async function GET(request: Request) {
  try {
    if (!(await qrCheckinEnabled())) {
      return NextResponse.json({ error: "Self check-in is not enabled" }, { status: 403 })
    }

    const token = new URL(request.url).searchParams.get("token") ?? ""
    if (!verifyCheckinToken(token, new Date()).valid) {
      return NextResponse.json({ error: "Invalid or expired check-in code" }, { status: 401 })
    }

    const rows = await listActivePackClients()
    // Collapse to one entry per client with summed remaining credits across packs.
    const byClient = new Map<string, { clientUserId: string; name: string; remaining: number }>()
    for (const r of rows) {
      if (!r.users) continue
      const key = r.users.id
      const rem = remainingCredits(r)
      const existing = byClient.get(key)
      if (existing) existing.remaining += rem
      else
        byClient.set(key, {
          clientUserId: key,
          name: `${r.users.first_name} ${r.users.last_name}`.trim(),
          remaining: rem,
        })
    }

    return NextResponse.json({ clients: [...byClient.values()].sort((a, b) => a.name.localeCompare(b.name)) })
  } catch (error) {
    console.error("Roster error:", error)
    return NextResponse.json({ error: "Failed to load roster" }, { status: 500 })
  }
}
