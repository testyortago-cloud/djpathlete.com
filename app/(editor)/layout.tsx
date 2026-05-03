import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { EditorShell } from "@/components/editor/EditorShell"

export default async function EditorLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect("/login?callbackUrl=/editor")
  if (session.user.role !== "editor" && session.user.role !== "admin") {
    redirect("/client/dashboard")
  }
  return (
    <EditorShell user={{ name: session.user.name ?? "Editor", email: session.user.email ?? "" }}>
      {children}
    </EditorShell>
  )
}
