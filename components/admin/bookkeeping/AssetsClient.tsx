"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { toast } from "sonner"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BooksTour } from "@/components/admin/bookkeeping/BooksTour"
import { depreciationSchedule } from "@/lib/bookkeeping/depreciation"
import { formatCents } from "@/lib/bookkeeping/money"
import { formatOccurredOn } from "@/lib/bookkeeping/format"
import type { BookkeepingAsset, BookkeepingBook, DepreciationConvention } from "@/types/database"

interface AssetForm {
  name: string
  basis: string // dollars, as typed (ManualEntryDialog convention)
  salvage: string
  in_service_on: string
  convention: DepreciationConvention
  recovery_years: string
  accountant_note: string
}

const EMPTY_FORM: AssetForm = {
  name: "", basis: "", salvage: "0", in_service_on: "",
  convention: "full_month", recovery_years: "5", accountant_note: "",
}

const CONVENTION_LABELS: Record<DepreciationConvention, string> = {
  full_month: "Full month", half_year: "Half year",
}

function toCents(dollars: string): number {
  return Math.round(parseFloat(dollars || "0") * 100)
}

/** Validate + convert the form; returns an error string or the API payload (sans book_id). */
function formToPayload(form: AssetForm): string | Record<string, unknown> {
  const basis = toCents(form.basis)
  const salvage = toCents(form.salvage)
  const years = Number(form.recovery_years)
  if (!form.name.trim()) return "Enter an asset name"
  if (!Number.isFinite(basis) || basis <= 0) return "Enter a valid cost basis"
  if (!Number.isFinite(salvage) || salvage < 0) return "Enter a valid salvage value"
  if (salvage > basis) return "Salvage cannot exceed basis"
  if (!form.in_service_on) return "Pick the in-service date"
  if (!Number.isInteger(years) || years < 1 || years > 50) return "Recovery must be 1–50 years"
  return {
    name: form.name.trim(),
    basis_cents: basis,
    salvage_cents: salvage,
    in_service_on: form.in_service_on,
    method: "straight_line",
    convention: form.convention,
    recovery_years: years,
    accountant_note: form.accountant_note.trim() || null,
  }
}

function assetToForm(a: BookkeepingAsset): AssetForm {
  return {
    name: a.name,
    basis: (a.basis_cents / 100).toString(),
    salvage: (a.salvage_cents / 100).toString(),
    in_service_on: a.in_service_on,
    convention: a.convention,
    recovery_years: a.recovery_years.toString(),
    accountant_note: a.accountant_note ?? "",
  }
}

function AssetFormFields({ form, setForm, idPrefix }: {
  form: AssetForm
  setForm: (f: AssetForm) => void
  idPrefix: string
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-name`}>Asset name</Label>
          <Input id={`${idPrefix}-name`} value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Squat rack" />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-date`}>In service on</Label>
          <Input id={`${idPrefix}-date`} type="date" value={form.in_service_on}
            onChange={(e) => setForm({ ...form, in_service_on: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-basis`}>Cost basis ($)</Label>
          <Input id={`${idPrefix}-basis`} type="number" min="0" step="0.01" value={form.basis}
            onChange={(e) => setForm({ ...form, basis: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-salvage`}>Salvage value ($)</Label>
          <Input id={`${idPrefix}-salvage`} type="number" min="0" step="0.01" value={form.salvage}
            onChange={(e) => setForm({ ...form, salvage: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Method</Label>
          {/* Fixed single-option select — straight-line only, accountant-supplied (D-13). */}
          <Select value="straight_line" onValueChange={() => undefined}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="straight_line">Straight line</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Convention</Label>
          <Select value={form.convention}
            onValueChange={(v) => setForm({ ...form, convention: v as DepreciationConvention })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="full_month">Full month</SelectItem>
              <SelectItem value="half_year">Half year</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-years`}>Recovery (years, 1–50)</Label>
          <Input id={`${idPrefix}-years`} type="number" min="1" max="50" step="1" value={form.recovery_years}
            onChange={(e) => setForm({ ...form, recovery_years: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-note`}>Accountant note (optional)</Label>
          <Input id={`${idPrefix}-note`} value={form.accountant_note}
            onChange={(e) => setForm({ ...form, accountant_note: e.target.value })}
            placeholder="e.g. 7-yr MACRS on the return; book life per CPA" />
        </div>
      </div>
    </>
  )
}

function SchedulePreview({ asset }: { asset: BookkeepingAsset }) {
  // 9999 ≥ any exhaustion year (recovery ≤ 50) — the full schedule, computed client-side.
  const { years, fully_depreciated_in } = depreciationSchedule(asset, 9999)
  return (
    <div className="mt-3 rounded-lg border border-border bg-card p-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-1 pr-4 font-medium">Year</th>
            <th className="py-1 pr-4 text-right font-medium">Depreciation</th>
            <th className="py-1 pr-4 text-right font-medium">Accumulated</th>
            <th className="py-1 pr-4 text-right font-medium">Remaining</th>
          </tr>
        </thead>
        <tbody>
          {years.map((y) => (
            <tr key={y.year} className="border-b">
              <td className="py-1 pr-4">{y.year}</td>
              <td className="py-1 pr-4 text-right">{formatCents(y.depreciation_cents)}</td>
              <td className="py-1 pr-4 text-right">{formatCents(y.accumulated_cents)}</td>
              <td className="py-1 pr-4 text-right">{formatCents(y.remaining_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">
        Fully depreciated in {fully_depreciated_in}. The final year absorbs rounding so the schedule sums exactly to basis − salvage.
      </p>
    </div>
  )
}

export function AssetsClient({ books, initialBookId, initialAssets }: {
  books: BookkeepingBook[]
  initialBookId: string
  initialAssets: BookkeepingAsset[]
}) {
  const [bookId, setBookId] = useState(initialBookId)
  const [assets, setAssets] = useState<BookkeepingAsset[]>(initialAssets)
  const [loading, setLoading] = useState(false)
  const isFirstLoad = useRef(true)

  const [form, setForm] = useState<AssetForm>(EMPTY_FORM)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<AssetForm | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)

  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false
      return
    }
    if (!bookId) {
      setAssets([])
      return
    }
    let cancelled = false
    setLoading(true)
    fetch(`/api/admin/bookkeeping/assets?book_id=${bookId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load assets")
        return res.json()
      })
      .then((body: { assets: BookkeepingAsset[] }) => {
        if (!cancelled) setAssets(body.assets ?? [])
      })
      .catch((error) => {
        if (!cancelled) toast.error(`Failed to load assets: ${(error as Error).message}`)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [bookId])

  function handleBookChange(next: string) {
    setBookId(next)
    setEditingId(null)
    setEditForm(null)
    setPreviewId(null)
  }

  async function addAsset() {
    const payload = formToPayload(form)
    if (typeof payload === "string") {
      toast.error(payload)
      return
    }
    setAdding(true)
    try {
      const res = await fetch("/api/admin/bookkeeping/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book_id: bookId, ...payload }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "Failed to add asset")
      }
      const { asset } = (await res.json()) as { asset: BookkeepingAsset }
      setAssets((list) => [...list, asset])
      setForm(EMPTY_FORM)
      toast.success("Asset added")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setAdding(false)
    }
  }

  async function saveEdit(id: string) {
    if (!editForm) return
    const payload = formToPayload(editForm)
    if (typeof payload === "string") {
      toast.error(payload)
      return
    }
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/bookkeeping/assets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "Update failed")
      }
      const { asset } = (await res.json()) as { asset: BookkeepingAsset }
      setAssets((list) => list.map((x) => (x.id === id ? asset : x)))
      setEditingId(null)
      setEditForm(null)
      toast.success("Asset updated")
    } catch (error) {
      toast.error(`Update failed: ${(error as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  async function removeAsset(a: BookkeepingAsset) {
    const confirmed = window.confirm(`Delete "${a.name}"? The audit log keeps a snapshot, but the register row is removed.`)
    if (!confirmed) return
    setBusyId(a.id)
    try {
      const res = await fetch(`/api/admin/bookkeeping/assets/${a.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error((await res.text()) || "Delete failed")
      setAssets((list) => list.filter((x) => x.id !== a.id))
      toast.success("Asset deleted")
    } catch (error) {
      toast.error(`Delete failed: ${(error as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  function renderRow(a: BookkeepingAsset) {
    if (editingId === a.id && editForm) {
      return (
        <li key={a.id} className="space-y-3 rounded-lg border border-border bg-card p-3">
          <AssetFormFields form={editForm} setForm={setEditForm} idPrefix={`edit-${a.id}`} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => saveEdit(a.id)} disabled={busyId === a.id}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => { setEditingId(null); setEditForm(null) }} disabled={busyId === a.id}>Cancel</Button>
          </div>
        </li>
      )
    }
    return (
      <li key={a.id} className="rounded-lg border border-border p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-medium text-foreground">{a.name}</p>
            <p className="text-xs text-muted-foreground">
              In service {formatOccurredOn(a.in_service_on)} · Basis {formatCents(a.basis_cents)}
              {a.salvage_cents > 0 ? ` · Salvage ${formatCents(a.salvage_cents)}` : ""}
              {` · Straight line · ${CONVENTION_LABELS[a.convention]} · ${a.recovery_years} yr`}
            </p>
            {a.accountant_note ? <p className="text-xs text-muted-foreground italic">{a.accountant_note}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setPreviewId(previewId === a.id ? null : a.id)}>
              {previewId === a.id ? "Hide schedule" : "Schedule"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setEditingId(a.id); setEditForm(assetToForm(a)) }} disabled={busyId === a.id}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={() => removeAsset(a)} disabled={busyId === a.id}>
              Delete
            </Button>
          </div>
        </div>
        {previewId === a.id ? <SchedulePreview asset={a} /> : null}
      </li>
    )
  }

  return (
    <div data-tour="assets" className="space-y-6">
      <div>
        <Link
          href="/admin/books"
          className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-xs transition-colors hover:border-accent hover:text-accent"
        >
          <ArrowLeft className="size-4" />
          Back to Accounting
        </Link>
        <h1 className="text-2xl font-heading text-primary">Equipment &amp; assets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Depreciation is tracked, not decided — enter the basis, method, and life your accountant supplies. Book depreciation for your CPA, not a filing.
        </p>
        <div className="mt-2 flex flex-wrap gap-4">
          <Link href="/admin/books" className="text-sm text-muted-foreground hover:text-accent underline-offset-4 hover:underline">
            Back to ledger
          </Link>
          <Link href="/admin/books/reports" className="text-sm text-muted-foreground hover:text-accent underline-offset-4 hover:underline">
            Reports
          </Link>
          <Link href="/admin/books/insights" className="text-sm text-muted-foreground hover:text-accent underline-offset-4 hover:underline">
            Insights
          </Link>
        </div>
      </div>

      {books.length === 0 ? (
        <p className="text-sm text-muted-foreground">No books configured.</p>
      ) : (
        <Tabs value={bookId} onValueChange={handleBookChange}>
          <TabsList>
            {books.map((book) => (
              <TabsTrigger key={book.id} value={book.id}>{book.name}</TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={bookId} className="mt-4 space-y-6">
            {assets.length === 0 && !loading ? (
              <p className="text-sm text-muted-foreground">
                No assets in this book yet. Add equipment your accountant wants depreciated.
              </p>
            ) : (
              <ul className="space-y-2">{assets.map(renderRow)}</ul>
            )}

            <div className="space-y-3 rounded-lg border border-border bg-card p-4">
              <h2 className="font-heading text-foreground">New asset</h2>
              <AssetFormFields form={form} setForm={setForm} idPrefix="na" />
              <Button onClick={addAsset} disabled={adding || !form.name.trim()}>
                Add asset
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      )}
      <BooksTour />
    </div>
  )
}
