import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { isTeamRole } from "@/lib/permissions/registry"
import { EditorShell } from "@/components/editor/EditorShell"
import { SessionExpiryGuard } from "@/components/auth/SessionExpiryGuard"

export default async function EditorLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect("/login?callbackUrl=/editor")
  // Anyone on the team, not just role `editor`. Someone who edits video and
  // was also given an admin permission becomes `staff`, and that promotion
  // must not take away the portal they were doing their actual job in.
  if (!isTeamRole(session.user.role) && session.user.role !== "admin") {
    redirect("/client/dashboard")
  }
  return (
    <>
      <SessionExpiryGuard />
      <EditorShell user={{ name: session.user.name ?? "Editor", email: session.user.email ?? "" }}>
        {children}
      </EditorShell>
    </>
  )
}
