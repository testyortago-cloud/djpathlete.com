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
