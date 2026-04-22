"use client"

import { useEffect, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"

const ERROR_COPY: Record<string, string> = {
  access_denied: "You cancelled the connection before finishing.",
  state_mismatch: "Security check failed — please try connecting again.",
  env_missing: "Server is missing YouTube credentials. Check Vercel env vars.",
  token_exchange: "Google rejected the authorization code. Please try again.",
  missing_refresh_token: "Google didn't return a refresh token. Try again and make sure you grant all permissions.",
  db_write: "Connected with Google, but saving the tokens failed. Try again.",
}

export function ConnectionToaster() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return

    const connected = searchParams.get("connected")
    const error = searchParams.get("error")
    const reason = searchParams.get("reason")

    if (!connected && !error) return

    fired.current = true

    if (connected) {
      toast.success(`${labelFor(connected)} connected successfully.`)
    } else if (error) {
      toast.error(
        `Couldn't connect ${labelFor(error)}. ${reason ? (ERROR_COPY[reason] ?? `(${reason})`) : ""}`.trim(),
      )
    }

    const params = new URLSearchParams(searchParams.toString())
    params.delete("connected")
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
