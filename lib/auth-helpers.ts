import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"

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
    redirect("/client/dashboard")
  }
  return session
}
