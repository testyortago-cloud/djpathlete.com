/**
 * Translate Zod-style field error messages and API error envelopes into
 * plain-English copy suitable for end users. Used by FormErrorBanner and any
 * form/dialog that surfaces server validation errors.
 */

export type FieldErrors = Record<string, string[] | undefined>

/**
 * Default labels for the most common form fields across the app. Pass a
 * per-form `labels` map to override or add fields when invoking
 * humanizeFieldError / formatFieldErrorList.
 */
export const COMMON_FIELD_LABELS: Record<string, string> = {
  // generic
  title: "Title",
  name: "Name",
  email: "Email",
  password: "Password",
  phone: "Phone",
  url: "URL",
  description: "Description",
  summary: "Summary",
  notes: "Notes",
  status: "Status",
  type: "Type",
  slug: "Slug",
  // people
  firstName: "First name",
  lastName: "Last name",
  first_name: "First name",
  last_name: "Last name",
  date_of_birth: "Date of birth",
  // events / scheduling
  start_date: "Start date",
  end_date: "End date",
  session_schedule: "Session schedule",
  capacity: "Capacity",
  age_min: "Minimum age",
  age_max: "Maximum age",
  price_dollars: "Price",
  price_cents: "Price",
  // location
  location_name: "Venue name",
  location_address: "Address",
  location_map_url: "Map URL",
  // media
  hero_image_url: "Hero image",
  cover_image_url: "Cover image",
  avatar_url: "Avatar",
  // exercises / programs
  category: "Category",
  movement_pattern: "Movement pattern",
  primary_muscle_group: "Primary muscle group",
  difficulty: "Difficulty",
  equipment: "Equipment",
  video_url: "Video URL",
  instructions: "Instructions",
  duration_weeks: "Duration",
  // marketing
  body: "Body",
  excerpt: "Excerpt",
  meta_description: "Meta description",
}

function labelFor(field: string, labels?: Record<string, string>): string {
  if (labels?.[field]) return labels[field]
  if (COMMON_FIELD_LABELS[field]) return COMMON_FIELD_LABELS[field]
  // Fallback: turn snake_case / camelCase into "Title Case" words.
  return field
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase())
}

/**
 * Convert a single Zod error message for a given field into a friendly,
 * end-user sentence. Returns "<Label>: <reason>" when no humanization rule
 * matches, so the user always sees something contextual.
 */
export function humanizeFieldError(field: string, raw?: string, labels?: Record<string, string>): string {
  const label = labelFor(field, labels)
  const msg = (raw ?? "").trim()
  if (!msg) return `${label} is invalid`

  const lower = msg.toLowerCase()
  if (lower === "required" || lower.includes("at least 1") || lower.includes("at least 2")) {
    return `${label} is required`
  }
  if (lower.includes("invalid datetime") || lower.includes("invalid date")) {
    return `${label} is required`
  }
  if (lower.includes("invalid email")) {
    return `${label} must be a valid email address`
  }
  if (lower.includes("invalid url")) {
    return `${label} must be a valid URL (e.g. https://…)`
  }
  if (lower.includes("invalid uuid") || lower.includes("invalid id")) {
    return `${label} is not a valid identifier`
  }
  if (lower.includes("expected number") || lower.includes("nan") || lower.includes("not a number")) {
    return `${label} must be a number`
  }
  if (lower.includes("must contain at most")) {
    return `${label} is too long`
  }
  if (lower.includes("greater than or equal to 0") || lower.includes("nonnegative")) {
    return `${label} cannot be negative`
  }
  if (lower.includes("invalid enum value") || lower.includes("expected one of")) {
    return `${label} has an invalid value — please pick one of the available options`
  }
  if (lower.includes("password")) {
    // Most password rules already read clearly — keep them but prefix the label.
    return `${label}: ${msg}`
  }
  if (lower.includes("age_max")) {
    return "Maximum age must be greater than or equal to minimum age"
  }
  return `${label}: ${msg}`
}

/**
 * Pick the field-error map out of an API error response. We tolerate the
 * common envelope shapes used across this codebase (`fieldErrors`, `details`,
 * `errors`) so callers don't have to know which one a given route uses.
 */
export function extractFieldErrors(payload: unknown): FieldErrors {
  if (!payload || typeof payload !== "object") return {}
  const p = payload as Record<string, unknown>
  for (const key of ["fieldErrors", "details", "errors"]) {
    const v = p[key]
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as FieldErrors
    }
  }
  return {}
}

/**
 * Build an array of "Label: reason" strings, one per failing field, ready to
 * render as a bullet list in a banner. Falls back to an empty array when no
 * field errors are present.
 */
export function formatFieldErrorList(
  fieldErrors: FieldErrors | undefined,
  labels?: Record<string, string>,
): string[] {
  if (!fieldErrors) return []
  return Object.entries(fieldErrors)
    .filter(([, msgs]) => Array.isArray(msgs) && msgs.length > 0)
    .map(([field, msgs]) => humanizeFieldError(field, msgs?.[0], labels))
}

/**
 * Translate common HTTP status codes into a sentence that's useful when the
 * server returned no body — or only a generic envelope — so the user is never
 * left with a bare "Failed to save".
 */
export function statusToFriendlyMessage(status: number, fallback = "Something went wrong"): string {
  if (status === 401) return "You're signed out — please log in and try again."
  if (status === 403) return "You don't have permission to do that."
  if (status === 404) return "We couldn't find what you were trying to update."
  if (status === 409) return "That conflicts with existing data — please review and try again."
  if (status === 413) return "The file or payload is too large."
  if (status === 422) return "Some fields look wrong — please review and try again."
  if (status === 429) return "You're doing that too quickly — please wait a moment and try again."
  if (status >= 500) return "Our server hit an error. Please try again in a moment."
  return fallback
}

/**
 * Higher-level helper: take a fetch Response that's already been parsed to
 * JSON and produce a single { message, fieldErrors } object. Use when you
 * want one call site for "make this API error friendly".
 */
export function summarizeApiError(
  response: { ok: boolean; status: number },
  payload: unknown,
  fallback = "Something went wrong",
): { message: string; fieldErrors: FieldErrors } {
  const fieldErrors = extractFieldErrors(payload)
  const p = (payload ?? {}) as { error?: unknown; message?: unknown }
  const serverMsg =
    (typeof p.error === "string" && p.error.trim()) || (typeof p.message === "string" && p.message.trim()) || ""
  const message =
    serverMsg && serverMsg !== "Invalid form data" && serverMsg !== "Invalid event data"
      ? serverMsg
      : statusToFriendlyMessage(response.status, fallback)
  return { message, fieldErrors }
}
