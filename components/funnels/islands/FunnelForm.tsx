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

import { Fragment, useRef, useState, type FormEvent, type ReactNode } from "react"
import type { FunnelFormField } from "@/lib/funnels/islands"

interface FunnelFormProps {
  funnelId: string
  stepId: string
  formKey: string
  fields: FunnelFormField[]
  submitLabel: string
  successMode: "message" | "redirect" | "checkout"
  successMessage: string
  redirectUrl?: string
  consentText?: string
  /**
   * The active liability waiver, already rendered to HTML by the server wrapper.
   *
   * PRESENT ONLY ON A CHECKOUT FORM, and what makes the consent tick beside it
   * informed rather than nominal: the server files the waiver document's id, the
   * visitor's IP and their user agent as evidence of agreement, so the document
   * has to be in front of them. `null` falls back to a link, which is the same
   * fallback EventSignupModal makes for the same reason.
   */
  waiverHtml?: string | null
  /**
   * The SMS opt-in sentence, already rendered server-side (`renderSmsConsentWording`
   * fed `business_settings.display_name`) by the FormIsland wrapper — never
   * built here, so the wording the visitor ticks against is the exact string
   * the submit route re-renders into `contact_consents.wording_shown`.
   *
   * `undefined` when the form has no `tel` field (FormIsland does not fetch
   * business settings for a form that has nothing to attach a phone consent
   * to), OR when the business has no usable name — a failed settings read
   * or a blank `display_name` (`hasSmsConsentDisplayName` in
   * sms-consent-wording.ts) both collapse to the same "no wording" outcome
   * rather than one of them rendering a checkbox over a sentence with a hole
   * in it. Either way this renders no checkbox at all, the same "no pixel,
   * no prop" contract `waiverHtml`/`consentText` already follow.
   */
  smsConsentWording?: string
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
  /**
   * This page is the full-screen DRAFT preview, so the form is usable but
   * harmless: it posts to `/api/funnels/preview-submit`, which validates
   * against the draft and writes nothing. See `FunnelRenderContext.testRun`.
   */
  testRun?: boolean
}

/**
 * What the live page would have done next, as reported by the preview endpoint.
 *
 * Only `redirect` is ACTED on — that is the funnel walk. A checkout and an
 * external URL are both places the owner cannot come back from mid-test, so the
 * server describes them instead and the panel below says so.
 */
type TestRunOutcome =
  | { kind: "message" }
  | { kind: "redirect"; href: string }
  | { kind: "external"; href: string }
  | { kind: "checkout"; label: string }
  | { kind: "no-draft"; stepName: string }

interface TestRunBody {
  outcome?: TestRunOutcome
  /** Field LABELS and what was typed, in the order the form asks. */
  captured?: Array<{ label: string; value: string }>
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
  waiverHtml,
  smsConsentWording,
  isPreview,
  editable = false,
  testRun = false,
}: FunnelFormProps) {
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState<string | null>(null)
  const [testRunResult, setTestRunResult] = useState<{
    outcome: TestRunOutcome
    captured: Array<{ label: string; value: string }>
  } | null>(null)
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

    // ORDER MATTERS AND IS TESTED. `editable` above still wins — the first
    // click of a double-click to rename the button IS a submit, and answering
    // it reads as the edit having failed. `testRun` then overrides the plain
    // preview refusal below, which every OTHER preview surface still relies on:
    // the builder's iframe and `/go?preview=1` must keep refusing outright.
    const endpoint = testRun ? "/api/funnels/preview-submit" : "/api/funnels/submit"
    if (isPreview && !testRun) {
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

    // Unchecked boxes are simply absent from FormData — `getAll` rather than
    // `get` because a form with more than one `tel` field renders more than
    // one checkbox sharing this name, and any one of them being ticked is
    // consent. Compared against the literal "on" (the browser default value
    // for a checkbox with no `value` attribute), never truthiness of the
    // string, since a present-but-empty entry would otherwise read as true.
    const smsConsent = formData.getAll("sms_consent").some((entry) => entry === "on")

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          funnelId,
          stepId,
          formKey,
          values,
          website: String(formData.get("website") ?? ""),
          elapsedMs: Date.now() - mountedAt.current,
          sms_consent: smsConsent,
        }),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? "Something went wrong. Please try again.")
        setStatus("error")
        return
      }

      // A TEST RUN NEVER REACHES THE BRANCHES BELOW. There is no Stripe session
      // to follow and no real success to report — the server has already said
      // what the live page WOULD have done, and the panel renders that.
      if (testRun) {
        const result = (await response
          .clone()
          .json()
          .catch(() => null)) as TestRunBody | null
        const outcome: TestRunOutcome = result?.outcome ?? { kind: "message" }
        if (outcome.kind === "redirect") {
          // The SERVER produced this href, already rewritten onto the preview
          // base. Same rule as `sessionUrl` below: never navigate to a URL the
          // client assembled. A string replace on `redirectUrl` here would be a
          // second copy of `livePathToPreview` for this file to drift from.
          //
          // The scheme check is re-applied anyway: two cheap checks beat one on
          // a line that navigates.
          if (outcome.href.startsWith("/") && !outcome.href.startsWith("//")) {
            window.location.href = outcome.href
            return
          }
        }
        setTestRunResult({ outcome, captured: result?.captured ?? [] })
        setStatus("done")
        return
      }

      // A CHECKOUT FORM'S SUCCESS IS A REDIRECT TO STRIPE, and it is checked
      // before `successMode` on purpose: if a page published as "message" is
      // later turned into a checkout form, the server is the thing that knows,
      // and thanking someone for a payment they never made is the worse failure.
      //
      // Only https, and only a URL the SERVER produced — this is not owner input,
      // so there is no allowlist to consult, but the scheme check keeps a
      // compromised or mocked response from becoming a javascript: navigation.
      const body = (await response
        .clone()
        .json()
        .catch(() => null)) as { sessionUrl?: unknown } | null
      if (typeof body?.sessionUrl === "string" && body.sessionUrl.startsWith("https://")) {
        window.location.href = body.sessionUrl
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
        {testRunResult ? <TestRunPanel {...testRunResult} /> : null}
      </div>
    )
  }

  return (
    <form className="djp-form" onSubmit={handleSubmit} noValidate data-djp-form={formKey}>
      {fields.map((field, index) => (
        <Fragment key={field.name}>
          <div
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
            {field.role === "waiver_accepted" ? (
              <div className="djp-waiver" data-djp-waiver>
                {waiverHtml ? (
                  // The document itself. Server-rendered from `legal_documents`,
                  // never authored here.
                  <div dangerouslySetInnerHTML={{ __html: waiverHtml }} />
                ) : (
                  <p>
                    Please read the{" "}
                    <a href="/liability-waiver" target="_blank" rel="noreferrer">
                      liability waiver
                    </a>{" "}
                    before continuing.
                  </p>
                )}
              </div>
            ) : null}
            {renderControl(field, formKey, editable, index)}
          </div>
          {/* THE SMS CONSENT CHECKBOX, under every phone field, UNCHECKED by
              default. Reuses the exact `.djp-field[data-djp-field-type="checkbox"]`
              structure an ordinary checkbox field already renders above (label
              then control, row-reversed by the stylesheet into control-then-label)
              so it inherits the published funnel CSS with no new rule — no
              re-publish required for this to reach a live page. `smsConsentWording`
              is undefined whenever FormIsland found no `tel` field to fetch
              business settings for, so there is nothing to render. */}
          {field.type === "tel" && smsConsentWording ? (
            <div className="djp-field" data-djp-field={`${field.name}_sms_consent`} data-djp-field-type="checkbox">
              <label className="djp-field-label" htmlFor={`${formKey}-${field.name}-sms-consent`}>
                {smsConsentWording}
              </label>
              <input
                id={`${formKey}-${field.name}-sms-consent`}
                name="sms_consent"
                type="checkbox"
                className="djp-control"
                defaultChecked={false}
              />
            </div>
          ) : null}
        </Fragment>
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


/**
 * What a test submission did, and — more usefully — what the LIVE page would
 * have done instead.
 *
 * WRITTEN FOR A COACH, NOT A DEVELOPER. Every sentence here was read aloud
 * first. No "payload", no "endpoint", no "record", no "persist" — the audience
 * is the person who runs the camp, and a word they have not been taught is a
 * word that makes them think something is broken.
 *
 * It sits INSIDE the success message rather than replacing it, because the
 * message is the thing being tested: the owner needs to see their own wording
 * exactly as a visitor would, and then be told it was not real.
 */
function TestRunPanel({
  outcome,
  captured,
}: {
  outcome: TestRunOutcome
  captured: Array<{ label: string; value: string }>
}) {
  return (
    <div
      data-djp-test-run
      className="djp-test-run mt-4 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-4 text-left"
    >
      <p className="font-heading text-sm">This was a test run</p>

      {outcome.kind === "external" ? (
        <p className="font-body mt-1 text-sm">
          On the real page this would send you to{" "}
          <a className="underline" href={outcome.href} target="_blank" rel="noopener noreferrer">
            {outcome.href}
          </a>
          .
        </p>
      ) : null}

      {outcome.kind === "checkout" ? (
        <p className="font-body mt-1 text-sm">
          On the real page this would start a checkout for “{outcome.label}”. No payment was set up.
        </p>
      ) : null}

      {outcome.kind === "no-draft" ? (
        <p className="font-body mt-1 text-sm">
          This form sends people to “{outcome.stepName}” next, but that page has no draft yet — so there is
          nothing to show. Write it in the builder, then try again.
        </p>
      ) : null}

      {captured.length > 0 ? (
        <>
          <p className="font-body mt-3 text-xs text-muted-foreground">What you filled in:</p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {captured.map((entry, index) => (
              <Fragment key={index}>
                <dt className="font-body text-xs text-muted-foreground">{entry.label}</dt>
                <dd className="font-mono text-xs">{entry.value}</dd>
              </Fragment>
            ))}
          </dl>
        </>
      ) : null}

      <p className="font-body mt-3 text-xs text-muted-foreground">
        Nothing was saved. No one was emailed or texted.
      </p>
    </div>
  )
}
