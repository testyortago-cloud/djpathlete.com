"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Save, Eye, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LegalEditor } from "@/components/admin/LegalEditor"
import { toast } from "sonner"
import type { LegalDocument } from "@/types/database"
import { FormErrorBanner } from "@/components/shared/FormErrorBanner"
import { summarizeApiError, type FieldErrors } from "@/lib/errors/humanize"

const LEGAL_FIELD_LABELS: Record<string, string> = {
  title: "Title",
  content: "Content",
  effective_date: "Effective date",
}

const TYPE_LABELS: Record<string, string> = {
  terms_of_service: "Terms of Service",
  privacy_policy: "Privacy Policy",
  liability_waiver: "Liability Waiver",
}

interface LegalDocumentEditorProps {
  document: LegalDocument
}

export function LegalDocumentEditor({ document: doc }: LegalDocumentEditorProps) {
  const router = useRouter()
  const [title, setTitle] = useState(doc.title)
  const [content, setContent] = useState(doc.content)
  const [effectiveDate, setEffectiveDate] = useState(doc.effective_date)
  const [isSaving, setIsSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  async function handleSave() {
    setIsSaving(true)
    setFormError(null)
    setFieldErrors({})
    try {
      const res = await fetch(`/api/admin/legal/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, effective_date: effectiveDate }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const { message, fieldErrors: fe } = summarizeApiError(res, data, "Failed to save document")
        setFormError(message)
        setFieldErrors(fe)
        toast.error(message)
        setIsSaving(false)
        return
      }

      toast.success("Document saved successfully")
      router.refresh()
    } catch {
      const message = "We couldn't reach the server. Please try again."
      setFormError(message)
      toast.error(message)
    } finally {
      setIsSaving(false)
    }
  }

  const previewUrl =
    doc.document_type === "terms_of_service"
      ? "/terms-of-service"
      : doc.document_type === "privacy_policy"
        ? "/privacy-policy"
        : null

  return (
    <div>
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/admin/legal">
            <Button variant="ghost" size="sm" className="gap-1.5">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-foreground">
                {TYPE_LABELS[doc.document_type] ?? doc.document_type}
              </h1>
              <span className="text-sm text-muted-foreground">v{doc.version}</span>
              {doc.is_active && (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                  <CheckCircle2 className="h-3 w-3" />
                  Active
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {previewUrl && (
            <Link href={previewUrl} target="_blank">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Eye className="h-4 w-4" />
                Preview
              </Button>
            </Link>
          )}
          <Button size="sm" onClick={handleSave} disabled={isSaving} className="gap-1.5">
            <Save className="h-4 w-4" />
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {(formError || Object.keys(fieldErrors).length > 0) && (
        <div className="mb-4">
          <FormErrorBanner message={formError} fieldErrors={fieldErrors} labels={LEGAL_FIELD_LABELS} />
        </div>
      )}

      {/* Meta fields */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="space-y-1.5">
          <Label htmlFor="title" className="text-xs font-medium">
            Title
          </Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={isSaving} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="effectiveDate" className="text-xs font-medium">
            Effective Date
          </Label>
          <Input
            id="effectiveDate"
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            disabled={isSaving}
          />
        </div>
      </div>

      {/* Rich text editor */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Content</Label>
        <LegalEditor content={content} onChange={setContent} disabled={isSaving} minHeight="500px" />
      </div>
    </div>
  )
}
