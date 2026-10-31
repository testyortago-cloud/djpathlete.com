"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle2, Loader2, Unplug } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { OutputConnection } from "@/lib/db/output-sports"

/** Settings > Output Sports: connect, reconnect or disconnect the coach's Output account. */
export function OutputConnectionCard({
  connection,
  linkedCount,
}: {
  connection: OutputConnection | null
  linkedCount: number
}) {
  const router = useRouter()
  const [email, setEmail] = useState(connection?.account_email ?? "")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(!connection || !!connection.last_error)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  async function connect(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/output-sports/connection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Could not connect Output Sports.")
        return
      }
      setPassword("")
      setShowForm(false)
      toast.success("Output Sports connected")
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/output-sports/connection", { method: "DELETE" })
      if (!res.ok) {
        toast.error("Could not disconnect Output Sports")
        return
      }
      toast.success("Output Sports disconnected")
      setConfirmDisconnect(false)
      setShowForm(true)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
        {connection ? (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              {connection.last_error ? (
                <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-warning">
                  <AlertTriangle className="size-4" />
                  Needs reconnecting
                </p>
              ) : (
                <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-success">
                  <CheckCircle2 className="size-4" />
                  Connected
                </p>
              )}
              <p className="text-sm text-foreground">
                Output account: <strong>{connection.account_email}</strong>
              </p>
              <p className="text-xs text-muted-foreground">
                Connected {new Date(connection.connected_at).toLocaleDateString()} · {linkedCount}{" "}
                {linkedCount === 1 ? "client" : "clients"} linked
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!showForm && (
                <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
                  Reconnect
                </Button>
              )}
              {confirmDisconnect ? (
                <>
                  <Button variant="destructive" size="sm" onClick={disconnect} disabled={busy}>
                    {busy && <Loader2 className="size-4 animate-spin" />}
                    Yes, disconnect
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDisconnect(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setConfirmDisconnect(true)}>
                  <Unplug className="size-4" />
                  Disconnect
                </Button>
              )}
            </div>
            {connection.last_error && (
              <p className="w-full rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
                Output stopped accepting this connection ({connection.last_error}). This happens when the Output
                password changes. Enter your Output login again below.
              </p>
            )}
            {confirmDisconnect && (
              <p className="w-full text-sm text-muted-foreground">
                Results already brought in stay on each client. Linked clients stay linked, so reconnecting the same
                account picks up where it left off.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Not connected yet.</p>
        )}

        {showForm && (
          <form onSubmit={connect} className="mt-5 max-w-md space-y-4 border-t border-border pt-5">
            <div className="space-y-1.5">
              <Label htmlFor="output-email">Output email</Label>
              <Input
                id="output-email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="output-password">Output password</Label>
              <Input
                id="output-password"
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Use the login of the account that owns your Output team. Output does not let coach or athlete logins share
              data. Your password is used once to connect and is never saved.
            </p>
            {error && <p className="text-sm text-error">{error}</p>}
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {connection ? "Reconnect Output Sports" : "Connect Output Sports"}
            </Button>
          </form>
        )}
      </div>

      <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-primary">How it works</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-foreground">
          <li>Add the athlete in the Output app, under this account, before they test.</li>
          <li>
            Open the client in this app, go to <strong>Performance</strong>, then the <strong>Tests</strong> tab, and
            link them to their Output athlete. Their results come in straight away.
          </li>
          <li>
            After each testing session, press <strong>Sync from Output</strong> on the same tab to bring in the new
            results.
          </li>
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          Each test comes in as one result per day: the best attempt, with every attempt kept. Mobility, hops, throws
          and other lifts stay in Output.
        </p>
      </div>
    </div>
  )
}
