"use client"

import { AlertCircle } from "lucide-react"
import { formatFieldErrorList, type FieldErrors } from "@/lib/errors/humanize"

interface FormErrorBannerProps {
  /** Top-level message — shown when there are no field errors, or hidden in favor of "Please fix…" when there are. */
  message?: string | null
  /** Field-level errors keyed by field name. */
  fieldErrors?: FieldErrors
  /** Per-form label overrides for the field humanizer. */
  labels?: Record<string, string>
  /** Title to show above the bullet list when there are field errors. */
  title?: string
  className?: string
}

/**
 * Drop-in error banner for forms and dialogs. Renders nothing when there is
 * no message and no field errors. When field errors are present they're
 * displayed as a bulleted list of plain-English sentences so users can see
 * exactly what to fix.
 */
export function FormErrorBanner({
  message,
  fieldErrors,
  labels,
  title = "Please fix the following before saving:",
  className,
}: FormErrorBannerProps) {
  const fieldList = formatFieldErrorList(fieldErrors, labels)
  const hasFieldErrors = fieldList.length > 0
  if (!message && !hasFieldErrors) return null

  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive ${
        className ?? ""
      }`}
    >
      <AlertCircle className="size-4 mt-0.5 shrink-0" />
      <div className="space-y-1.5 min-w-0">
        <p className="font-medium">{hasFieldErrors ? title : message}</p>
        {hasFieldErrors && (
          <ul className="list-disc pl-5 space-y-0.5">
            {fieldList.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
