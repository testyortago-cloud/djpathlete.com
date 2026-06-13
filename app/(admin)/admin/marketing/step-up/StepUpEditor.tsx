"use client"

import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { Plus, Save, Trash2 } from "lucide-react"
import {
  stepUpPageContentSchema,
  type StepUpPackage,
  type StepUpPageContent,
} from "@/lib/validators/step-up-page"

const NEW_PACKAGE: StepUpPackage = {
  badge: "",
  title: "New package",
  desc: "",
  items: [""],
  cta: "Enquire",
  featured: false,
}

interface Props {
  initialContent: StepUpPageContent
}

/**
 * Edits the `step_up_page_content` row (Packages section of
 * /step-up-for-students). Same shape as the athletes-page editor — single
 * PATCH on save, sticky save bar, package + bullet add/remove.
 */
export function StepUpEditor({ initialContent }: Props) {
  const [content, setContent] = useState<StepUpPageContent>(initialContent)
  const [saving, setSaving] = useState(false)
  const [issues, setIssues] = useState<string[]>([])

  function setField<K extends keyof StepUpPageContent>(key: K, value: StepUpPageContent[K]) {
    setContent((c) => ({ ...c, [key]: value }))
  }

  function setPackage<K extends keyof StepUpPackage>(index: number, key: K, value: StepUpPackage[K]) {
    setContent((c) => {
      const next = [...c.packages]
      next[index] = { ...next[index], [key]: value }
      return { ...c, packages: next }
    })
  }

  function setItem(pkgIndex: number, itemIndex: number, value: string) {
    setContent((c) => {
      const next = [...c.packages]
      const items = [...next[pkgIndex].items]
      items[itemIndex] = value
      next[pkgIndex] = { ...next[pkgIndex], items }
      return { ...c, packages: next }
    })
  }

  function addItem(pkgIndex: number) {
    setContent((c) => {
      const next = [...c.packages]
      next[pkgIndex] = { ...next[pkgIndex], items: [...next[pkgIndex].items, ""] }
      return { ...c, packages: next }
    })
  }

  function removeItem(pkgIndex: number, itemIndex: number) {
    setContent((c) => {
      const next = [...c.packages]
      const items = next[pkgIndex].items.filter((_, i) => i !== itemIndex)
      next[pkgIndex] = { ...next[pkgIndex], items: items.length > 0 ? items : [""] }
      return { ...c, packages: next }
    })
  }

  function addPackage() {
    setContent((c) => ({ ...c, packages: [...c.packages, { ...NEW_PACKAGE, items: [""] }] }))
  }

  function removePackage(index: number) {
    setContent((c) => {
      const next = c.packages.filter((_, i) => i !== index)
      return { ...c, packages: next.length > 0 ? next : [{ ...NEW_PACKAGE, items: [""] }] }
    })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setIssues([])

    const trimmed: StepUpPageContent = {
      ...content,
      packages: content.packages.map((p) => ({
        ...p,
        badge: p.badge.trim(),
        title: p.title.trim(),
        desc: p.desc.trim(),
        cta: p.cta.trim(),
        items: p.items.map((it) => it.trim()).filter((it) => it.length > 0),
      })),
    }

    const parsed = stepUpPageContentSchema.safeParse(trimmed)
    if (!parsed.success) {
      const messages = parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`)
      setIssues(messages)
      toast.error("Please fix the highlighted fields")
      return
    }

    setSaving(true)
    try {
      const res = await fetch("/api/admin/marketing/step-up", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error ?? `HTTP ${res.status}`)
        return
      }
      setContent(json.content as StepUpPageContent)
      toast.success("Step Up packages saved")
    } catch {
      toast.error("Failed to save")
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {issues.length > 0 && (
        <div className="rounded-xl border border-error/40 bg-error/5 p-4">
          <p className="text-sm font-medium text-error">There were problems with your changes:</p>
          <ul className="mt-2 list-disc pl-5 text-sm text-error/90 space-y-1">
            {issues.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <Section title="Section heading" subtitle="The eyebrow, heading, and intro shown above the package cards.">
        <TextField
          label="Eyebrow"
          hint="Small accent label above the heading."
          value={content.packages_eyebrow}
          onChange={(v) => setField("packages_eyebrow", v)}
          maxLength={120}
        />
        <TextField
          label="Heading"
          value={content.packages_heading}
          onChange={(v) => setField("packages_heading", v)}
          maxLength={200}
        />
        <Textarea
          label="Intro"
          value={content.packages_intro}
          onChange={(v) => setField("packages_intro", v)}
          rows={3}
          maxLength={800}
        />
      </Section>

      <Section
        title="Package cards"
        subtitle="Each card is one package. Order is by position in the list. Bullets render as the arrow list. Mark one card 'Most popular' to highlight it."
      >
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={addPackage}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-accent text-accent text-xs font-medium hover:bg-accent/10 transition-colors"
          >
            <Plus className="size-3.5" />
            Add package
          </button>
        </div>

        <div className="space-y-5">
          {content.packages.map((pkg, i) => (
            <div key={i} className="rounded-lg border border-border/70 bg-background p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-heading text-sm text-primary">
                  Card {i + 1}: {pkg.title || "(untitled)"}
                </h3>
                <button
                  type="button"
                  onClick={() => removePackage(i)}
                  aria-label={`Remove package ${i + 1}`}
                  className="p-2 rounded-md text-muted-foreground hover:text-error hover:bg-error/5"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>

              <div className="grid sm:grid-cols-[1fr_180px] gap-3">
                <TextField
                  label="Title"
                  value={pkg.title}
                  onChange={(v) => setPackage(i, "title", v)}
                  maxLength={120}
                />
                <TextField
                  label="Button label"
                  value={pkg.cta}
                  onChange={(v) => setPackage(i, "cta", v)}
                  maxLength={40}
                />
              </div>

              <TextField
                label="Badge"
                hint='Small label above the title, e.g. "★ Most Popular" or "Clinic · Aligned to Funding Quarter".'
                value={pkg.badge}
                onChange={(v) => setPackage(i, "badge", v)}
                maxLength={60}
              />

              <Textarea
                label="Description"
                value={pkg.desc}
                onChange={(v) => setPackage(i, "desc", v)}
                rows={3}
                maxLength={600}
              />

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={pkg.featured}
                  onChange={(e) => setPackage(i, "featured", e.target.checked)}
                  className="size-4 rounded border-border text-accent focus:ring-2 focus:ring-accent/50"
                />
                <span className="text-sm font-medium text-primary">
                  Highlight this card (&quot;Most popular&quot; styling)
                </span>
              </label>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-primary">Bullets (arrow list)</span>
                  <button
                    type="button"
                    onClick={() => addItem(i)}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-accent text-accent text-xs font-medium hover:bg-accent/10 transition-colors"
                  >
                    <Plus className="size-3.5" />
                    Add bullet
                  </button>
                </div>
                <div className="space-y-2">
                  {pkg.items.map((item, ii) => (
                    <div key={ii} className="flex items-start gap-2">
                      <input
                        type="text"
                        value={item}
                        onChange={(e) => setItem(i, ii, e.target.value)}
                        maxLength={200}
                        className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                      />
                      <button
                        type="button"
                        onClick={() => removeItem(i, ii)}
                        aria-label={`Remove bullet ${ii + 1}`}
                        className="p-2 rounded-md text-muted-foreground hover:text-error hover:bg-error/5"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <div className="flex items-center justify-end gap-3 sticky bottom-0 bg-background/95 backdrop-blur py-4 -mx-4 px-4 border-t border-border">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          <Save className="size-4" />
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  )
}

// ─── primitives ──────────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 sm:p-6 space-y-4">
      <header>
        <h2 className="font-heading text-lg text-primary">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-1 max-w-2xl">{subtitle}</p>}
      </header>
      {children}
    </section>
  )
}

function TextField({
  label,
  hint,
  value,
  onChange,
  maxLength,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  maxLength?: number
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-primary mb-1">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
      />
      {hint && <span className="block text-xs text-muted-foreground mt-1">{hint}</span>}
    </label>
  )
}

function Textarea({
  label,
  hint,
  value,
  onChange,
  rows = 4,
  maxLength,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  rows?: number
  maxLength?: number
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-primary">{label}</span>
        {maxLength && (
          <span className="text-[11px] font-mono text-muted-foreground">
            {value.length}/{maxLength}
          </span>
        )}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={maxLength}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-accent/50 resize-y"
      />
      {hint && <span className="block text-xs text-muted-foreground mt-1">{hint}</span>}
    </label>
  )
}
