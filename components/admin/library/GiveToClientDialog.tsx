"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { Program, User } from "@/types/database"

interface GiveToClientDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  program: Program | null
  clients: User[]
}

/** YYYY-MM-DD in the coach's own time zone. */
function todayIso(): string {
  return new Date().toLocaleDateString("en-CA")
}

export function GiveToClientDialog({ open, onOpenChange, program, clients }: GiveToClientDialogProps) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [clientId, setClientId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [nameTouched, setNameTouched] = useState(false)
  const [startDate, setStartDate] = useState(todayIso())
  const [releaseWeekly, setReleaseWeekly] = useState(true)
  const [weeksAtStart, setWeeksAtStart] = useState(1)
  const [complimentary, setComplimentary] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setSearch("")
    setClientId(null)
    setName(program?.name ?? "")
    setNameTouched(false)
    setStartDate(todayIso())
    setReleaseWeekly(true)
    setWeeksAtStart(1)
    setComplimentary(false)
  }, [open, program])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return clients
    return clients.filter((c) => `${c.first_name} ${c.last_name} ${c.email}`.toLowerCase().includes(q))
  }, [clients, search])

  function pick(client: User) {
    setClientId(client.id)
    if (!nameTouched && program) setName(`${program.name} – ${client.first_name}`)
  }

  const duration = program?.duration_weeks ?? 1
  const canSubmit =
    !!program &&
    !!clientId &&
    name.trim().length > 0 &&
    (!releaseWeekly || (weeksAtStart >= 1 && weeksAtStart <= duration))

  async function submit() {
    if (!program || !clientId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/programs/${program.id}/give`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: clientId,
          name: name.trim(),
          start_date: startDate,
          release_weekly: releaseWeekly,
          weeks_visible_at_start: weeksAtStart,
          complimentary,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't give the program. Please try again.")
        return
      }
      toast.success("Program given. It is now in their account.")
      onOpenChange(false)
      router.push(`/admin/programs/${body.program.id}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Give to a client</DialogTitle>
          <DialogDescription>
            The client gets their own copy of “{program?.name}”. Changing the library program later will not change
            their copy.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="give-search">Client</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                id="give-search"
                placeholder="Search clients..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div
              className="max-h-48 overflow-y-auto rounded-lg border border-border"
              role="listbox"
              aria-label="Clients"
            >
              {filtered.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">No clients found.</p>
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={clientId === c.id}
                    onClick={() => pick(c)}
                    className={cn(
                      "flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-surface/50",
                      clientId === c.id && "bg-primary/10",
                    )}
                  >
                    <span className="font-medium text-foreground">
                      {c.first_name} {c.last_name}
                    </span>
                    <span className="text-xs text-muted-foreground">{c.email}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="give-name">Name of their program</Label>
            <Input
              id="give-name"
              value={name}
              maxLength={200}
              onChange={(e) => {
                setName(e.target.value)
                setNameTouched(true)
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="give-start">Start date</Label>
            <Input id="give-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>

          <div className="rounded-lg border border-border p-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Label htmlFor="give-release">Release one week at a time</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  A new week opens every 7 days while their payment is active. If they cancel, no new weeks open.
                </p>
              </div>
              <Switch id="give-release" checked={releaseWeekly} onCheckedChange={setReleaseWeekly} />
            </div>
            {releaseWeekly && (
              <div className="space-y-2">
                <Label htmlFor="give-weeks">Weeks they can see at the start</Label>
                <Input
                  id="give-weeks"
                  type="number"
                  min={1}
                  max={duration}
                  value={weeksAtStart}
                  onChange={(e) => setWeeksAtStart(Number(e.target.value))}
                  className="w-24"
                />
                <p className="text-xs text-muted-foreground">
                  Out of {duration} week{duration === 1 ? "" : "s"}. You can open or hide any week later on the program
                  page.
                </p>
              </div>
            )}
          </div>

          {program?.price_cents ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={complimentary} onCheckedChange={(v) => setComplimentary(v === true)} />
              Free for this client (no payment needed)
            </label>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit || saving}>
            {saving ? "Giving..." : "Give program"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
