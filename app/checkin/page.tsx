import { CheckinClient } from "@/components/checkin/CheckinClient"
import { auth } from "@/lib/auth"
import { clientSelfCheckinEnabled } from "@/lib/packs/flags"
import { loadMyPacksView } from "@/lib/services/client-packs-view"

export const metadata = { title: "Check in", robots: { index: false, follow: false } }

export default async function CheckinPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams

  // When a logged-in client opens the on-site QR, check them in by identity
  // instead of the name-roster. Falls back to the roster for walk-ins.
  let me: { firstName: string; remaining: number } | null = null
  if (await clientSelfCheckinEnabled()) {
    const session = await auth()
    if (session?.user?.role === "client") {
      const view = await loadMyPacksView()
      if (view) {
        me = {
          firstName: (session.user.name ?? "You").split(" ")[0],
          remaining: view.summary.activeRemaining,
        }
      }
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-surface px-4 py-12">
      <div className="w-full max-w-md">
        <CheckinClient token={token ?? ""} me={me} />
      </div>
    </main>
  )
}
