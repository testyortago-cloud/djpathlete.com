"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Save, Send, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { newsletterFormSchema } from "@/lib/validators/newsletter"
import { BlogEditor } from "../blog/BlogEditor"
import { NewsletterGenerateDialog } from "./NewsletterGenerateDialog"
import type { Newsletter } from "@/types/database"
import { FormErrorBanner } from "@/components/shared/FormErrorBanner"
import { humanizeFieldError, summarizeApiError, type FieldErrors } from "@/lib/errors/humanize"

const NEWSLETTER_FIELD_LABELS: Record<string, string> = {
  subject: "Subject",
  preview_text: "Preview text",
  content: "Content",
}

interface NewsletterFormProps {
  newsletter?: Newsletter
  authorId: string
}

export function NewsletterForm({ newsletter, authorId }: NewsletterFormProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [confirmSend, setConfirmSend] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [editorKey, setEditorKey] = useState(0)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const [subject, setSubject] = useState(newsletter?.subject ?? "")
  const [previewText, setPreviewText] = useState(newsletter?.preview_text ?? "")
  const [content, setContent] = useState(newsletter?.content ?? "")

  const isSent = newsletter?.status === "sent"

  const buildPayload = useCallback(
    () => ({
      subject,
      preview_text: previewText,
      content,
    }),
    [subject, previewText, content],
  )

  async function handleSave() {
    setFormError(null)
    setFieldErrors({})
    const payload = buildPayload()
    const parsed = newsletterFormSchema.safeParse(payload)
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors
      setFieldErrors(flat as FieldErrors)
      setFormError("Please fix the highlighted fields before saving.")
      const firstEntry = Object.entries(flat).find(([, v]) => v && v.length > 0)
      if (firstEntry) toast.error(humanizeFieldError(firstEntry[0], firstEntry[1]?.[0], NEWSLETTER_FIELD_LABELS))
      return
    }

    setSaving(true)
    try {
      const url = newsletter ? `/api/admin/newsletter/${newsletter.id}` : "/api/admin/newsletter"
      const method = newsletter ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const { message, fieldErrors: fe } = summarizeApiError(
          res,
          data,
          newsletter ? "Failed to save newsletter" : "Failed to create newsletter",
        )
        setFormError(message)
        setFieldErrors(fe)
        throw new Error(message)
      }
      toast.success(newsletter ? "Newsletter saved!" : "Draft saved!")
      router.push("/admin/newsletter")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  async function handleSend() {
    if (!confirmSend) {
      setConfirmSend(true)
      return
    }

    setFormError(null)
    setFieldErrors({})
    const payload = buildPayload()
    const parsed = newsletterFormSchema.safeParse(payload)
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors
      setFieldErrors(flat as FieldErrors)
      setFormError("Please fix the highlighted fields before sending.")
      const firstEntry = Object.entries(flat).find(([, v]) => v && v.length > 0)
      if (firstEntry) toast.error(humanizeFieldError(firstEntry[0], firstEntry[1]?.[0], NEWSLETTER_FIELD_LABELS))
      return
    }

    setSending(true)
    try {
      let newsletterId = newsletter?.id
      if (!newsletterId) {
        const createRes = await fetch("/api/admin/newsletter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        })
        if (!createRes.ok) {
          const data = await createRes.json().catch(() => ({}))
          const { message, fieldErrors: fe } = summarizeApiError(createRes, data, "Failed to create newsletter")
          setFormError(message)
          setFieldErrors(fe)
          throw new Error(message)
        }
        const created = await createRes.json()
        newsletterId = created.id
      } else {
        const updateRes = await fetch(`/api/admin/newsletter/${newsletterId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        })
        if (!updateRes.ok) {
          const data = await updateRes.json().catch(() => ({}))
          const { message, fieldErrors: fe } = summarizeApiError(updateRes, data, "Failed to save newsletter")
          setFormError(message)
          setFieldErrors(fe)
          throw new Error(message)
        }
      }

      const sendRes = await fetch(`/api/admin/newsletter/${newsletterId}/send`, { method: "POST" })
      if (!sendRes.ok) {
        const data = await sendRes.json().catch(() => ({}))
        const { message } = summarizeApiError(sendRes, data, "Failed to send newsletter")
        setFormError(message)
        throw new Error(message)
      }

      toast.success("Newsletter is being sent to all subscribers!")
      router.push("/admin/newsletter")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setSending(false)
      setConfirmSend(false)
    }
  }

  function handleAiGenerated(data: { subject: string; preview_text: string; content: string }) {
    setSubject(data.subject)
    setPreviewText(data.preview_text)
    setContent(data.content)
    setEditorKey((k) => k + 1)
    setGenerateOpen(false)
  }

  const hasExistingContent = !!(subject || content || previewText)
  const busy = saving || sending

  return (
    <div>
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <Link
          href="/admin/newsletter"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
        >
          <ArrowLeft className="size-4" />
          Back to Newsletters
        </Link>
        {!isSent && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setGenerateOpen(true)}
              disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-primary/30 text-sm font-medium text-primary hover:bg-primary/5 transition-colors disabled:opacity-50"
            >
              <Sparkles className="size-4" />
              Generate with AI
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-surface transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save Draft
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={busy}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                confirmSend
                  ? "bg-red-500 text-white hover:bg-red-600"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              }`}
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {confirmSend ? "Confirm Send to All Subscribers" : "Send"}
            </button>
          </div>
        )}
      </div>

      {(formError || Object.keys(fieldErrors).length > 0) && (
        <div className="mb-4">
          <FormErrorBanner message={formError} fieldErrors={fieldErrors} labels={NEWSLETTER_FIELD_LABELS} />
        </div>
      )}

      {isSent && (
        <div className="rounded-lg border border-success/30 bg-success/5 p-4 mb-6">
          <p className="text-sm text-success font-medium">
            This newsletter was sent on{" "}
            {new Date(newsletter.sent_at!).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
            {" — "}
            {newsletter.sent_count} delivered
            {newsletter.failed_count ? `, ${newsletter.failed_count} failed` : ""}
          </p>
        </div>
      )}

      <div className="space-y-4">
        {/* Subject */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Subject Line</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Newsletter subject"
            disabled={isSent}
            className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60 disabled:cursor-not-allowed"
          />
        </div>

        {/* Preview Text */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Preview Text</label>
          <input
            type="text"
            value={previewText}
            onChange={(e) => setPreviewText(e.target.value)}
            placeholder="Short preview shown in email clients (optional)"
            disabled={isSent}
            className="w-full px-3 py-2 rounded-lg border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <p className="text-xs text-muted-foreground mt-1">{previewText.length}/300</p>
        </div>

        {/* Content Editor */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Content</label>
          {isSent ? (
            <div className="rounded-xl border border-border bg-white p-6">
              <div className="prose prose-lg max-w-none" dangerouslySetInnerHTML={{ __html: content }} />
            </div>
          ) : (
            <BlogEditor key={editorKey} content={content} onChange={setContent} />
          )}
        </div>

        {/* Status info */}
        {newsletter && (
          <div className="rounded-lg border border-border bg-surface/50 p-3 text-xs text-muted-foreground space-y-1">
            <p>
              Status:{" "}
              <span className="font-medium text-foreground">{newsletter.status === "sent" ? "Sent" : "Draft"}</span>
            </p>
            {newsletter.sent_at && (
              <p>
                Sent:{" "}
                {new Date(newsletter.sent_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            )}
            <p>
              Created:{" "}
              {new Date(newsletter.created_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>
        )}
      </div>

      <NewsletterGenerateDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        onGenerated={handleAiGenerated}
        hasExistingContent={hasExistingContent}
      />
    </div>
  )
}
