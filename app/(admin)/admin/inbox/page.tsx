import Link from "next/link"
import { Mail } from "lucide-react"
import { getPlatformConnection } from "@/lib/db/platform-connections"
import { InboxClient } from "@/components/admin/inbox/InboxClient"

export const metadata = { title: "Inbox" }
export const dynamic = "force-dynamic"

export default async function AdminInboxPage() {
  const conn = await getPlatformConnection("gmail")
  const isConnected = conn?.status === "connected"

  if (!isConnected) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold text-primary mb-2">Inbox</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Read and reply to leads using your own Gmail account, without leaving the admin.
        </p>

        <div className="rounded-xl border border-border bg-white p-8 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 mb-4">
            <Mail className="size-5 text-primary" />
          </div>
          <h2 className="text-lg font-semibold text-primary mb-1">Connect your Gmail</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Sign in with the Gmail account you want to read and reply from. We&apos;ll only access threads in
            that mailbox — we never store the password.
          </p>
          <Link
            href="/api/integrations/gmail/connect"
            prefetch={false}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Connect Gmail
          </Link>
          {conn?.last_error ? (
            <p className="mt-4 text-xs text-error">{conn.last_error}</p>
          ) : null}
        </div>
      </div>
    )
  }

  return <InboxClient connectedEmail={conn?.account_handle ?? ""} />
}
