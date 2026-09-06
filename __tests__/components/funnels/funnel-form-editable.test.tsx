// @vitest-environment jsdom
// __tests__/components/funnels/funnel-form-editable.test.tsx
//
// The form is the one part of a funnel page whose editing anchors CANNOT come
// from `render.ts`. An island's insides never pass through the compiler —
// `convertIsland` keeps only its name and props — so `FunnelForm` stamps its
// own, and this file is the only thing standing between that and the two ways
// it can be wrong:
//
//   1. Anchors missing on the canvas: the whole form is unclickable, which is
//      most of a lead-gen page. That is the state this file was written to end.
//   2. Anchors present on a PUBLISHED page: editor scaffolding in the markup
//      every visitor receives, and `djp-edit-*` classes whose stylesheet is not
//      shipped with it — so they would also be unstyled.
//
// WHAT THIS FILE CANNOT SEE: the preview is an iframe, and a node from an
// iframe is not `instanceof` the parent window's `Element`. jsdom is ONE realm
// and never loads a frame, so no test here can tell whether a click in the real
// canvas reaches these anchors. That was verified in a browser; see JOURNAL.md.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { FunnelForm } from "@/components/funnels/islands/FunnelForm"
import type { FunnelFormField } from "@/lib/funnels/islands"

/**
 * The select is FIELD 2, NOT FIELD 0, on purpose. An implementation that used
 * the wrong index — the option's index, a hard-coded 0, the index of the
 * options loop — would produce anchors that look right and address the wrong
 * field, and a one-field fixture cannot tell those apart.
 */
const FIELDS: FunnelFormField[] = [
  { name: "athlete_name", label: "Athlete's name", type: "text", required: true },
  { name: "email", label: "Email", type: "email", required: true },
  {
    name: "grade",
    label: "Grade this fall",
    type: "select",
    required: false,
    options: ["9th", "10th", "11th", "12th"],
  },
  { name: "notes", label: "Anything we should know?", type: "textarea", required: false },
]

const BASE = {
  funnelId: "ffffffff-1111-4222-8333-444444444444",
  stepId: "3f1b7c5e-1111-4222-8333-444444444444",
  formKey: "optin",
  fields: FIELDS,
  submitLabel: "Request a spot",
  successMode: "message" as const,
  successMessage: "You're in.",
  isPreview: true,
}

function renderForm(overrides: Partial<React.ComponentProps<typeof FunnelForm>> = {}) {
  return render(<FunnelForm {...BASE} {...overrides} />)
}

/** The element carrying `data-edit="<path>"`, or null. */
function anchor(path: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-edit="${path}"]`)
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("FunnelForm — the published page is untouched", () => {
  it("stamps no editing anchors at all when not editing", () => {
    // MUTANT KILLED: stamping unconditionally. `/go` and every published
    // version row render through this same component, so an ungated anchor is
    // editor scaffolding on a live campaign page.
    renderForm({ consentText: "We'll only use your details to contact you." })
    expect(document.querySelectorAll("[data-edit]")).toHaveLength(0)
    expect(document.querySelectorAll("[data-edit-empty]")).toHaveLength(0)
  })

  it("emits no canvas-only class when not editing", () => {
    // The other half of the leadgen class/stylesheet harness: `djp-edit-*` is
    // defined in CANVAS_EDIT_CSS, which a visitor's page does not include, so
    // one leaking out would ALSO be unstyled.
    renderForm({ consentText: "Consent." })
    expect(document.querySelector('[class*="djp-edit-"]')).toBeNull()
    expect(document.querySelector(".djp-empty")).toBeNull()
  })

  it("renders no consent element at all when there is no consent text", () => {
    renderForm()
    expect(document.querySelector(".djp-consent")).toBeNull()
  })
})

describe("FunnelForm — every string on the canvas has its own path", () => {
  it("anchors each field label at its own index", () => {
    renderForm({ editable: true })
    expect(anchor("fields.0.label")).toHaveTextContent("Athlete's name")
    expect(anchor("fields.1.label")).toHaveTextContent("Email")
    expect(anchor("fields.2.label")).toHaveTextContent("Grade this fall")
    expect(anchor("fields.3.label")).toHaveTextContent("Anything we should know?")
  })

  it("keeps the required marker OUT of the anchored text", () => {
    // MUTANT KILLED: putting `data-edit` on the <label> element. `commitText`
    // takes `textContent`, so the first edit of a required field would save
    // "Athlete's name *" as the label — and then render a second asterisk
    // beside it, every time.
    renderForm({ editable: true })
    expect(anchor("fields.0.label")!.textContent).toBe("Athlete's name")
    // The marker is still on the page, just not inside the anchor.
    expect(document.querySelector(".djp-req")).not.toBeNull()
  })

  it("makes the submit label editable WITHOUT putting a caret inside a button", () => {
    // A caret inside a <button> cannot be typed into: SPACE activates the
    // button rather than inserting a space. Verified in a real browser —
    // "Claim my spot" typed into the real button saved "Claim", because the
    // first space submitted the form instead of reaching the text. So on the
    // canvas the control is a <span> wearing the same classes.
    renderForm({ editable: true })
    const submit = anchor("submitLabel")
    expect(submit).not.toBeNull()
    expect(submit!.textContent).toBe("Request a spot")
    expect(submit!.tagName).toBe("SPAN")
    expect(document.querySelector("button[type='submit']")).toBeNull()
    // Same classes, so the canvas is not showing a different-looking button.
    expect(submit).toHaveClass("djp-btn", "djp-btn-primary", "djp-form-submit")
  })

  it("ships a REAL submit button to a visitor", () => {
    // MUTANT KILLED: rendering the span unconditionally. A published lead-gen
    // page whose submit control is a <span> cannot submit at all — the form
    // would be decorative, and the whole page exists to capture that lead.
    renderForm()
    const button = document.querySelector<HTMLButtonElement>("button[type='submit']")
    expect(button).not.toBeNull()
    expect(button!.textContent).toBe("Request a spot")
    expect(button).toHaveAttribute("data-djp-submit")
  })

  it("anchors an existing consent line", () => {
    renderForm({ editable: true, consentText: "We'll only use your details to contact you." })
    expect(anchor("consentText")).toHaveTextContent("We'll only use your details")
    expect(anchor("consentText")).not.toHaveAttribute("data-edit-empty")
  })

  it("gives an UNSET consent line a placeholder to click", () => {
    // The commonest "I can't edit this" bug in a builder of this shape: an
    // unset optional field renders no element, so there is no pixel to click,
    // so it can never be filled in from the page. `optionalText` fixes it for
    // everything render.ts emits; this is the same rule for the one optional
    // string that lives inside the island.
    renderForm({ editable: true })
    const placeholder = anchor("consentText")
    expect(placeholder).not.toBeNull()
    expect(placeholder).toHaveAttribute("data-edit-empty")
    expect(placeholder).toHaveTextContent("Add a consent line")
    // `data-edit-empty` is what stops the canvas committing the placeholder
    // words as real copy when Enter is pressed without typing.
    expect(placeholder).toHaveClass("djp-empty")
  })
})

describe("FunnelForm — a dropdown's choices", () => {
  it("gives each option a click target addressed to its own field", () => {
    // AN <option> CANNOT BE EDITED WHERE IT APPEARS: it is drawn by the OS, it
    // takes no `contenteditable`, and the popup is not somewhere a double-click
    // reaches. Anchoring the <option> itself would be exactly the dead click
    // target this whole change exists to stop shipping — so the choices get a
    // second, editable rendering that only exists on the canvas.
    renderForm({ editable: true })

    // SCOPED to the select's own field, and matched by CLASS rather than by
    // text: the same four words are also the <option> elements sitting a few
    // nodes away, so a by-text query returns eight nodes and an assertion built
    // on it would be describing the dropdown, not the chips.
    const field = document.querySelector<HTMLElement>('[data-djp-field="grade"]')!
    const chips = Array.from(field.querySelectorAll<HTMLElement>(".djp-edit-chip"))
    expect(chips).toHaveLength(4)
    expect(chips.map((chip) => chip.textContent)).toEqual(["9th", "10th", "11th", "12th"])
    expect(chips.map((chip) => chip.getAttribute("data-edit"))).toEqual([
      "fields.2.options.0",
      "fields.2.options.1",
      "fields.2.options.2",
      "fields.2.options.3",
    ])
  })

  it("leaves the real <select> exactly as it was", () => {
    // The chips are an ADDITION. The control the visitor uses must be the same
    // control the owner is looking at, or the canvas stops being a preview.
    renderForm({ editable: true })
    const select = document.querySelector<HTMLSelectElement>("#optin-grade")!
    expect(select.tagName).toBe("SELECT")
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Select…", "9th", "10th", "11th", "12th"])
    expect(select.querySelector("[data-edit]")).toBeNull()
  })

  it("renders no chips for a field that has no options", () => {
    renderForm({ editable: true })
    const field = document.querySelector<HTMLElement>('[data-djp-field="email"]')!
    expect(field.querySelector(".djp-edit-chip")).toBeNull()
  })

  it("renders no chips at all when not editing", () => {
    renderForm()
    expect(document.querySelector(".djp-edit-options")).toBeNull()
  })
})

describe("FunnelForm — SMS consent checkbox", () => {
  const FIELDS_WITH_PHONE: FunnelFormField[] = [
    { name: "email", label: "Email", type: "email", required: true },
    { name: "phone", label: "Phone number", type: "tel", required: true },
  ]
  const WORDING =
    "I agree to receive text messages from Acme Fitness about my inquiry. Message and data rates may apply. Reply STOP to opt out, HELP for help."

  it("renders an UNCHECKED checkbox with the rendered wording under a tel field", () => {
    renderForm({ fields: FIELDS_WITH_PHONE, smsConsentWording: WORDING })
    const field = document.querySelector<HTMLElement>('[data-djp-field="phone_sms_consent"]')!
    expect(field).not.toBeNull()
    expect(field.getAttribute("data-djp-field-type")).toBe("checkbox")
    const checkbox = field.querySelector<HTMLInputElement>('input[name="sms_consent"]')!
    expect(checkbox).not.toBeNull()
    expect(checkbox.type).toBe("checkbox")
    expect(checkbox.checked).toBe(false)
    expect(field).toHaveTextContent(WORDING)
  })

  it("renders no checkbox when smsConsentWording is not provided", () => {
    // MUTANT KILLED: rendering the checkbox unconditionally off the tel field
    // alone. FormIsland only fetches business_settings (and so only ever
    // passes this prop) when the form has a tel field — a form with no
    // wording must render no checkbox at all, not a broken/empty one.
    renderForm({ fields: FIELDS_WITH_PHONE })
    expect(document.querySelector('[name="sms_consent"]')).toBeNull()
  })

  it("renders no checkbox next to a non-tel field even when wording is provided", () => {
    renderForm({ fields: FIELDS_WITH_PHONE, smsConsentWording: WORDING })
    const emailField = document.querySelector<HTMLElement>('[data-djp-field="email"]')!
    expect(emailField.querySelector('[name="sms_consent"]')).toBeNull()
  })

  it("stamps no editing anchor on the consent wording — it is not owner-editable copy", () => {
    renderForm({ fields: FIELDS_WITH_PHONE, smsConsentWording: WORDING, editable: true })
    const field = document.querySelector<HTMLElement>('[data-djp-field="phone_sms_consent"]')!
    expect(field.querySelector("[data-edit]")).toBeNull()
  })

  it("posts sms_consent: true when the box is ticked before submit", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
      clone: () => ({ json: async () => ({ ok: true }) }),
    })
    vi.stubGlobal("fetch", fetchMock)

    renderForm({ fields: FIELDS_WITH_PHONE, smsConsentWording: WORDING, isPreview: false })
    const checkbox = document.querySelector<HTMLInputElement>('input[name="sms_consent"]')!
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)

    fireEvent.submit(document.querySelector("form")!)
    await screen.findByRole("status")

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.sms_consent).toBe(true)
  })

  it("posts sms_consent: false when the box is left unchecked", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
      clone: () => ({ json: async () => ({ ok: true }) }),
    })
    vi.stubGlobal("fetch", fetchMock)

    renderForm({ fields: FIELDS_WITH_PHONE, smsConsentWording: WORDING, isPreview: false })
    fireEvent.submit(document.querySelector("form")!)
    await screen.findByRole("status")

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.sms_consent).toBe(false)
  })
})

describe("FunnelForm — submitting", () => {
  it("stays silent when the owner is editing the page", async () => {
    // THE FIRST CLICK OF A DOUBLE-CLICK ON THE BUTTON IS A SUBMIT. Without the
    // guard, double-clicking "Request a spot" to rename it answers with "This
    // is a preview — submissions are disabled", which reads as the edit having
    // failed rather than as the form working.
    renderForm({ editable: true })
    fireEvent.submit(document.querySelector("form")!)
    expect(screen.queryByRole("alert")).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("still says submissions are disabled on a plain preview", async () => {
    // MUTANT KILLED: suppressing the notice for every preview rather than only
    // while editing. Outside edit mode a click on the button really is someone
    // trying the form, and silence there would read as a broken form.
    renderForm()
    fireEvent.submit(document.querySelector("form")!)
    expect(await screen.findByRole("alert")).toHaveTextContent("preview")
    expect(fetch).not.toHaveBeenCalled()
  })
})
