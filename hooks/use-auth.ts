"use client"

import { useSession } from "next-auth/react"

export function useAuth() {
  const { data: session, status } = useSession()

  return {
    user: session?.user ?? null,
    role: session?.user?.role ?? null,
    isAdmin: session?.user?.role === "admin",
    isAuthenticated: !!session?.user,
    isLoading: status === "loading",
  }
}
