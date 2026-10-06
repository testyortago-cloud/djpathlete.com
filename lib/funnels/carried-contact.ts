// lib/funnels/carried-contact.ts — the name and email a funnel form hands to
// the next step, so a visitor who just typed them is not asked again.
//
// The RPI funnel's landing form takes name, email and sport, then redirects to
// the quiz, whose gate asks for name and email. Carrying them over prefills
// that gate; the visitor still sees both fields and still submits them.
//
// sessionStorage, not the URL: an email in a query string lands in logs,
// analytics and the Referer header. It is this tab only and dies with it.
// Every access is wrapped because storage throws in some private windows.

const KEY = "djp-funnel-contact"

export interface CarriedContact {
  name: string
  email: string
}

interface FieldLike {
  name: string
  type: string
  role?: string
}

/** Picks the visitor's name and email out of a submitted form's values. */
export function contactFromForm(fields: FieldLike[], values: Record<string, string>): CarriedContact {
  const nameField = fields.find((f) => f.role === "parent_name") ?? fields.find((f) => f.role === "athlete_name")
  const emailField = fields.find((f) => f.type === "email")
  return {
    name: nameField ? (values[nameField.name] ?? "").trim() : "",
    email: emailField ? (values[emailField.name] ?? "").trim() : "",
  }
}

export function saveCarriedContact(contact: CarriedContact): void {
  if (!contact.name && !contact.email) return
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(contact))
  } catch {
    // A prefill is a convenience; the next step simply asks again.
  }
}

export function readCarriedContact(): CarriedContact | null {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(KEY) ?? "null") as Partial<CarriedContact> | null
    if (!parsed) return null
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      email: typeof parsed.email === "string" ? parsed.email : "",
    }
  } catch {
    return null
  }
}
