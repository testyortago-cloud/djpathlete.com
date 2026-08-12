// The island element — forms, checkouts, event signups, booking CTAs,
// testimonials, FAQs.
//
// Its fields are NOT written here. ISLAND_TRAITS was deliberately kept when the
// GrapesJS editor was deleted, with a comment saying it would "become Stage 2's
// section-inspector metadata". This is Stage 2. Hand-writing the fields would
// recreate exactly the bug that file's own comments describe: a control the
// schema rejects, or a default with no control at all (a `form` once shipped a
// successMode default with no way to change it, making the Redirect URL field
// purely decorative).

import { z } from "zod"
import { Boxes } from "lucide-react"
import { ISLAND_TRAITS } from "@/lib/funnels/island-fields"
import { ISLAND_NAMES, type IslandName } from "@/lib/funnels/islands"
import type { ElementDef, FieldSpec } from "../element-def"

const propsSchema = z.object({
  name: z.enum(ISLAND_NAMES),
  islandProps: z.record(z.string(), z.unknown()),
})

export type IslandElementProps = z.infer<typeof propsSchema>

/**
 * The inspector's fields for a given island, derived from the traits the
 * compiler validates against. `IslandTrait["type"]` is already a subset of
 * `FieldSpec["type"]`, so this is a projection and not a translation table —
 * a translation table would be the second source of truth all over again.
 */
export function fieldsForIsland(name: IslandName): FieldSpec[] {
  return ISLAND_TRAITS[name].map((trait) => ({
    name: trait.name,
    label: trait.label,
    type: trait.type,
    options: trait.options,
  }))
}

export const islandDef: ElementDef<IslandElementProps> = {
  kind: "island",
  label: "Dynamic block",
  icon: Boxes,
  defaultProps: { name: "form", islandProps: {} },
  propsSchema,
  // The real fields depend on WHICH island, so the inspector calls
  // `fieldsForIsland(props.name)`. This static list is only the island picker.
  fields: [
    {
      name: "name",
      label: "Block",
      type: "select",
      options: ISLAND_NAMES.map((name) => ({ id: name, label: name })),
    },
  ],
  compile: ({ props }) => ({
    t: "island",
    name: props.name,
    props: props.islandProps,
  }),
  /**
   * Islands CANNOT render on the canvas. `EventIsland`, `FaqIsland` and
   * `TestimonialsIsland` are async server components that query the database,
   * so there is no way to put the real thing inside a client-side editor. A
   * labelled placeholder is what GHL shows for its dynamic blocks too, and the
   * `?preview=1` iframe remains the way to see the real one.
   */
  canvasFallback: ({ props }) => (
    <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 px-4 py-6 text-center">
      <p className="font-medium text-primary">{props.name}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Dynamic block — preview the page to see the real one
      </p>
    </div>
  ),
}
