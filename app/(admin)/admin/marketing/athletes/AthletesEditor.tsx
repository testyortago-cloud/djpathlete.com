"use client"

import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { Plus, Save, Trash2 } from "lucide-react"
import {
  athletesPageContentSchema,
  STAGE_ICONS,
  type AthletesPageContent,
  type AthleteStage,
  type StageIcon,
} from "@/lib/validators/athletes-page"

const ICON_LABELS: Record<StageIcon, string> = {
  plane: "Plane (touring / pro)",
  graduation_cap: "Graduation cap (collegiate)",
  sparkles: "Sparkles (youth)",
  heart_pulse: "Heart pulse (return-to-sport)",
}

const NEW_STAGE: AthleteStage = {
  id: "new-stage",
  icon: "plane",
  name: "New stage",
  heading: "",
  summary: "",
  pillars: [""],
}

interface Props {
  initialContent: AthletesPageContent
}

/**
 * Edits the `athletes_page_content` row. Same shape as the about-page
 * editor — single PATCH on save, sticky save bar, paragraph/pillar add+remove.
 */
export function AthletesEditor({ initialContent }: Props) {
  const [content, setContent] = useState<AthletesPageContent>(initialContent)
  const [saving, setSaving] = useState(false)
  const [issues, setIssues] = useState<string[]>([])

  function setField<K extends keyof AthletesPageContent>(key: K, value: AthletesPageContent[K]) {
    setContent((c) => ({ ...c, [key]: value }))
  }

  function setStage<K extends keyof AthleteStage>(index: number, key: K, value: AthleteStage[K]) {
    setContent((c) => {
      const next = [...c.stages]
      next[index] = { ...next[index], [key]: value }
      return { ...c, stages: next }
    })
  }

  function setStagePillar(stageIndex: number, pillarIndex: number, value: string) {
    setContent((c) => {
      const next = [...c.stages]
      const pillars = [...next[stageIndex].pillars]
      pillars[pillarIndex] = value
      next[stageIndex] = { ...next[stageIndex], pillars }
      return { ...c, stages: next }
    })
  }

  function addStagePillar(stageIndex: number) {
    setContent((c) => {
      const next = [...c.stages]
      next[stageIndex] = {
        ...next[stageIndex],
        pillars: [...next[stageIndex].pillars, ""],
      }
      return { ...c, stages: next }
    })
  }

  function removeStagePillar(stageIndex: number, pillarIndex: number) {
    setContent((c) => {
      const next = [...c.stages]
      const pillars = next[stageIndex].pillars.filter((_, i) => i !== pillarIndex)
      next[stageIndex] = { ...next[stageIndex], pillars: pillars.length > 0 ? pillars : [""] }
      return { ...c, stages: next }
    })
  }

  function addStage() {
    setContent((c) => ({ ...c, stages: [...c.stages, { ...NEW_STAGE, pillars: [""] }] }))
  }

  function removeStage(index: number) {
    setContent((c) => {
      const next = c.stages.filter((_, i) => i !== index)
      return { ...c, stages: next.length > 0 ? next : [{ ...NEW_STAGE, pillars: [""] }] }
    })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setIssues([])

    const trimmed: AthletesPageContent = {
      ...content,
      stages: content.stages.map((s) => ({
        ...s,
        id: s.id.trim(),
        name: s.name.trim(),
        heading: s.heading.trim(),
        summary: s.summary.trim(),
        pillars: s.pillars.map((p) => p.trim()).filter((p) => p.length > 0),
      })),
    }

    const parsed = athletesPageContentSchema.safeParse(trimmed)
    if (!parsed.success) {
      const messages = parsed.error.issues.map(
        (i) => `${i.path.join(".") || "form"}: ${i.message}`,
      )
      setIssues(messages)
      toast.error("Please fix the highlighted fields")
      return
    }

    setSaving(true)
    try {
      const res = await fetch("/api/admin/marketing/athletes", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error ?? `HTTP ${res.status}`)
        return
      }
      setContent(json.content as AthletesPageContent)
      toast.success("Athletes page saved")
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

      <Section title="Hero" subtitle="The dark top section — eyebrow, two-line headline, description.">
        <TextField
          label="Eyebrow"
          hint="Small accent label above the headline."
          value={content.hero_eyebrow}
          onChange={(v) => setField("hero_eyebrow", v)}
          maxLength={120}
        />
        <TextField
          label="Headline — line 1"
          value={content.hero_heading_line_1}
          onChange={(v) => setField("hero_heading_line_1", v)}
          maxLength={200}
        />
        <TextField
          label="Headline — line 2 (accent colour)"
          hint="Renders in the accent colour on the second line."
          value={content.hero_heading_line_2}
          onChange={(v) => setField("hero_heading_line_2", v)}
          maxLength={200}
        />
        <Textarea
          label="Description"
          value={content.hero_description}
          onChange={(v) => setField("hero_description", v)}
          rows={3}
          maxLength={800}
        />
      </Section>

      <Section
        title="Four stages — section heading"
        subtitle="The eyebrow + heading shown above the four stage cards."
      >
        <TextField
          label="Eyebrow"
          value={content.stages_eyebrow}
          onChange={(v) => setField("stages_eyebrow", v)}
          maxLength={120}
        />
        <TextField
          label="Heading"
          value={content.stages_heading}
          onChange={(v) => setField("stages_heading", v)}
          maxLength={200}
        />
      </Section>

      <Section
        title="Stage cards"
        subtitle="Each card is one athlete stage. Re-order is by position in the list. Pillars render as the small bulleted list under the summary."
      >
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={addStage}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-accent text-accent text-xs font-medium hover:bg-accent/10 transition-colors"
          >
            <Plus className="size-3.5" />
            Add stage
          </button>
        </div>

        <div className="space-y-5">
          {content.stages.map((stage, i) => (
            <div key={i} className="rounded-lg border border-border/70 bg-background p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-heading text-sm text-primary">
                  Card {i + 1}: {stage.name || "(unnamed)"}
                </h3>
                <button
                  type="button"
                  onClick={() => removeStage(i)}
                  aria-label={`Remove stage ${i + 1}`}
                  className="p-2 rounded-md text-muted-foreground hover:text-error hover:bg-error/5"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>

              <div className="grid sm:grid-cols-[1fr_180px_180px] gap-3">
                <TextField
                  label="Eyebrow / name"
                  hint='Small accent label, e.g. "Professional".'
                  value={stage.name}
                  onChange={(v) => setStage(i, "name", v)}
                  maxLength={120}
                />
                <TextField
                  label="Anchor id"
                  hint="Lowercase, hyphens only."
                  value={stage.id}
                  onChange={(v) => setStage(i, "id", v)}
                  maxLength={60}
                />
                <label className="block">
                  <span className="block text-sm font-medium text-primary mb-1">Icon</span>
                  <select
                    value={stage.icon}
                    onChange={(e) => setStage(i, "icon", e.target.value as StageIcon)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                  >
                    {STAGE_ICONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {ICON_LABELS[opt]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <TextField
                label="Heading (large H3 on the card)"
                value={stage.heading}
                onChange={(v) => setStage(i, "heading", v)}
                maxLength={200}
              />
              <Textarea
                label="Summary paragraph"
                value={stage.summary}
                onChange={(v) => setStage(i, "summary", v)}
                rows={5}
                maxLength={2000}
              />

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-primary">Pillars (bulleted list)</span>
                  <button
                    type="button"
                    onClick={() => addStagePillar(i)}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-accent text-accent text-xs font-medium hover:bg-accent/10 transition-colors"
                  >
                    <Plus className="size-3.5" />
                    Add pillar
                  </button>
                </div>
                <div className="space-y-2">
                  {stage.pillars.map((pillar, pi) => (
                    <div key={pi} className="flex items-start gap-2">
                      <input
                        type="text"
                        value={pillar}
                        onChange={(e) => setStagePillar(i, pi, e.target.value)}
                        maxLength={300}
                        className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                      />
                      <button
                        type="button"
                        onClick={() => removeStagePillar(i, pi)}
                        aria-label={`Remove pillar ${pi + 1}`}
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
