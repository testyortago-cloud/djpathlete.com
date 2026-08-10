"use client"

// components/admin/funnels/LeadsBoard.tsx — the leads inbox.
//
// Every lead a funnel page has ever captured, and the two things you do with
// one: move its status and write a note. Before this existed the leads were in
// `funnel_submissions` and nothing in the repo read them.
//
// ---------------------------------------------------------------------------
// THE EXPANDED ROW IS THE POINT.
// ---------------------------------------------------------------------------
// A funnel lead already appears in /admin/clients as a `users` row with
// `status: 'lead'`, so a name and an email were never the missing part. What
// only exists here is WHICH PAGE they came from and WHAT THEY ACTUALLY WROTE —
// the sport, the preferred days, the "I tore my ACL in March, cleared to
// train". That is the difference between a list of email addresses and a list
// of people you can call, so `payload` gets a real presentation rather than a
// JSON dump behind a tooltip.
//
// Built on `components/ui/data-table.tsx`, which is the house standard and not
// optional: CLAUDE.md records that /admin/team invented its own table and now
// reads as a different app.

import { useCallback, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ChevronDown, ChevronRight, Download, Mail, Phone, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DataTable,
  DataTableCard,
  DataTableCell,
  DataTableEmpty,
  DataTableFooter,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableToolbar,
} from "@/components/ui/data-table"
import type { FunnelLead } from "@/lib/db/funnel-leads"
import type { FunnelLeadStatus } from "@/types/database"

const STATUS_LABEL: Record<FunnelLeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  signed_up: "Signed up",
}

/**
 * The status control is a `<select>`, because changing it is the main thing you
 * do on this screen and a badge you have to click twice is friction. It still
 * carries the badge PALETTE so a full inbox is scannable at a glance — the
 * tones are lifted from `DataTableBadge`'s own map rather than invented, so the
 * pills here read as the same pills as everywhere else in the admin.
 *
 * `new` is INFO, not success: it is the state that needs action, and painting
 * it green would make an untouched inbox look like a finished one.
 */
const STATUS_CLASS: Record<FunnelLeadStatus, string> = {
  new: "bg-primary/10 text-primary",
  contacted: "bg-accent/15 text-accent",
  signed_up: "bg-success/10 text-success",
}

const STATUSES: FunnelLeadStatus[] = ["new", "contacted", "signed_up"]

export interface LeadsBoardProps {
  leads: FunnelLead[]
  total: number
  counts: Record<FunnelLeadStatus, number>
  /** Every funnel with at least one page, for the page filter. */
  funnels: { id: string; name: string }[]
  filters: {
    funnelId: string
    status: string
    days: string
    search: string
  }
  /** Where "export" points, already carrying the active filter. */
  exportHref: string
}

export function LeadsBoard(props: LeadsBoardProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [search, setSearch] = useState(props.filters.search)

  // Optimistic overlay. A status change is a dropdown, and a dropdown that
  // waits for a round trip before it moves feels broken; the server value wins
  // as soon as `router.refresh()` lands.
  const [local, setLocal] = useState<Record<string, Partial<FunnelLead>>>({})

  const leads = useMemo(() => props.leads.map((lead) => ({ ...lead, ...local[lead.id] })), [props.leads, local])

  const setParam = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams()
      const next = { ...props.filters, ...updates }
      for (const [key, value] of Object.entries(next)) {
        if (value && value !== "all") params.set(key, value)
      }
      startTransition(() => router.push(`/admin/funnels/leads?${params.toString()}`))
    },
    [props.filters, router],
  )

  const patch = useCallback(
    async (id: string, body: { status?: FunnelLeadStatus; notes?: string }, previous: Partial<FunnelLead>) => {
      setLocal((current) => ({ ...current, [id]: { ...current[id], ...body } }))
      try {
        const response = await fetch(`/api/admin/funnels/leads/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        if (!response.ok) {
          // PUT IT BACK. An optimistic update that survives a failed write is a
          // lie the operator will act on — they will believe a lead was marked
          // contacted when the row still says new to everyone else.
          setLocal((current) => ({ ...current, [id]: { ...current[id], ...previous } }))
          const body = (await response.json().catch(() => null)) as { error?: string } | null
          toast.error(body?.error ?? "Could not save that. Nothing was changed.")
          return
        }
        startTransition(() => router.refresh())
      } catch {
        setLocal((current) => ({ ...current, [id]: { ...current[id], ...previous } }))
        toast.error("Could not reach the server. Nothing was changed.")
      }
    },
    [router],
  )

  const hasFilter =
    props.filters.funnelId !== "" ||
    props.filters.status !== "" ||
    props.filters.days !== "" ||
    props.filters.search !== ""

  return (
    <DataTableCard>
      <DataTableToolbar className="flex-wrap gap-2">
        <form
          className="relative flex-1 min-w-[14rem]"
          onSubmit={(event) => {
            event.preventDefault()
            setParam({ search })
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, email or phone"
            aria-label="Search leads"
            className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-sm outline-none focus-visible:border-accent"
          />
        </form>

        <select
          aria-label="Filter by page"
          value={props.filters.funnelId || "all"}
          onChange={(event) => setParam({ funnelId: event.target.value })}
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
        >
          <option value="all">All pages</option>
          {props.funnels.map((funnel) => (
            <option key={funnel.id} value={funnel.id}>
              {funnel.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by status"
          value={props.filters.status || "all"}
          onChange={(event) => setParam({ status: event.target.value })}
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
        >
          <option value="all">Any status</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABEL[status]} ({props.counts[status]})
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by date"
          value={props.filters.days || "all"}
          onChange={(event) => setParam({ days: event.target.value })}
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
        >
          <option value="all">All time</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>

        {hasFilter ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setParam({ funnelId: "", status: "", days: "", search: "" })}
          >
            <X className="size-4" aria-hidden />
            Clear
          </Button>
        ) : null}

        <Button asChild variant="outline" size="sm">
          {/* A plain link, not fetch+blob: the browser's own download handles
              the filename and the save dialog, and the export honours whatever
              filter is on screen rather than silently exporting everything. */}
          <a href={props.exportHref}>
            <Download className="size-4" aria-hidden />
            Export CSV
          </a>
        </Button>
      </DataTableToolbar>

      <DataTable>
        <DataTableHeader>
          <tr>
            <DataTableHead className="w-8" aria-label="Expand" />
            <DataTableHead>When</DataTableHead>
            <DataTableHead>Page</DataTableHead>
            <DataTableHead>Lead</DataTableHead>
            <DataTableHead>Contact</DataTableHead>
            <DataTableHead>Status</DataTableHead>
          </tr>
        </DataTableHeader>
        <tbody>
          {leads.length === 0 ? (
            <DataTableEmpty colSpan={6}>
              {hasFilter
                ? "No leads match these filters."
                : "No leads yet. They appear here the moment someone submits a form on a published page."}
            </DataTableEmpty>
          ) : (
            leads.map((lead) => {
              const isOpen = expanded === lead.id
              return (
                <LeadRows
                  key={lead.id}
                  lead={lead}
                  isOpen={isOpen}
                  onToggle={() => setExpanded(isOpen ? null : lead.id)}
                  onPatch={patch}
                />
              )
            })
          )}
        </tbody>
      </DataTable>

      <DataTableFooter>
        <span className="text-sm text-muted-foreground">
          {props.total === 1 ? "1 lead" : `${props.total.toLocaleString()} leads`}
          {leads.length < props.total ? ` · showing ${leads.length}` : ""}
          {pending ? " · updating…" : ""}
        </span>
      </DataTableFooter>
    </DataTableCard>
  )
}

function LeadRows({
  lead,
  isOpen,
  onToggle,
  onPatch,
}: {
  lead: FunnelLead
  isOpen: boolean
  onToggle: () => void
  onPatch: (
    id: string,
    body: { status?: FunnelLeadStatus; notes?: string },
    previous: Partial<FunnelLead>,
  ) => Promise<void>
}) {
  const [notes, setNotes] = useState(lead.notes ?? "")

  return (
    <>
      <DataTableRow>
        <DataTableCell>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-label={isOpen ? `Hide ${lead.name ?? "lead"}'s answers` : `Show ${lead.name ?? "lead"}'s answers`}
            className="text-muted-foreground hover:text-primary"
          >
            {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        </DataTableCell>
        <DataTableCell muted>
          <time dateTime={lead.created_at}>{formatWhen(lead.created_at)}</time>
        </DataTableCell>
        <DataTableCell muted>
          {lead.funnel_name ?? "—"}
          {lead.step_name ? <span className="text-xs"> · {lead.step_name}</span> : null}
        </DataTableCell>
        <DataTableCell className="font-medium text-foreground">{lead.name ?? "—"}</DataTableCell>
        <DataTableCell>
          <div className="flex flex-col gap-0.5 text-sm">
            {lead.email ? (
              <a className="inline-flex items-center gap-1.5 hover:text-primary" href={`mailto:${lead.email}`}>
                <Mail className="size-3.5 text-muted-foreground" aria-hidden />
                {lead.email}
              </a>
            ) : null}
            {lead.phone ? (
              <a className="inline-flex items-center gap-1.5 hover:text-primary" href={`tel:${lead.phone}`}>
                <Phone className="size-3.5 text-muted-foreground" aria-hidden />
                {lead.phone}
              </a>
            ) : null}
            {!lead.email && !lead.phone ? <span className="text-muted-foreground">—</span> : null}
          </div>
        </DataTableCell>
        <DataTableCell>
          <label className="sr-only" htmlFor={`status-${lead.id}`}>
            Status for {lead.name ?? lead.email ?? "this lead"}
          </label>
          <select
            id={`status-${lead.id}`}
            value={lead.status}
            onChange={(event) =>
              void onPatch(lead.id, { status: event.target.value as FunnelLeadStatus }, { status: lead.status })
            }
            className={`rounded-full border border-transparent px-2 py-1 text-xs font-medium ${STATUS_CLASS[lead.status]}`}
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </DataTableCell>
      </DataTableRow>

      {isOpen ? (
        <tr className="border-b border-border bg-surface/30 last:border-b-0">
          <td colSpan={6} className="px-4 py-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What they wrote</h3>
                <AnswerList payload={lead.payload} />
              </div>
              <div>
                <label
                  htmlFor={`notes-${lead.id}`}
                  className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  Your notes
                </label>
                <textarea
                  id={`notes-${lead.id}`}
                  value={notes}
                  rows={4}
                  placeholder="Called Tuesday, wants the 6am slot…"
                  onChange={(event) => setNotes(event.target.value)}
                  // On blur, not on every keystroke: a PATCH per character would
                  // be one write per letter and an audit row per letter with it.
                  onBlur={() => {
                    if (notes.trim() === (lead.notes ?? "").trim()) return
                    void onPatch(lead.id, { notes }, { notes: lead.notes })
                  }}
                  className="mt-1.5 w-full rounded-lg border border-border bg-white p-2 text-sm outline-none focus-visible:border-accent"
                />
                <p className="mt-1 text-xs text-muted-foreground">Saved when you click away.</p>
                {lead.status_changed_at ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Status last changed {formatWhen(lead.status_changed_at)}.
                  </p>
                ) : null}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}

/**
 * The visitor's answers, as a definition list.
 *
 * `payload` holds whatever fields the form on that page happened to have, so
 * this cannot be a fixed set of columns — and a `<pre>{JSON}</pre>` would be
 * the same information in a form nobody reads before a phone call.
 */
function AnswerList({ payload }: { payload: Record<string, unknown> }) {
  const entries = Object.entries(payload).filter(([, value]) => String(value ?? "").trim().length > 0)

  if (entries.length === 0) {
    return <p className="mt-1.5 text-sm text-muted-foreground">The form recorded no extra answers.</p>
  }

  return (
    <dl className="mt-1.5 space-y-1.5">
      {entries.map(([key, value]) => (
        <div key={key} className="text-sm">
          <dt className="text-xs text-muted-foreground">{humanise(key)}</dt>
          <dd className="whitespace-pre-wrap text-foreground">{String(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

/** `preferred_days` / `preferredDays` -> `Preferred days`. */
function humanise(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * Relative for the first day, absolute after.
 *
 * "2 hours ago" is what you want on a lead that just came in; "14 days ago" is
 * a number you have to do arithmetic on to know which Tuesday it was.
 */
function formatWhen(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return "—"
  const minutes = Math.round((Date.now() - then.getTime()) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h ago`
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}
