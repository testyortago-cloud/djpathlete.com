import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { homeForRole } from "@/lib/permissions/registry"

export async function getServerAuth() {
  const session = await auth()
  return session
}

export async function requireAuth() {
  const session = await auth()
  if (!session?.user) {
    redirect("/login")
  }
  return session
}

export async function requireAdmin() {
  const session = await auth()
  if (!session?.user) {
    redirect("/login")
  }
  if (session.user.role !== "admin") {
    redirect(homeForRole(session.user.role, session.user.permissions))
  }
  return session
}
