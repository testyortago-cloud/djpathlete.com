"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Eye, EyeOff, Clock } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormErrorBanner } from "@/components/shared/FormErrorBanner"
import { homeForRole, isTeamRole } from "@/lib/permissions/registry"

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get("callbackUrl")
  const sessionExpired = searchParams.get("expired") === "1"
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    const email = formData.get("email") as string
    const password = formData.get("password") as string

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    })

    setIsLoading(false)

    if (result?.error) {
      setError(
        "We couldn't sign you in with those details. Double-check your email and password, or use “Forgot password” to reset it.",
      )
      return
    }

    // Invalidate Next.js router cache before fetching fresh session
    router.refresh()

    // Fetch fresh session to get user role for redirect
    // cache: "no-store" prevents browser from returning stale session after re-login
    const sessionRes = await fetch("/api/auth/session", { cache: "no-store" })
    const sessionData = await sessionRes.json()
    const role = sessionData?.user?.role

    // Resolve the role-default home for this user. Staff land on the first
    // area they actually hold — sending them to /client/dashboard would drop
    // them on a page that isn't theirs.
    const roleHome = homeForRole(role, sessionData?.user?.permissions)

    // If there's a safe relative callback URL, honour it (with role guards)
    if (callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")) {
      const isAdminRoute = callbackUrl.startsWith("/admin")
      const isEditorRoute = callbackUrl.startsWith("/editor")
      if (isAdminRoute && role !== "admin") {
        // Non-admin tried to reach an admin route — send to their own home
        router.push(roleHome)
      } else if (isEditorRoute && !isTeamRole(role) && role !== "admin") {
        // Someone off the team tried to reach an editor route — send them home.
        // Staff count as on the team: an editor given an admin permission
        // becomes staff and still uses the editor portal.
        router.push(roleHome)
      } else {
        router.push(callbackUrl)
      }
    } else {
      router.push(roleHome)
    }
  }

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-primary tracking-tight">Welcome back</h1>
        <p className="mt-2 text-sm text-muted-foreground">Log in to your DJP Athlete account</p>
      </div>

      {sessionExpired && !error && (
        <div
          role="status"
          className="mb-4 flex items-start gap-2 rounded-xl border border-accent/40 bg-accent/10 p-4 text-sm text-foreground"
        >
          <Clock className="size-4 mt-0.5 shrink-0 text-accent" />
          <p>Your session ended, so we signed you out to keep your account safe. Log in again to pick up where you left off.</p>
        </div>
      )}

      <div className="mb-4">
        <FormErrorBanner message={error} />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium text-primary">
            Email
          </Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="you@example.com"
            required
            disabled={isLoading}
            className="h-11 rounded-lg border-border focus:border-primary focus:ring-primary"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-sm font-medium text-primary">
              Password
            </Label>
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-muted-foreground hover:text-primary transition-colors"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              required
              disabled={isLoading}
              className="h-11 rounded-lg border-border focus:border-primary focus:ring-primary pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-lg active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
        >
          {isLoading ? "Logging in..." : "Log In"}
        </button>
      </form>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Sign up
        </Link>
      </p>
    </>
  )
}
