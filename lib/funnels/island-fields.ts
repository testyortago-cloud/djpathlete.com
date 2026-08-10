// lib/funnels/island-fields.ts — the editable field metadata for each island.
//
// Moved here from `components/admin/funnels/island-traits.ts` when the GrapesJS
// canvas was deleted (Stage 1.10). It was the one piece of that file with no
// engine in it: a plain description of which props an owner may set on an
// island and what kind of input each one wants. GrapesJS consumed it as its
// "traits"; the section inspector consumes it as form fields. The names
// `ISLAND_TRAITS` / `IslandTrait` are kept so the invariant test and its
// history stay legible.
//
// Derived from the same registry the compiler validates against, so an island
// can never offer a setting the schema will reject at publish time.

import { type IslandName } from "@/lib/funnels/islands"

export interface IslandTrait {
  /** Matches the prop name in the island's Zod schema. */
  name: string
  label: string
  type: "text" | "number" | "checkbox" | "json" | "select"
  /** select only. `id` is the value written into data-djp-props. */
  options?: { id: string; label: string }[]
}

/**
 * `form.fields` is a JSON field on purpose: it is an array of objects, and a
 * repeater UI for it is a bigger piece of work than the rest of the inspector
 * combined. Everything else gets a plain typed input.
 */
export const ISLAND_TRAITS: Record<IslandName, IslandTrait[]> = {
  form: [
    { name: "formKey", label: "Form key", type: "text" },
    { name: "submitLabel", label: "Button label", type: "text" },
    // Without this control successMode can never leave its "message" default,
    // which makes the Redirect URL field below purely decorative.
    {
      name: "successMode",
      label: "After submit",
      type: "select",
      options: [
        { id: "message", label: "Show a message" },
        { id: "redirect", label: "Redirect to a URL" },
      ],
    },
    { name: "successMessage", label: "Success message", type: "text" },
    { name: "redirectUrl", label: "Redirect URL (if redirecting)", type: "text" },
    { name: "consentText", label: "Consent text (optional)", type: "text" },
    { name: "fields", label: "Fields (JSON)", type: "json" },
  ],
  checkout: [
    // Without this the owner could never switch a buy button from a program to
    // a session pack — same class of bug as the missing successMode control.
    {
      name: "productKind",
      label: "What is being sold",
      type: "select",
      options: [
        { id: "program", label: "Program" },
        { id: "session_pack", label: "Session pack" },
      ],
    },
    { name: "productId", label: "Program / pack ID", type: "text" },
    { name: "label", label: "Button label", type: "text" },
  ],
  event: [
    { name: "eventId", label: "Event ID", type: "text" },
    { name: "label", label: "Button label", type: "text" },
    { name: "showSpots", label: "Show spots left", type: "checkbox" },
  ],
  booking: [
    { name: "label", label: "Button label", type: "text" },
    { name: "href", label: "Links to", type: "text" },
  ],
  testimonials: [
    { name: "limit", label: "How many", type: "number" },
    { name: "featuredOnly", label: "Featured only", type: "checkbox" },
  ],
  faq: [
    { name: "pageKey", label: "FAQ page key", type: "text" },
    { name: "limit", label: "How many", type: "number" },
  ],
}
