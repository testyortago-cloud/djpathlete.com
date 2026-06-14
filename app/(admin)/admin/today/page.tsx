import QRCode from "qrcode"
import { requireAdmin } from "@/lib/auth-helpers"
import { listActivePackClients } from "@/lib/db/client-packages"
import { remainingCredits } from "@/lib/services/session-credits"
import { signCheckinToken } from "@/lib/qr/checkin-token"
import { TodayCheckinList } from "@/components/admin/packs/TodayCheckinList"

export const metadata = { title: "Check-ins" }

function baseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    "https://www.darrenjpaul.com"
  )
}

export default async function TodayPage() {
  const session = await requireAdmin()

  const rows = await listActivePackClients()
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
  const clients = [...byClient.values()].sort((a, b) => a.name.localeCompare(b.name))

  const token = signCheckinToken(session.user.id, new Date())
  const checkinUrl = `${baseUrl()}/checkin?token=${encodeURIComponent(token)}`
  const qrDataUrl = await QRCode.toDataURL(checkinUrl, { width: 320, margin: 1 })

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-1">Check-ins</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Tap a client to check them in, or show the QR for clients to scan themselves.
      </p>
      <TodayCheckinList clients={clients} qrDataUrl={qrDataUrl} checkinUrl={checkinUrl} />
    </div>
  )
}
