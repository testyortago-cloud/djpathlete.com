"use client"

import { useEffect, useRef, useState } from "react"
import { CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"

type Status = "loading" | "ready" | "invalid" | "error" | "done"

/**
 * Personal check-in screen — opened from a client's own permanent link
 * (/checkin/me?token=…). Greets them by name and checks them in with one tap.
 * No roster, no login, no daily QR.
 */
export function PersonalCheckinClient({ token }: { token: string }) {
  const [status, setStatus] = useState<Status>("loading")
  const [me, setMe] = useState<{ firstName: string; remaining: number } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")
  const [result, setResult] = useState<{ firstName: string; remaining: number } | null>(null)
  // Set once the check-in lands, so a refresh can never overwrite the "You're
  // in!" confirmation with the pre-tap screen.
  const checkedIn = useRef(false)

  useEffect(() => {
    if (!token) {
      setStatus("invalid")
      return
    }

    let cancelled = false
    const load = () => {
      if (checkedIn.current) return
      return fetch(`/api/checkin/personal?token=${encodeURIComponent(token)}`, { cache: "no-store" })
        .then(async (r) => {
          if (cancelled || checkedIn.current) return
          if (r.status === 401) {
            setStatus("invalid")
            return
          }
          if (!r.ok) {
            setStatus("error")
            return
          }
          const data = await r.json()
          if (cancelled || checkedIn.current) return
          setMe({ firstName: data.firstName ?? "there", remaining: data.remaining ?? 0 })
          setStatus("ready")
        })
        .catch(() => {
          if (!cancelled) setStatus("error")
        })
    }

    void load()

    // This link is a permanent bookmark, so the page is routinely opened from a
    // tab that has been parked on a phone for days — and the coach may have
    // tapped the client in from the admin side in the meantime. Re-read on every
    // return to the page, so the number on screen is the number the check-in
    // will actually deduct from.
    const onVisible = () => {
      if (document.visibilityState === "visible") void load()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [token])

  async function check() {
    if (!me) return
    setSubmitting(true)
    setErrorMsg("")
    try {
      const res = await fetch("/api/checkin/personal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      })
      const data = await res.json()
      if (res.status === 401) {
        setStatus("invalid")
        return
      }
      if (res.status === 409) {
        setErrorMsg(data.error ?? "No credits left on your pack.")
        return
      }
      if (!res.ok) {
        setErrorMsg(data.error ?? "Something went wrong.")
        return
      }
      checkedIn.current = true
      setResult({
        firstName: me.firstName,
        remaining: data.clientRemaining ?? data.remaining ?? Math.max(0, me.remaining - 1),
      })
      setStatus("done")
    } catch {
      setErrorMsg("Something went wrong.")
    } finally {
      setSubmitting(false)
    }
  }

  const card = "bg-white rounded-2xl border border-border p-8 shadow-sm"

  if (status === "loading") {
    return (
      <div className={card}>
        <p className="text-center text-muted-foreground">Loading…</p>
      </div>
    )
  }

  if (status === "invalid") {
    return (
      <div className={card}>
        <h1 className="text-xl font-semibold text-primary mb-2">Check-in link not valid</h1>
        <p className="text-sm text-muted-foreground">Ask your coach for your personal check-in link.</p>
      </div>
    )
  }

  if (status === "error") {
    return (
      <div className={card}>
        <h1 className="text-xl font-semibold text-primary mb-2">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">Please try again, or ask your coach to check you in.</p>
      </div>
    )
  }

  if (status === "done" && result) {
    return (
      <div className={`${card} text-center`}>
        <CheckCircle2 className="size-14 text-success mx-auto mb-4" strokeWidth={1.5} />
        <h1 className="text-2xl font-semibold text-primary mb-1">You&apos;re in, {result.firstName}!</h1>
        <p className="text-sm text-muted-foreground">
          {result.remaining} session{result.remaining === 1 ? "" : "s"} left on your pack.
        </p>
      </div>
    )
  }

  return (
    <div className={card}>
      <h1 className="text-xl font-semibold text-primary mb-1">Check in</h1>
      <p className="text-sm text-muted-foreground mb-5">
        {me?.remaining ?? 0} session{(me?.remaining ?? 0) === 1 ? "" : "s"} left on your pack.
      </p>
      {errorMsg && <p className="text-sm text-destructive mb-3">{errorMsg}</p>}
      <Button className="w-full h-12" onClick={check} disabled={submitting}>
        Check in, {me?.firstName}
      </Button>
    </div>
  )
}
