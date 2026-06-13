import QRCode from "qrcode"
import { requireAdmin } from "@/lib/auth-helpers"
import { listActivePackClients } from "@/lib/db/client-packages"
import { remainingCredits } from "@/lib/services/session-credits"
import { signCheckinToken } from "@/lib/qr/checkin-token"
import { packsEnabled, qrCheckinEnabled } from "@/lib/packs/flags"
import { TodayCheckinList } from "@/components/admin/packs/TodayCheckinList"

export const metadata = { title: "Today — Check-ins" }

function baseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    "https://www.darrenjpaul.com"
  )
}

export default async function TodayPage() {
  const session = await requireAdmin()
  const [packsOn, qrOn] = await Promise.all([packsEnabled(), qrCheckinEnabled()])

  if (!packsOn) {
    return (
      <div className="bg-white rounded-xl border border-border p-6">
        <h1 className="text-lg font-semibold text-primary mb-2">Session Packs</h1>
        <p className="text-sm text-muted-foreground">
          Session packs aren&apos;t enabled yet. Turn on{" "}
          <span className="font-mono">feature_session_packs_enabled</span> in Automation settings.
        </p>
      </div>
    )
  }

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

  let qrDataUrl: string | null = null
  let checkinUrl: string | null = null
  if (qrOn) {
    const token = signCheckinToken(session.user.id, new Date())
    checkinUrl = `${baseUrl()}/checkin?token=${encodeURIComponent(token)}`
    qrDataUrl = await QRCode.toDataURL(checkinUrl, { width: 320, margin: 1 })
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary mb-1">Today</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Tap a client to check them in, or show the QR for clients to scan themselves.
      </p>
      <TodayCheckinList clients={clients} qrDataUrl={qrDataUrl} checkinUrl={checkinUrl} />
    </div>
  )
}
