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

import { useRef, useState, type FormEvent, type ReactNode } from "react"
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
  /**
   * The builder canvas is editing this page. Stamps `data-edit` anchors and
   * nothing else — no copy changes, no layout changes, no behaviour changes
   * beyond the submit guard below.
   *
   * ON A LEAD-GEN PAGE THIS FORM IS MOST OF THE PAGE. Every label, the consent
   * line and the button were the largest block of text on a funnel the owner
   * could not click, and none of them are reachable from the inspector either:
   * `RepeaterEditor` deliberately delegates "what each item SAYS" to the canvas
   * (its own comment says so), so a field label had no editor at all — only the
   * chat could change it.
   */
  editable?: boolean
}

type Status = "idle" | "submitting" | "done" | "error"

/**
 * A string the canvas can click into, or the bare string when not editing.
 *
 * A FRAGMENT, NOT AN ALWAYS-PRESENT SPAN, when not editing: this component
 * renders the published page too, and a permanent wrapper would be new markup
 * on every live funnel for the sole benefit of an editor no visitor can open.
 */
function Editable({ editable, path, children }: { editable: boolean; path: string; children: ReactNode }) {
  if (!editable) return <>{children}</>
  return <span data-edit={path}>{children}</span>
}

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
  editable = false,
}: FunnelFormProps) {
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState<string | null>(null)
  // Time-to-submit: bots post instantly. Captured on mount, checked server-side.
  const mountedAt = useRef<number>(Date.now())

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (status === "submitting") return

    // ON THE CANVAS, SILENCE. The owner is editing the page, not testing it,
    // and the first click of a double-click on the button IS a submit — so
    // without this, double-clicking "Request a spot" to rename it answers with
    // "This is a preview — submissions are disabled," which reads as the edit
    // having failed. The plain (non-editing) preview still says it, because
    // there the click really was someone trying the form.
    if (editable) return

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
      {fields.map((field, index) => (
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
            {/* The anchor wraps the LABEL TEXT, never the <label> element: the
                required marker is inside it, and `commitText` takes
                `textContent`, so anchoring the whole thing would save "Email *"
                as the label and then render a second asterisk beside it. */}
            <Editable editable={editable} path={`fields.${index}.label`}>
              {field.label}
            </Editable>
            {field.required ? (
              <span className="djp-req" aria-hidden>
                {" "}
                *
              </span>
            ) : null}
          </label>
          {renderControl(field, formKey, editable, index)}
        </div>
      ))}

      {/* Honeypot. Hidden from people, irresistible to bots. */}
      <div aria-hidden style={{ position: "absolute", left: "-9999px" }}>
        <label htmlFor={`${formKey}-website`}>Website</label>
        <input id={`${formKey}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {consentText ? (
        <p className="djp-consent" data-djp-consent data-edit={editable ? "consentText" : undefined}>
          {consentText}
        </p>
      ) : editable ? (
        // The placeholder rule `optionalText` follows in render.ts, applied to
        // the one optional string that lives inside the island: an unset
        // optional field renders no element, so there is no pixel to click, so
        // it can never be filled in from the page. Never rendered to a visitor.
        <p className="djp-consent djp-empty" data-djp-consent data-edit="consentText" data-edit-empty="1">
          Add a consent line
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
          when it lands on an accent section.

          ON THE CANVAS IT IS A <span>, NOT A <button>, AND THAT IS NOT
          COSMETIC. A caret inside a <button> cannot be typed into: SPACE
          activates the button instead of inserting a space. Verified in a real
          browser — typing "Claim my spot" into the real button saved "Claim",
          because the first space submitted the form (four "Blocked form
          submission ... sandboxed" warnings) instead of reaching the text. The
          span carries the same three classes and the same text, so the canvas
          looks identical, and `render.ts` uses exactly this substitution for
          the same reason (`disabledCta`). The published page still ships a real
          <button type="submit">. */}
      {editable ? (
        <span className="djp-btn djp-btn-primary djp-form-submit" role="button" data-djp-submit data-edit="submitLabel">
          {submitLabel}
        </span>
      ) : (
        <button
          type="submit"
          className="djp-btn djp-btn-primary djp-form-submit"
          data-djp-submit
          disabled={status === "submitting"}
        >
          {status === "submitting" ? "Sending…" : submitLabel}
        </button>
      )}
    </form>
  )
}

function renderControl(field: FunnelFormField, formKey: string, editable: boolean, index: number) {
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
      <>
        <select {...shared}>
          <option value="">Select…</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {/* A DROPDOWN'S CHOICES CANNOT BE EDITED WHERE THEY APPEAR. An <option>
            is drawn by the operating system, not by the page: it takes no
            `contenteditable`, and the popup it lives in is not somewhere a
            double-click can reach. Anchoring the <option> itself would be
            exactly the dead click target this whole change exists to stop
            shipping.

            So the choices get a second, editable rendering that exists only on
            the canvas — the same move `optionalText` makes for an unset field,
            and the only way "9th, 10th, 11th, 12th" is reachable outside the
            chat: `RepeaterEditor` offers structure for `fields`, never the
            words inside an item. */}
        {editable && (field.options?.length ?? 0) > 0 ? (
          <div className="djp-edit-options" role="group" aria-label={`${field.label} choices`}>
            <span className="djp-edit-note">Choices</span>
            {(field.options ?? []).map((option, optionIndex) => (
              <span
                key={`${optionIndex}-${option}`}
                className="djp-edit-chip"
                data-edit={`fields.${index}.options.${optionIndex}`}
              >
                {option}
              </span>
            ))}
          </div>
        ) : null}
      </>
    )
  }
  return <input {...shared} type={field.type} />
}
