"use client"

// The only interactive part of a funnel page. Deliberately unstyled beyond
// layout: the owner styles the surrounding canvas, and these controls inherit
// from it, so the form looks like the page rather than like the admin app.

import { useRef, useState, type FormEvent } from "react"
import type { FunnelFormField } from "@/lib/funnels/islands"

interface FunnelFormProps {
  funnelId: string
  stepId: string
  formKey: string
  fields: FunnelFormField[]
  submitLabel: string
  successMode: "message" | "redirect"
  successMessage: string
  redirectUrl?: string
  consentText?: string
  isPreview: boolean
}

type Status = "idle" | "submitting" | "done" | "error"

export function FunnelForm({
  funnelId,
  stepId,
  formKey,
  fields,
  submitLabel,
  successMode,
  successMessage,
  redirectUrl,
  consentText,
  isPreview,
}: FunnelFormProps) {
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState<string | null>(null)
  // Time-to-submit: bots post instantly. Captured on mount, checked server-side.
  const mountedAt = useRef<number>(Date.now())

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (status === "submitting") return

    if (isPreview) {
      setError("This is a preview — submissions are disabled.")
      setStatus("error")
      return
    }

    setStatus("submitting")
    setError(null)

    const formData = new FormData(event.currentTarget)
    const values: Record<string, string> = {}
    for (const field of fields) {
      values[field.name] = String(formData.get(field.name) ?? "")
    }

    try {
      const response = await fetch("/api/funnels/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          funnelId,
          stepId,
          formKey,
          values,
          website: String(formData.get("website") ?? ""),
          elapsedMs: Date.now() - mountedAt.current,
        }),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? "Something went wrong. Please try again.")
        setStatus("error")
        return
      }

      if (successMode === "redirect" && redirectUrl) {
        window.location.href = redirectUrl
        return
      }
      setStatus("done")
    } catch {
      setError("Something went wrong. Please try again.")
      setStatus("error")
    }
  }

  if (status === "done") {
    return (
      <div data-djp-form-state="success" role="status">
        {successMessage}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate data-djp-form={formKey}>
      {fields.map((field) => (
        <div key={field.name} data-djp-field={field.name}>
          <label htmlFor={`${formKey}-${field.name}`}>
            {field.label}
            {field.required ? <span aria-hidden> *</span> : null}
          </label>
          {renderControl(field, formKey)}
        </div>
      ))}

      {/* Honeypot. Hidden from people, irresistible to bots. */}
      <div aria-hidden style={{ position: "absolute", left: "-9999px" }}>
        <label htmlFor={`${formKey}-website`}>Website</label>
        <input
          id={`${formKey}-website`}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {consentText ? <p data-djp-consent>{consentText}</p> : null}

      {error ? (
        <p role="alert" data-djp-form-state="error">
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={status === "submitting"}>
        {status === "submitting" ? "Sending…" : submitLabel}
      </button>
    </form>
  )
}

function renderControl(field: FunnelFormField, formKey: string) {
  const id = `${formKey}-${field.name}`
  const shared = {
    id,
    name: field.name,
    required: field.required ?? false,
    placeholder: field.placeholder,
  }

  if (field.type === "textarea") return <textarea {...shared} rows={4} />
  if (field.type === "checkbox") return <input {...shared} type="checkbox" />
  if (field.type === "select") {
    return (
      <select {...shared}>
        <option value="">Select…</option>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    )
  }
  return <input {...shared} type={field.type} />
}
