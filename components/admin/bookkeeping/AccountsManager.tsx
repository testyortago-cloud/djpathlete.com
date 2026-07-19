"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { toast } from "sonner"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StatementsList } from "@/components/admin/bookkeeping/StatementsList"
import type { BookkeepingBook, BookkeepingAccount, BookkeepingDocument, LedgerAccountType } from "@/types/database"

interface NewAccountForm {
  name: string
  account_type: LedgerAccountType
  service_line: string
  is_deductible_candidate: boolean
  tax_category: string
}

const EMPTY_FORM: NewAccountForm = {
  name: "",
  account_type: "expense",
  service_line: "",
  is_deductible_candidate: false,
  tax_category: "",
}

interface EditForm {
  name: string
  service_line: string
  is_deductible_candidate: boolean
  tax_category: string
}

export function AccountsManager({
  books,
  initialBookId,
  initialAccounts,
  initialDocuments,
}: {
  books: BookkeepingBook[]
  initialBookId: string
  initialAccounts: BookkeepingAccount[]
  initialDocuments: BookkeepingDocument[]
}) {
  const [bookId, setBookId] = useState(initialBookId)
  const [accounts, setAccounts] = useState<BookkeepingAccount[]>(initialAccounts)
  const [loading, setLoading] = useState(false)
  const isFirstLoad = useRef(true)

  const [form, setForm] = useState<NewAccountForm>(EMPTY_FORM)
  const [adding, setAdding] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Refetch accounts whenever the active book changes — skip the very first
  // render, the server page already supplied initialAccounts for it.
  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false
      return
    }
    if (!bookId) {
      setAccounts([])
      return
    }
    let cancelled = false
    setLoading(true)
    fetch(`/api/admin/bookkeeping/accounts?book_id=${bookId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load accounts")
        return res.json()
      })
      .then((body: { accounts: BookkeepingAccount[] }) => {
        if (!cancelled) setAccounts(body.accounts ?? [])
      })
      .catch((error) => {
        if (!cancelled) toast.error(`Failed to load accounts: ${(error as Error).message}`)
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
  }

  async function addAccount() {
    if (!form.name.trim()) {
      toast.error("Enter an account name")
      return
    }
    setAdding(true)
    try {
      const res = await fetch("/api/admin/bookkeeping/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book_id: bookId,
          name: form.name.trim(),
          account_type: form.account_type,
          service_line: form.service_line.trim() || null,
          is_deductible_candidate: form.is_deductible_candidate,
          tax_category: form.tax_category.trim() || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "Failed to add account")
      }
      const { account } = (await res.json()) as { account: BookkeepingAccount }
      setAccounts((list) => [...list, account])
      setForm(EMPTY_FORM)
      toast.success("Account added")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setAdding(false)
    }
  }

  function startEdit(a: BookkeepingAccount) {
    setEditingId(a.id)
    setEditForm({
      name: a.name,
      service_line: a.service_line ?? "",
      is_deductible_candidate: a.is_deductible_candidate,
      tax_category: a.tax_category ?? "",
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditForm(null)
  }

  async function saveEdit(id: string) {
    if (!editForm) return
    if (!editForm.name.trim()) {
      toast.error("Name can't be empty")
      return
    }
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/bookkeeping/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name.trim(),
          service_line: editForm.service_line.trim() || null,
          is_deductible_candidate: editForm.is_deductible_candidate,
          tax_category: editForm.tax_category.trim() || null,
        }),
      })
      if (!res.ok) throw new Error((await res.text()) || "Update failed")
      const { account } = (await res.json()) as { account: BookkeepingAccount }
      setAccounts((list) => list.map((x) => (x.id === id ? account : x)))
      cancelEdit()
      toast.success("Account updated")
    } catch (error) {
      toast.error(`Update failed: ${(error as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  async function archiveAccount(id: string) {
    const confirmed = window.confirm("Archive this account? It will no longer be selectable for new entries.")
    if (!confirmed) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/bookkeeping/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      })
      if (!res.ok) throw new Error((await res.text()) || "Archive failed")
      // The list endpoint filters archived_at IS NULL, so drop it locally
      // rather than round-tripping a refetch.
      setAccounts((list) => list.filter((x) => x.id !== id))
      toast.success("Account archived")
    } catch (error) {
      toast.error(`Archive failed: ${(error as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  function renderRow(a: BookkeepingAccount) {
    if (editingId === a.id && editForm) {
      return (
        <li key={a.id} className="space-y-3 rounded-lg border border-border bg-card p-3">
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              placeholder="Name"
              aria-label="Account name"
            />
            <Input
              value={editForm.service_line}
              onChange={(e) => setEditForm({ ...editForm, service_line: e.target.value })}
              placeholder="Service line"
              aria-label="Service line"
            />
          </div>
          <Input
            value={editForm.tax_category}
            onChange={(e) => setEditForm({ ...editForm, tax_category: e.target.value })}
            placeholder="Tax category"
            aria-label="Tax category"
          />
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Switch
              checked={editForm.is_deductible_candidate}
              onCheckedChange={(v) => setEditForm({ ...editForm, is_deductible_candidate: v })}
            />
            Deductible candidate
          </label>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => saveEdit(a.id)} disabled={busyId === a.id}>
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={cancelEdit} disabled={busyId === a.id}>
              Cancel
            </Button>
          </div>
        </li>
      )
    }
    return (
      <li key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
        <div>
          <p className="font-medium text-foreground">{a.name}</p>
          <p className="text-xs text-muted-foreground">
            {a.service_line ?? "no service line"}
            {a.is_deductible_candidate ? " · Deductible candidate" : ""}
            {a.tax_category ? ` · ${a.tax_category}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" onClick={() => startEdit(a)} disabled={busyId === a.id}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={() => archiveAccount(a.id)} disabled={busyId === a.id}>
            Archive
          </Button>
        </div>
      </li>
    )
  }

  const incomeAccounts = accounts.filter((a) => a.account_type === "income")
  const expenseAccounts = accounts.filter((a) => a.account_type === "expense")

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/books"
          className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-xs transition-colors hover:border-accent hover:text-accent"
        >
          <ArrowLeft className="size-4" />
          Back to Accounting
        </Link>
        <h1 className="text-2xl font-heading text-primary">Chart of accounts</h1>
        <p className="text-sm text-muted-foreground mt-1">Income and expense categories for the ledger.</p>
      </div>

      {books.length === 0 ? (
        <p className="text-sm text-muted-foreground">No books configured.</p>
      ) : (
        <Tabs value={bookId} onValueChange={handleBookChange}>
          <TabsList>
            {books.map((book) => (
              <TabsTrigger key={book.id} value={book.id}>
                {book.name}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={bookId} className="space-y-6 mt-4">
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-3">
                <h2 className="text-sm font-heading text-success uppercase tracking-wide">Income accounts</h2>
                {incomeAccounts.length === 0 && !loading ? (
                  <p className="text-sm text-muted-foreground">No income accounts yet.</p>
                ) : (
                  <ul className="space-y-2">{incomeAccounts.map(renderRow)}</ul>
                )}
              </div>
              <div className="space-y-3">
                <h2 className="text-sm font-heading text-error uppercase tracking-wide">Expense accounts</h2>
                {expenseAccounts.length === 0 && !loading ? (
                  <p className="text-sm text-muted-foreground">No expense accounts yet.</p>
                ) : (
                  <ul className="space-y-2">{expenseAccounts.map(renderRow)}</ul>
                )}
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-border bg-card p-4">
              <h2 className="font-heading text-foreground">New account</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="na-name">Name</Label>
                  <Input
                    id="na-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Coaching income"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select
                    value={form.account_type}
                    onValueChange={(v) => setForm({ ...form, account_type: v as LedgerAccountType })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="income">Income</SelectItem>
                      <SelectItem value="expense">Expense</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="na-service-line">Service line (optional)</Label>
                  <Input
                    id="na-service-line"
                    value={form.service_line}
                    onChange={(e) => setForm({ ...form, service_line: e.target.value })}
                    placeholder="e.g. performance_training"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="na-tax-category">Tax category (optional)</Label>
                  <Input
                    id="na-tax-category"
                    value={form.tax_category}
                    onChange={(e) => setForm({ ...form, tax_category: e.target.value })}
                    placeholder="e.g. Schedule C line 8"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <Switch
                  checked={form.is_deductible_candidate}
                  onCheckedChange={(v) => setForm({ ...form, is_deductible_candidate: v })}
                />
                Deductible candidate
              </label>
              <Button onClick={addAccount} disabled={adding || !form.name.trim()}>
                Add account
              </Button>
            </div>

            <StatementsList bookId={bookId} initialDocuments={initialDocuments} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
