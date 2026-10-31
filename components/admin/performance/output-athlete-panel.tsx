"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Activity, Link2, Loader2, RefreshCw, Unlink } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { SyncSummary } from "@/lib/output-sports/sync"

export interface OutputPanelState {
  connected: boolean
  connectionError: string | null
  link: { output_athlete_name: string; last_synced_at: string | null } | null
}

interface AthleteOption {
  id: string
  name: string
  dateOfBirth: string | null
  suggested: boolean
  linkedToOther: boolean
}

/** "3 new results, 1 updated. Kept in Output only: 4 Mobility · 2 Contacts" */
export function summaryText(s: SyncSummary): string {
  const parts: string[] = []
  if (s.added) parts.push(`${s.added} new ${s.added === 1 ? "result" : "results"}`)
  if (s.updated) parts.push(`${s.updated} updated`)
  const head = parts.length ? parts.join(", ") : "No new results"
  // Output's category names contain commas ("Slams, Swings & Throws"), so they are joined with dots.
  const left = Object.entries(s.skipped).map(([category, n]) => `${n} ${category}`)
  return left.length ? `${head}. Kept in Output only: ${left.join(" · ")}` : `${head}.`
}

/**
 * Performance > Tests: links the client to their Output Sports athlete and pulls their
 * results in. Talks to Output only when the coach asks, never on page load.
 */
export function OutputAthletePanel({
  clientUserId,
  clientName,
  state,
}: {
  clientUserId: string
  clientName: string
  state: OutputPanelState
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<"load" | "link" | "sync" | "unlink" | null>(null)
  const [athletes, setAthletes] = useState<AthleteOption[] | null>(null)
  const [choice, setChoice] = useState<string>("")
  const [message, setMessage] = useState<string | null>(null)
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const base = `/api/admin/clients/${clientUserId}/output`

  async function request(path: string, init?: RequestInit) {
    const res = await fetch(path, init)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? "Something went wrong talking to Output Sports.")
    return body
  }

  async function loadAthletes() {
    setBusy("load")
    setMessage(null)
    try {
      const { athletes: list } = (await request(base)) as { athletes: AthleteOption[] }
      setAthletes(list)
      const suggested = list.find((a) => a.suggested && !a.linkedToOther)
      setChoice(suggested?.id ?? "")
    } catch (err) {
      setMessage((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function link() {
    setBusy("link")
    try {
      const body = await request(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ athleteId: choice }),
      })
      if (body.syncError) {
        toast.warning("Linked, but the results could not be brought in yet")
        setMessage(body.syncError)
      } else {
        toast.success("Linked to Output")
        setMessage(summaryText(body.summary))
      }
      setAthletes(null)
      router.refresh()
    } catch (err) {
      setMessage((err as Error).message)
      // The link may have been saved before the request failed (a timeout during the first
      // sync); refreshing shows it, so clicking Link again does not start the year-long read over.
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  async function sync() {
    setBusy("sync")
    try {
      const body = await request(`${base}/sync`, { method: "POST" })
      setMessage(summaryText(body.summary))
      toast.success("Output results brought in")
      router.refresh()
    } catch (err) {
      setMessage((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function unlink(removeResults: boolean) {
    setBusy("unlink")
    try {
      await request(removeResults ? `${base}?remove=1` : base, { method: "DELETE" })
      setConfirmUnlink(false)
      setMessage(null)
      toast.success(removeResults ? "Unlinked, and its results removed" : "Unlinked from Output")
      router.refresh()
    } catch (err) {
      setMessage((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const spin = (key: typeof busy) => busy === key && <Loader2 className="size-4 animate-spin" />

  return (
    <div className="rounded-xl border border-border bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Activity className="size-4 shrink-0 text-primary" />
          <p className="text-sm font-semibold text-primary">Output Sports</p>
          {state.link && (
            <p className="truncate text-sm text-muted-foreground">
              Linked to <strong className="text-foreground">{state.link.output_athlete_name}</strong>
              {" · "}
              {state.link.last_synced_at
                ? `last synced ${new Date(state.link.last_synced_at).toLocaleString()}`
                : "not synced yet"}
            </p>
          )}
        </div>

        {!state.connected ? (
          <Link href="/admin/settings/output-sports" className="text-sm font-medium text-primary hover:underline">
            Connect Output Sports in Settings
          </Link>
        ) : state.link ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={sync} disabled={!!busy}>
              {spin("sync") || <RefreshCw className="size-4" />}
              Sync from Output
            </Button>
            {confirmUnlink ? (
              <>
                <Button size="sm" variant="outline" onClick={() => unlink(false)} disabled={!!busy}>
                  {spin("unlink")}
                  Unlink, keep results
                </Button>
                <Button size="sm" variant="destructive" onClick={() => unlink(true)} disabled={!!busy}>
                  Unlink and remove its results
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmUnlink(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setConfirmUnlink(true)} disabled={!!busy}>
                <Unlink className="size-4" />
                Unlink
              </Button>
            )}
          </div>
        ) : (
          !athletes && (
            <Button size="sm" onClick={loadAthletes} disabled={!!busy}>
              {spin("load") || <Link2 className="size-4" />}
              Link to Output athlete
            </Button>
          )
        )}
      </div>

      {state.connected && state.connectionError && (
        <p className="mt-2 text-sm text-warning">
          Output stopped accepting the saved connection.{" "}
          <Link href="/admin/settings/output-sports" className="font-medium underline">
            Reconnect it in Settings
          </Link>
          .
        </p>
      )}

      {athletes && !state.link && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {athletes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Your Output account has no athletes yet. Add {clientName || "this client"} in the Output app, then try
              again.
            </p>
          ) : (
            <>
              <Select value={choice} onValueChange={setChoice}>
                <SelectTrigger className="w-72" aria-label="Output athlete">
                  <SelectValue placeholder="Choose their Output athlete" />
                </SelectTrigger>
                <SelectContent>
                  {athletes.map((a) => (
                    <SelectItem key={a.id} value={a.id} disabled={a.linkedToOther}>
                      {a.name}
                      {a.dateOfBirth ? ` · born ${a.dateOfBirth}` : ""}
                      {a.suggested ? " · likely match" : ""}
                      {a.linkedToOther ? " · linked to another client" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={link} disabled={!choice || !!busy}>
                {spin("link")}
                Link and bring in results
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAthletes(null)}>
                Cancel
              </Button>
            </>
          )}
        </div>
      )}

      {confirmUnlink && (
        <p className="mt-2 text-sm text-muted-foreground">
          Remove the results only if this was the wrong athlete. Results you typed in yourself are never removed.
        </p>
      )}

      {message && <p className="mt-2 text-sm text-muted-foreground">{message}</p>}
    </div>
  )
}
