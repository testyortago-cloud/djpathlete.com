// components/admin/funnels/island-traits.ts — how each island is edited on the canvas.
//
// Derived from the same registry the compiler validates against, so an island
// can never offer a setting the schema will reject at publish time.

import { ISLAND_NAMES, ISLANDS, type IslandName } from "@/lib/funnels/islands"

export interface IslandTrait {
  /** Matches the prop name in the island's Zod schema. */
  name: string
  label: string
  type: "text" | "number" | "checkbox" | "json"
}

/**
 * `form.fields` is a JSON trait on purpose: it is an array of objects, and a
 * repeater UI for it is a bigger piece of work than the rest of the editor
 * combined. Everything else gets a plain typed input.
 */
export const ISLAND_TRAITS: Record<IslandName, IslandTrait[]> = {
  form: [
    { name: "formKey", label: "Form key", type: "text" },
    { name: "submitLabel", label: "Button label", type: "text" },
    { name: "successMessage", label: "Success message", type: "text" },
    { name: "redirectUrl", label: "Redirect URL (optional)", type: "text" },
    { name: "consentText", label: "Consent text (optional)", type: "text" },
    { name: "fields", label: "Fields (JSON)", type: "json" },
  ],
  checkout: [
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

/** Placeholder markup shown on the canvas — never what the visitor sees. */
export function islandPlaceholderHtml(name: IslandName): string {
  const def = ISLANDS[name]
  const props = JSON.stringify(def.defaultProps).replace(/'/g, "&#39;")
  return (
    `<div data-djp-island="${name}" data-djp-props='${props}' ` +
    `class="djp-island-placeholder">${def.label}</div>`
  )
}

export function islandBlockDefinitions() {
  return ISLAND_NAMES.map((name) => ({
    id: `djp-island-${name}`,
    label: ISLANDS[name].label,
    category: "Interactive",
    content: islandPlaceholderHtml(name),
    attributes: { title: ISLANDS[name].description },
  }))
}
