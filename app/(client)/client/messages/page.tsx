import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { MessagingProvider } from "@/components/messaging/MessagingProvider"
import { InboxPage } from "@/components/messaging/InboxPage"

export const metadata = { title: "Messages" }

export default async function ClientMessagesPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Messages</h1>
        <p className="text-sm text-muted-foreground">Questions, check-ins, or a video of a lift — send it here.</p>
      </div>
      <MessagingProvider viewerId={session.user.id} viewerRole="client">
        <InboxPage />
      </MessagingProvider>
    </div>
  )
}
