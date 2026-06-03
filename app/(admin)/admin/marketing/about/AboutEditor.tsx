"use client"

import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { Plus, Save, Trash2 } from "lucide-react"
import {
  aboutPageContentSchema,
  CREDENTIAL_CATEGORIES,
  CREDENTIAL_ICONS,
  type AboutPageContent,
  type Credential,
  type CredentialCategory,
  type CredentialIcon,
} from "@/lib/validators/about-page"

/** Display labels for the credential icon picker. */
const ICON_LABELS: Record<CredentialIcon, string> = {
  graduation_cap: "Degree (cap)",
  award: "Certification (award)",
  trophy: "Experience (trophy)",
}

/** Display labels for the schema credentialCategory. */
const CATEGORY_LABELS: Record<CredentialCategory, string> = {
  degree: "Degree",
  certification: "Certification",
  experience: "Experience",
}

const NEW_CREDENTIAL: Credential = {
  icon: "award",
  title: "",
  category: "certification",
}

interface Props {
  initialContent: AboutPageContent
}

/**
 * Edits the `about_page_content` row. Each text field is bound to local state;
 * the bio and journey paragraph arrays are managed as ordered lists with
 * add/remove controls. Save is one PATCH that round-trips the validator.
 */
export function AboutEditor({ initialContent }: Props) {
  const [content, setContent] = useState<AboutPageContent>(initialContent)
  const [saving, setSaving] = useState(false)
  const [issues, setIssues] = useState<string[]>([])

  function setField<K extends keyof AboutPageContent>(key: K, value: AboutPageContent[K]) {
    setContent((c) => ({ ...c, [key]: value }))
  }

  function setParagraph(
    key: "hero_bio_paragraphs" | "story_paragraphs",
    index: number,
    value: string,
  ) {
    setContent((c) => {
      const next = [...c[key]]
      next[index] = value
      return { ...c, [key]: next }
    })
  }

  function addParagraph(key: "hero_bio_paragraphs" | "story_paragraphs") {
    setContent((c) => ({ ...c, [key]: [...c[key], ""] }))
  }

  function removeParagraph(
    key: "hero_bio_paragraphs" | "story_paragraphs",
    index: number,
  ) {
    setContent((c) => {
      const next = c[key].filter((_, i) => i !== index)
      // Always keep at least one — the schema rejects an empty list, and the
      // public page would render a hollow section.
      return { ...c, [key]: next.length > 0 ? next : [""] }
    })
  }

  function setCredential<K extends keyof Credential>(
    index: number,
    key: K,
    value: Credential[K],
  ) {
    setContent((c) => {
      const next = [...c.credentials]
      next[index] = { ...next[index], [key]: value }
      return { ...c, credentials: next }
    })
  }

  function addCredential() {
    setContent((c) => ({ ...c, credentials: [...c.credentials, { ...NEW_CREDENTIAL }] }))
  }

  function removeCredential(index: number) {
    setContent((c) => {
      const next = c.credentials.filter((_, i) => i !== index)
      return { ...c, credentials: next.length > 0 ? next : [{ ...NEW_CREDENTIAL }] }
    })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setIssues([])

    // Trim empties out of the paragraph and credential lists so the user
    // doesn't have to chase down half-filled rows.
    const trimmed: AboutPageContent = {
      ...content,
      hero_bio_paragraphs: content.hero_bio_paragraphs
        .map((p) => p.trim())
        .filter((p) => p.length > 0),
      story_paragraphs: content.story_paragraphs
        .map((p) => p.trim())
        .filter((p) => p.length > 0),
      credentials: content.credentials
        .map((c) => ({
          ...c,
          title: c.title.trim(),
          recognizing_org: c.recognizing_org?.trim() || undefined,
          recognizing_url: c.recognizing_url?.trim() || undefined,
        }))
        .filter((c) => c.title.length > 0),
    }

    const parsed = aboutPageContentSchema.safeParse(trimmed)
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
      const res = await fetch("/api/admin/marketing/about", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error ?? `HTTP ${res.status}`)
        return
      }
      setContent(json.content as AboutPageContent)
      toast.success("About page saved")
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

      <Section title="Hero" subtitle="The top of the About page — eyebrow, headline, credentials line, and bio paragraphs.">
        <TextField
          label="Eyebrow"
          hint="Small label above the headline."
          value={content.hero_eyebrow}
          onChange={(v) => setField("hero_eyebrow", v)}
          maxLength={120}
        />
        <TextField
          label="Headline"
          value={content.hero_heading}
          onChange={(v) => setField("hero_heading", v)}
          maxLength={160}
        />
        <TextField
          label="Credentials line"
          hint='Shown in accent uppercase under the headline, e.g. "PhD · Sports Performance Coach · CSCS · NASM".'
          value={content.hero_credentials_line}
          onChange={(v) => setField("hero_credentials_line", v)}
          maxLength={300}
        />
        <ParagraphList
          label="Bio paragraphs"
          hint="One textarea per paragraph rendered under the credentials line."
          paragraphs={content.hero_bio_paragraphs}
          onChange={(i, v) => setParagraph("hero_bio_paragraphs", i, v)}
          onAdd={() => addParagraph("hero_bio_paragraphs")}
          onRemove={(i) => removeParagraph("hero_bio_paragraphs", i)}
        />
      </Section>

      <Section
        title='"In short" answer block'
        subtitle="The semantic answer block under the hero — extracted by Google AI Overviews and ChatGPT for entity definitions."
      >
        <TextField
          label="Eyebrow"
          value={content.aeo_eyebrow}
          onChange={(v) => setField("aeo_eyebrow", v)}
          maxLength={60}
        />
        <TextField
          label="Question"
          hint="Phrase as a real user question, e.g. &quot;Who is Darren J Paul?&quot;"
          value={content.aeo_question}
          onChange={(v) => setField("aeo_question", v)}
          maxLength={300}
        />
        <Textarea
          label="Answer"
          hint="Aim for 130–170 words. First sentence states the answer directly."
          value={content.aeo_answer}
          onChange={(v) => setField("aeo_answer", v)}
          rows={8}
          maxLength={4000}
        />
      </Section>

      <Section title="The journey" subtitle='The middle "Story" section — heading and one textarea per paragraph.'>
        <TextField
          label="Heading"
          value={content.story_heading}
          onChange={(v) => setField("story_heading", v)}
          maxLength={120}
        />
        <ParagraphList
          label="Story paragraphs"
          paragraphs={content.story_paragraphs}
          onChange={(i, v) => setParagraph("story_paragraphs", i, v)}
          onAdd={() => addParagraph("story_paragraphs")}
          onRemove={(i) => removeParagraph("story_paragraphs", i)}
        />
      </Section>

      <Section title="Bottom CTA" subtitle="The closing call-to-action band that links readers to the contact form.">
        <TextField
          label="Eyebrow"
          value={content.cta_eyebrow}
          onChange={(v) => setField("cta_eyebrow", v)}
          maxLength={120}
        />
        <TextField
          label="Heading"
          value={content.cta_heading}
          onChange={(v) => setField("cta_heading", v)}
          maxLength={160}
        />
        <Textarea
          label="Description"
          value={content.cta_description}
          onChange={(v) => setField("cta_description", v)}
          rows={3}
          maxLength={500}
        />
        <div className="grid sm:grid-cols-2 gap-4">
          <TextField
            label="Button label"
            value={content.cta_button_label}
            onChange={(v) => setField("cta_button_label", v)}
            maxLength={60}
          />
          <TextField
            label="Button URL"
            hint='Internal path like "/contact" or an absolute https URL.'
            value={content.cta_button_href}
            onChange={(v) => setField("cta_button_href", v)}
            maxLength={300}
          />
        </div>
      </Section>

      <Section
        title="Page SEO"
        subtitle="The <title> tag and meta description shown to Google and shared on social. Updates flow into Open Graph + Twitter Card automatically."
      >
        <TextField
          label="Meta title"
          hint="Shown as the SERP heading. Keep under 70 characters; this site appends &quot; | DJP Athlete&quot; on social shares."
          value={content.meta_title}
          onChange={(v) => setField("meta_title", v)}
          maxLength={70}
        />
        <Textarea
          label="Meta description"
          hint="One-sentence summary Google may show under the title. 150–170 characters is the sweet spot."
          value={content.meta_description}
          onChange={(v) => setField("meta_description", v)}
          rows={3}
          maxLength={180}
        />
      </Section>

      <Section
        title="Credentials & certifications"
        subtitle="Each credential appears as a card on the page AND as a hasCredential entry in the Person JSON-LD — adding a new certification here improves both the visible content and the structured E-E-A-T signal Google + AI Overviews read."
      >
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={addCredential}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-accent text-accent text-xs font-medium hover:bg-accent/10 transition-colors"
          >
            <Plus className="size-3.5" />
            Add credential
          </button>
        </div>
        <div className="space-y-3">
          {content.credentials.map((cred, i) => (
            <div
              key={i}
              className="rounded-lg border border-border/70 bg-background p-4 space-y-3"
            >
              <div className="grid sm:grid-cols-[1fr_180px_180px_auto] gap-3 items-start">
                <label className="block">
                  <span className="block text-xs font-medium text-primary mb-1">Title</span>
                  <input
                    type="text"
                    value={cred.title}
                    onChange={(e) => setCredential(i, "title", e.target.value)}
                    maxLength={200}
                    placeholder='e.g. "Certified Strength & Conditioning Specialist (CSCS)"'
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-primary mb-1">Icon</span>
                  <select
                    value={cred.icon}
                    onChange={(e) => setCredential(i, "icon", e.target.value as CredentialIcon)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                  >
                    {CREDENTIAL_ICONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {ICON_LABELS[opt]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-primary mb-1">Category</span>
                  <select
                    value={cred.category}
                    onChange={(e) =>
                      setCredential(i, "category", e.target.value as CredentialCategory)
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                  >
                    {CREDENTIAL_CATEGORIES.map((opt) => (
                      <option key={opt} value={opt}>
                        {CATEGORY_LABELS[opt]}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => removeCredential(i)}
                  aria-label={`Remove credential ${i + 1}`}
                  className="mt-5 p-2 rounded-md text-muted-foreground hover:text-error hover:bg-error/5"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-xs font-medium text-primary mb-1">
                    Recognizing organization{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </span>
                  <input
                    type="text"
                    value={cred.recognizing_org ?? ""}
                    onChange={(e) =>
                      setCredential(i, "recognizing_org", e.target.value || undefined)
                    }
                    maxLength={200}
                    placeholder='e.g. "National Strength and Conditioning Association"'
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-primary mb-1">
                    Recognizing org URL{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </span>
                  <input
                    type="url"
                    value={cred.recognizing_url ?? ""}
                    onChange={(e) =>
                      setCredential(i, "recognizing_url", e.target.value || undefined)
                    }
                    maxLength={500}
                    placeholder="https://www.nsca.com/"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Linking the recognizing organization strengthens the schema — Google verifies
                the credential entity against the org&apos;s URL.
              </p>
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

// ─── small presentational primitives ────────────────────────────────────────

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

function ParagraphList({
  label,
  hint,
  paragraphs,
  onChange,
  onAdd,
  onRemove,
}: {
  label: string
  hint?: string
  paragraphs: string[]
  onChange: (index: number, value: string) => void
  onAdd: () => void
  onRemove: (index: number) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-primary">{label}</span>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-accent text-accent text-xs font-medium hover:bg-accent/10 transition-colors"
        >
          <Plus className="size-3.5" />
          Add paragraph
        </button>
      </div>
      {hint && <p className="text-xs text-muted-foreground mb-2">{hint}</p>}
      <div className="space-y-3">
        {paragraphs.map((p, i) => (
          <div key={i} className="flex items-start gap-2">
            <textarea
              value={p}
              onChange={(e) => onChange(i, e.target.value)}
              rows={4}
              maxLength={2000}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-accent/50 resize-y"
            />
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label={`Remove paragraph ${i + 1}`}
              className="p-2 rounded-md text-muted-foreground hover:text-error hover:bg-error/5"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
