"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface RosterClient {
  clientUserId: string
  name: string
  remaining: number
}

type Status = "loading" | "ready" | "invalid" | "done" | "error"

export function CheckinClient({ token }: { token: string }) {
  const [status, setStatus] = useState<Status>("loading")
  const [clients, setClients] = useState<RosterClient[]>([])
  const [query, setQuery] = useState("")
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [result, setResult] = useState<{ name: string; remaining: number } | null>(null)
  const [errorMsg, setErrorMsg] = useState("")

  useEffect(() => {
    if (!token) {
      setStatus("invalid")
      return
    }
    fetch(`/api/checkin/roster?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (r.status === 401) {
          setStatus("invalid")
          return
        }
        if (!r.ok) {
          setStatus("error")
          return
        }
        const data = await r.json()
        setClients(data.clients ?? [])
        setStatus("ready")
      })
      .catch(() => setStatus("error"))
  }, [token])

  const filtered = useMemo(
    () => clients.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())),
    [clients, query],
  )

  async function check(c: RosterClient) {
    setSubmitting(c.clientUserId)
    setErrorMsg("")
    try {
      const res = await fetch("/api/checkin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientUserId: c.clientUserId, token }),
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
      setResult({ name: c.name, remaining: data.remaining ?? Math.max(0, c.remaining - 1) })
      setStatus("done")
    } catch {
      setErrorMsg("Something went wrong.")
    } finally {
      setSubmitting(null)
    }
  }

  const card = "bg-white rounded-2xl border border-border p-8 shadow-sm"

  if (status === "loading") {
    return <div className={card}><p className="text-center text-muted-foreground">Loading…</p></div>
  }

  if (status === "invalid") {
    return (
      <div className={card}>
        <h1 className="text-xl font-semibold text-primary mb-2">Check-in link expired</h1>
        <p className="text-sm text-muted-foreground">
          This check-in code isn&apos;t valid anymore. Ask your coach for today&apos;s QR code.
        </p>
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
        <h1 className="text-2xl font-semibold text-primary mb-1">You&apos;re in, {result.name.split(" ")[0]}!</h1>
        <p className="text-sm text-muted-foreground">
          {result.remaining} session{result.remaining === 1 ? "" : "s"} left on your pack.
        </p>
      </div>
    )
  }

  return (
    <div className={card}>
      <h1 className="text-xl font-semibold text-primary mb-1">Check in</h1>
      <p className="text-sm text-muted-foreground mb-5">Tap your name to log today&apos;s session.</p>

      <div className="relative mb-4">
        <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your name…" className="pl-9" />
      </div>

      {errorMsg && <p className="text-sm text-destructive mb-3">{errorMsg}</p>}

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matching clients. Ask your coach to check you in.</p>
      ) : (
        <ul className="divide-y divide-border">
          {filtered.map((c) => (
            <li key={c.clientUserId} className="py-2">
              <Button
                variant="ghost"
                className="w-full justify-between h-12"
                onClick={() => check(c)}
                disabled={submitting === c.clientUserId}
              >
                <span className="font-medium">{c.name}</span>
                <span className="text-xs text-muted-foreground">{c.remaining} left</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
