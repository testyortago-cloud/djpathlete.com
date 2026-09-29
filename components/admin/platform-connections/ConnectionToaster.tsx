"use client"

import { useEffect, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"

const ERROR_COPY: Record<string, string> = {
  access_denied: "You cancelled the connection before finishing.",
  state_mismatch: "Security check failed — please try connecting again.",
  env_missing: "Server is missing platform credentials. Check Vercel env vars.",
  token_exchange: "The platform rejected the authorization code. Please try again.",
  missing_refresh_token:
    "No refresh token was returned. Try again and make sure you grant all permissions.",
  pages_lookup: "Couldn't read your Facebook Pages. Make sure you granted the Pages permissions.",
  no_pages:
    "No Facebook Pages found on this account. Create a Page (or confirm admin access) and try again.",
  db_write: "Connected successfully, but saving the tokens failed. Try again.",
}

// Wording that differs by platform. pages_lookup / no_pages above are
// Facebook's; LinkedIn reaches the same two codes through its Company Pages.
const PLATFORM_ERROR_COPY: Record<string, Record<string, string>> = {
  linkedin: {
    pages_lookup:
      "Couldn't read your LinkedIn Company Pages. Check the app has the Community Management API approved.",
    no_pages:
      "This LinkedIn account can't post as any Company Page. It needs to be a Super admin or Content admin of the Page.",
    unauthorized_scope_error:
      "LinkedIn hasn't approved this app for Company Page posting yet. Request the Community Management API on the app's Products tab.",
    user_cancelled_authorize: "You cancelled the connection before finishing.",
    user_cancelled_login: "You cancelled the connection before finishing.",
  },
}

export function errorCopyFor(platform: string, reason: string): string {
  return PLATFORM_ERROR_COPY[platform]?.[reason] ?? ERROR_COPY[reason] ?? `(${reason})`
}

export function ConnectionToaster() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return

    const connected = searchParams.get("connected")
    const disconnected = searchParams.get("disconnected")
    const error = searchParams.get("error")
    const reason = searchParams.get("reason")

    if (!connected && !disconnected && !error) return

    fired.current = true

    if (connected) {
      toast.success(`${labelFor(connected)} connected successfully.`)
    } else if (disconnected) {
      toast.success(`${labelFor(disconnected)} disconnected.`)
    } else if (error) {
      toast.error(
        `Couldn't connect ${labelFor(error)}. ${reason ? errorCopyFor(error, reason) : ""}`.trim(),
      )
    }

    const params = new URLSearchParams(searchParams.toString())
    params.delete("connected")
    params.delete("disconnected")
    params.delete("error")
    params.delete("reason")
    const query = params.toString()
    router.replace(`/admin/platform-connections${query ? `?${query}` : ""}`, { scroll: false })
  }, [searchParams, router])

  return null
}

function labelFor(platform: string): string {
  switch (platform) {
    case "youtube":
      return "YouTube"
    case "youtube_shorts":
      return "YouTube Shorts"
    case "facebook":
      return "Facebook"
    case "instagram":
      return "Instagram"
    case "tiktok":
      return "TikTok"
    case "linkedin":
      return "LinkedIn"
    default:
      return platform
  }
}
