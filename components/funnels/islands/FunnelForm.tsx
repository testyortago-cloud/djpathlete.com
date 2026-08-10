"use client"

// The only interactive part of a funnel page — and the one element on it whose
// entire job is to capture a lead.
//
// ---------------------------------------------------------------------------
// IT USED TO BE DELIBERATELY UNSTYLED. THAT REASONING EXPIRED.
// ---------------------------------------------------------------------------
// The comment here read: "deliberately unstyled beyond layout: the owner styles
// the surrounding canvas, and these controls inherit from it". That was true in
// the GrapesJS era, when the owner really did style the surrounding elements by
// hand on a drag canvas. The typed-section builder DELETED that canvas, and
// `styles.ts` — which grew 15-40 lines for every other section kind — gave
// `.djp-s-form` four rules, none of which touched a control.
//
// So nothing inherited, because there was nothing to inherit FROM, and the form
// rendered at browser defaults: labels welded to their inputs on one line, an
// unstyled `<button>` that reads as body text. On a page whose only purpose is
// to convert.
//
// The class hooks below are the fix, and they are CLASSES the section
// stylesheet already defines rather than new ones: the submit button carries
// `djp-btn djp-btn-primary`, so it picks up the shared button treatment AND the
// tone-contrast pass — including the rule that repaints a primary button on an
// accent section, without which the button would be a shape in its own
// background's colour. Restating any of that here would be a second definition
// to keep in step. The `data-djp-*` attributes are kept as-is; they are
// semantic hooks and nothing about them changed.

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
        // Re-checked here as well as in the schema: these props arrive from
        // published JSON, and this line navigates a visitor who has just handed
        // over their email. Two cheap checks beat one.
        if (/^(?!\/\/)(\/|https:\/\/)/.test(redirectUrl)) {
          window.location.href = redirectUrl
          return
        }
        setStatus("done")
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
      <div className="djp-form-success" data-djp-form-state="success" role="status">
        {successMessage}
      </div>
    )
  }

  return (
    <form className="djp-form" onSubmit={handleSubmit} noValidate data-djp-form={formKey}>
      {fields.map((field) => (
        <div
          key={field.name}
          className="djp-field"
          data-djp-field={field.name}
          // The TYPE, so a checkbox row can lay itself out horizontally without
          // the stylesheet depending on `:has()`. A layout that works only in
          // browsers with `:has()` support is a layout that silently degrades to
          // a stacked checkbox on the ones without it.
          data-djp-field-type={field.type}
        >
          <label className="djp-field-label" htmlFor={`${formKey}-${field.name}`}>
            {field.label}
            {field.required ? (
              <span className="djp-req" aria-hidden>
                {" "}
                *
              </span>
            ) : null}
          </label>
          {renderControl(field, formKey)}
        </div>
      ))}

      {/* Honeypot. Hidden from people, irresistible to bots. */}
      <div aria-hidden style={{ position: "absolute", left: "-9999px" }}>
        <label htmlFor={`${formKey}-website`}>Website</label>
        <input id={`${formKey}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {consentText ? (
        <p className="djp-consent" data-djp-consent>
          {consentText}
        </p>
      ) : null}

      {error ? (
        <p className="djp-form-error" role="alert" data-djp-form-state="error">
          {error}
        </p>
      ) : null}

      {/* `djp-btn djp-btn-primary` are the SHARED button classes every other
          CTA on the page uses, so this inherits the sizing, the radius and —
          critically — the tone-contrast rule that repaints a primary button
          when it lands on an accent section. */}
      <button
        type="submit"
        className="djp-btn djp-btn-primary djp-form-submit"
        data-djp-submit
        disabled={status === "submitting"}
      >
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
    className: "djp-control",
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
