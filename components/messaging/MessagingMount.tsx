import { auth } from "@/lib/auth"
import { MessagingProvider } from "./MessagingProvider"
import { MessagingDock } from "./MessagingDock"

/**
 * Server component that resolves who the viewer is, then mounts the dock.
 *
 * Rendered from the two authenticated shells, so the dock exists on every
 * signed-in page and is absent from marketing and auth routes by construction
 * rather than by a pathname check that has to be maintained.
 */
export async function MessagingMount() {
  const session = await auth()
  if (!session?.user?.id) return null

  const viewerRole = session.user.role === "admin" ? "admin" : "client"

  return (
    <MessagingProvider viewerId={session.user.id} viewerRole={viewerRole}>
      <MessagingDock />
    </MessagingProvider>
  )
}
