import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { MessagingProvider } from "@/components/messaging/MessagingProvider"
import { InboxPage } from "@/components/messaging/InboxPage"

export const metadata = { title: "Messages" }

export default async function AdminMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") redirect("/login")

  // The notification email links here with ?conversation=<id>.
  const { conversation } = await searchParams

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Messages</h1>
        <p className="text-sm text-muted-foreground">
          Talk to your clients. They get an email if a message sits unread for a few minutes.
        </p>
      </div>
      <MessagingProvider viewerId={session.user.id} viewerRole="admin">
        <InboxPage initialConversationId={conversation} />
      </MessagingProvider>
    </div>
  )
}
