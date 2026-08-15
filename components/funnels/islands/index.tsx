// components/funnels/islands/index.tsx — island name -> React component.
//
// The canvas can only place islands the registry in lib/funnels/islands.ts
// knows about, and the compiler validated their props at publish time, so by
// the time we get here the props are already the schema's output type.

import type { ReactNode } from "react"
import type { IslandName } from "@/lib/funnels/islands"
import { FormIsland } from "./FormIsland"
import { CheckoutIsland } from "./CheckoutIsland"
import { EventIsland } from "./EventIsland"
import { BookingIsland } from "./BookingIsland"
import { TestimonialsIsland } from "./TestimonialsIsland"
import { FaqIsland } from "./FaqIsland"

/** What an island needs to know about the page it is standing on. */
export interface FunnelRenderContext {
  funnelId: string
  funnelSlug: string
  stepId: string
  stepSlug: string
  /** Preview pages must not create real leads or real checkout sessions. */
  isPreview: boolean
  /**
   * Stamp `data-edit` anchors inside the island so the builder canvas can click
   * into it. Set ONLY by `/funnel-preview/[stepId]?edit=1`.
   *
   * WHY AN ISLAND HAS TO DO ITS OWN STAMPING. Everywhere else the anchors are
   * written by `render.ts` and survive the compiler as ordinary `data-*`
   * attributes. An island's insides never pass through the compiler at all —
   * `convertIsland` keeps only its name and props, and the markup is created
   * here, at request time. And unlike a CTA, whose one editable string can be
   * addressed by a wrapper, a form holds MANY: `submitLabel`, `consentText`,
   * `fields.0.label`, `fields.3.options.1`. Each needs its own path, and a
   * wrapper cannot express more than one.
   *
   * Optional, and false everywhere else BY OMISSION: `/go` and every published
   * version row build this context without it, so a visitor's page is
   * byte-identical to what it was before this existed.
   */
  editable?: boolean
}

type Props = Record<string, unknown>

export function renderIsland(
  name: IslandName,
  props: Props,
  context: FunnelRenderContext,
): ReactNode {
  switch (name) {
    case "form":
      return <FormIsland props={props} context={context} />
    case "checkout":
      return <CheckoutIsland props={props} />
    case "event":
      return <EventIsland props={props} />
    case "booking":
      return <BookingIsland props={props} />
    case "testimonials":
      return <TestimonialsIsland props={props} />
    case "faq":
      return <FaqIsland props={props} />
    default: {
      // Exhaustiveness: adding an island to the registry without adding it here
      // becomes a compile error rather than a silently blank page.
      const exhaustive: never = name
      return exhaustive
    }
  }
}
