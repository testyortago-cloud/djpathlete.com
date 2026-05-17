"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import type { MarketingProduct } from "@/lib/db/marketing-products"

interface Props {
  mode: "create" | "edit"
  initial?: MarketingProduct
}

interface FormState {
  slug: string
  name: string
  one_liner: string
  target_audience: string
  signature_phrases: string
  pain_points: string
  landing_url: string
  lead_form_url: string
  price_dollars: string
  regular_price_dollars: string
  geo_focus: string
  conversion_type: "purchase" | "lead" | "booking"
  status: "active" | "draft" | "archived"
  notes: string
}

function centsToDollars(cents: number | null): string {
  return cents == null ? "" : (cents / 100).toFixed(2)
}

function dollarsToCents(s: string): number | null {
  const trimmed = s.trim()
  if (!trimmed) return null
  const n = Number.parseFloat(trimmed)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

function arrayToText(arr: string[]): string {
  return arr.join("\n")
}

function textToArray(s: string): string[] {
  return s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
}

export function MarketingProductForm({ mode, initial }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [deleting, setDeleting] = useState(false)
  const [form, setForm] = useState<FormState>({
    slug: initial?.slug ?? "",
    name: initial?.name ?? "",
    one_liner: initial?.one_liner ?? "",
    target_audience: initial?.target_audience ?? "",
    signature_phrases: arrayToText(initial?.signature_phrases ?? []),
    pain_points: arrayToText(initial?.pain_points ?? []),
    landing_url: initial?.landing_url ?? "",
    lead_form_url: initial?.lead_form_url ?? "",
    price_dollars: centsToDollars(initial?.price_cents ?? null),
    regular_price_dollars: centsToDollars(initial?.regular_price_cents ?? null),
    geo_focus: arrayToText(initial?.geo_focus ?? []),
    conversion_type: initial?.conversion_type ?? "lead",
    status: initial?.status ?? "active",
    notes: initial?.notes ?? "",
  })

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((s) => ({ ...s, [key]: value }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const body = {
      slug: form.slug.trim(),
      name: form.name.trim(),
      one_liner: form.one_liner.trim(),
      target_audience: form.target_audience.trim(),
      signature_phrases: textToArray(form.signature_phrases),
      pain_points: textToArray(form.pain_points),
      landing_url: form.landing_url.trim(),
      lead_form_url: form.lead_form_url.trim() || null,
      price_cents: dollarsToCents(form.price_dollars),
      regular_price_cents: dollarsToCents(form.regular_price_dollars),
      geo_focus: textToArray(form.geo_focus),
      conversion_type: form.conversion_type,
      status: form.status,
      notes: form.notes.trim() || null,
    }

    startTransition(async () => {
      const url =
        mode === "create"
          ? "/api/admin/marketing/products"
          : `/api/admin/marketing/products/${form.slug}`
      const method = mode === "create" ? "POST" : "PUT"
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error ?? `HTTP ${res.status}`)
        return
      }
      toast.success(mode === "create" ? "Product created" : "Product saved")
      router.push("/admin/marketing/products")
      router.refresh()
    })
  }

  async function destroy() {
    if (!initial || mode !== "edit") return
    if (!confirm(`Delete "${initial.name}"? The ads agent will stop proposing campaigns for it. This cannot be undone.`)) return
    setDeleting(true)
    const res = await fetch(`/api/admin/marketing/products/${initial.slug}`, {
      method: "DELETE",
    })
    const json = await res.json().catch(() => ({}))
    setDeleting(false)
    if (!res.ok) {
      toast.error(json.error ?? `HTTP ${res.status}`)
      return
    }
    toast.success("Deleted")
    router.push("/admin/marketing/products")
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-6 max-w-3xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Slug" hint="lowercase, underscores. Immutable after create.">
          <input
            type="text"
            value={form.slug}
            onChange={(e) => update("slug", e.target.value)}
            disabled={mode === "edit"}
            required
            pattern="[a-z0-9_]+"
            className="input"
          />
        </Field>
        <Field label="Name">
          <input
            type="text"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            required
            className="input"
          />
        </Field>
      </div>

      <Field label="One-liner" hint="One sentence the agent uses for ad-copy fuel.">
        <textarea
          value={form.one_liner}
          onChange={(e) => update("one_liner", e.target.value)}
          required
          rows={2}
          className="input"
        />
      </Field>

      <Field label="Target audience">
        <textarea
          value={form.target_audience}
          onChange={(e) => update("target_audience", e.target.value)}
          required
          rows={2}
          className="input"
        />
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Signature phrases" hint="One per line. Seeds keyword themes.">
          <textarea
            value={form.signature_phrases}
            onChange={(e) => update("signature_phrases", e.target.value)}
            required
            rows={6}
            className="input font-mono text-sm"
          />
        </Field>
        <Field label="Pain points" hint="One per line. Fuels ad headlines/descriptions.">
          <textarea
            value={form.pain_points}
            onChange={(e) => update("pain_points", e.target.value)}
            rows={6}
            className="input font-mono text-sm"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Landing URL">
          <input
            type="text"
            value={form.landing_url}
            onChange={(e) => update("landing_url", e.target.value)}
            required
            className="input"
          />
        </Field>
        <Field label="Lead form URL" hint="Optional. Defaults to landing URL.">
          <input
            type="text"
            value={form.lead_form_url}
            onChange={(e) => update("lead_form_url", e.target.value)}
            className="input"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Price (USD)" hint="Empty = no fixed price (lead-gen).">
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.price_dollars}
            onChange={(e) => update("price_dollars", e.target.value)}
            className="input"
          />
        </Field>
        <Field label="Regular price (USD)" hint="Optional. Shows in headline crossouts.">
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.regular_price_dollars}
            onChange={(e) => update("regular_price_dollars", e.target.value)}
            className="input"
          />
        </Field>
      </div>

      <Field
        label="Geo focus"
        hint="One per line. ISO codes for online (US, AU). City/region for local services."
      >
        <textarea
          value={form.geo_focus}
          onChange={(e) => update("geo_focus", e.target.value)}
          required
          rows={4}
          className="input font-mono text-sm"
        />
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label="Conversion type">
          <select
            value={form.conversion_type}
            onChange={(e) => update("conversion_type", e.target.value as FormState["conversion_type"])}
            className="input"
          >
            <option value="purchase">purchase</option>
            <option value="lead">lead</option>
            <option value="booking">booking</option>
          </select>
        </Field>
        <Field label="Status" hint="Only 'active' is read by the agent.">
          <select
            value={form.status}
            onChange={(e) => update("status", e.target.value as FormState["status"])}
            className="input"
          >
            <option value="active">active</option>
            <option value="draft">draft</option>
            <option value="archived">archived</option>
          </select>
        </Field>
      </div>

      <Field label="Notes" hint="Coach-only context. Not shown to the agent's reasoning step.">
        <textarea
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
          rows={3}
          className="input"
        />
      </Field>

      <div className="flex items-center gap-3 pt-2 border-t border-border">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center px-4 py-2 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          {isPending ? "Saving…" : mode === "create" ? "Create" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="text-sm text-muted-foreground hover:text-primary"
        >
          Cancel
        </button>
        {mode === "edit" && (
          <button
            type="button"
            onClick={destroy}
            disabled={deleting}
            className="ml-auto inline-flex items-center px-3 py-2 rounded-md border border-error/40 text-error bg-error/5 text-sm hover:bg-error/10 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>

      <style jsx>{`
        :global(.input) {
          width: 100%;
          border: 1px solid var(--color-border, #e5e7eb);
          border-radius: 6px;
          padding: 8px 10px;
          background: white;
          color: inherit;
          font-size: 14px;
        }
        :global(.input:focus) {
          outline: 2px solid var(--color-accent, #c49b7a);
          outline-offset: -1px;
        }
        :global(.input:disabled) {
          background: var(--color-surface, #f5f5f5);
          color: var(--color-muted-foreground, #888);
          cursor: not-allowed;
        }
      `}</style>
    </form>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-primary mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground mt-1">{hint}</span>}
    </label>
  )
}
